// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * The course tool's side of the H5P editor service (h5p-editor/): signing requests, putting an activity into the
 * editor, taking the finished one out, and forwarding the browser's requests (the editor is reached only through
 * the course tool, never directly).
 *
 * Signing is shared with the service: h5p-editor/auth.mjs is an ES module, so the same short algorithm is repeated
 * here and a test checks the two agree.
 */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const qs = require('qs'); // the same encoder body-parser decodes with, so nested fields such as libraries[] survive the round trip

const BASE = '/h5p-editor';

function sign(secret, timestamp, userId, role) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}\n${userId}\n${role}`).digest('hex');
}

function signedHeaders(secret, user, role = 'author', now = Date.now()) {
  const timestamp = String(now);
  const id = String(user._id || user.id);
  return {
    'x-adapt-ts': timestamp,
    'x-adapt-user': encodeURIComponent(id),
    'x-adapt-name': encodeURIComponent(user.email || user.name || ''),
    'x-adapt-role': role,
    'x-adapt-sig': sign(secret, timestamp, id, role)
  };
}

class EditorError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 502;
  }
}

/**
 * Where the editor service is and the secret shared with it. The service creates the secret on first start in a
 * volume both containers mount (H5P_EDITOR_SECRET_FILE), so nothing has to be configured; H5P_EDITOR_SECRET can
 * override it. Read on every call because the service may start after the course tool does.
 */
function settings(env = process.env) {
  const url = (env.H5P_EDITOR_URL || 'http://h5p-editor:8080').replace(/\/+$/, '');
  let secret = env.H5P_EDITOR_SECRET || '';
  if (!secret) {
    try { secret = fs.readFileSync(env.H5P_EDITOR_SECRET_FILE || '/shared/h5p-editor-secret', 'utf8').trim(); } catch (error) { /* not created yet */ }
  }
  return { enabled: Boolean(url && secret), url, secret };
}

function createClient({ url, secret, fetchImpl = fetch }) {
  const call = async (path, user, role, init = {}) => {
    let response;
    try {
      response = await fetchImpl(`${url}${BASE}${path}`, Object.assign({}, init, { headers: Object.assign({}, init.headers, signedHeaders(secret, user, role)) }));
    } catch (error) {
      throw new EditorError('The H5P editor service is not running. Ask an administrator to start it (see the setup guide).', 503);
    }
    return response;
  };

  return {
    /** Puts an .h5p file into the editor and returns the id to edit. */
    async importPackage(user, file) {
      const form = new FormData();
      form.append('file', new Blob([await fs.promises.readFile(file)]), 'activity.h5p');
      const response = await call('/internal/import', user, 'system', { method: 'POST', body: form });
      if (!response.ok) throw new EditorError(`The editor could not open this activity: ${(await response.text()).slice(0, 200)}`, 502);
      return (await response.json()).contentId;
    },
    /** Removes content from the editor once it has been handed back (failure is not an error: it is purged later). */
    async deleteContent(user, contentId) {
      if (!/^[\w-]+$/.test(String(contentId))) return;
      try { await call(`/internal/content/${encodeURIComponent(contentId)}`, user, 'system', { method: 'DELETE' }); } catch (error) { /* purged later */ }
    },
    /** Writes the finished activity, as a complete .h5p, to destFile. */
    async exportPackage(user, contentId, destFile) {
      if (!/^[\w-]+$/.test(String(contentId))) throw new EditorError('Invalid content id.', 400);
      const response = await call(`/internal/export/${encodeURIComponent(contentId)}`, user, 'system');
      if (!response.ok) throw new EditorError(`The editor could not export the activity: ${(await response.text()).slice(0, 200)}`, 502);
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destFile));
    }
  };
}

/**
 * Express handler that forwards a browser request to the editor service. The caller has already decided the request
 * is allowed. The user's course tool cookies are not passed on.
 */
function createProxy({ getSettings = settings, getUser }) {
  return function proxy(req, res) {
    const { enabled, url, secret } = getSettings();
    if (!enabled) return res.status(503).type('text/plain').send('The H5P editor is not set up on this server.');
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    const user = getUser(req);
    if (!user) return res.status(403).json({ success: false, message: 'Please sign in.' });
    const headers = Object.assign({}, req.headers, signedHeaders(secret, user, 'author'));
    ['cookie', 'authorization', 'connection', 'keep-alive', 'upgrade', 'proxy-authorization', 'te', 'trailer', 'accept-encoding'].forEach(name => delete headers[name]);
    headers.host = target.host;
    let payload = null;
    // body parsers earlier in the course tool may already have read JSON and form bodies
    if (req.body && Object.keys(req.body).length && /json|urlencoded/.test(req.headers['content-type'] || '')) {
      payload = /json/.test(req.headers['content-type']) ? JSON.stringify(req.body) : qs.stringify(req.body);
      headers['content-length'] = Buffer.byteLength(payload);
    }
    const outgoing = transport.request({
      protocol: target.protocol, hostname: target.hostname, port: target.port || (target.protocol === 'https:' ? 443 : 80),
      method: req.method, path: req.originalUrl, headers, timeout: 5 * 60 * 1000
    }, incoming => {
      res.status(incoming.statusCode);
      Object.keys(incoming.headers).forEach(name => { if (!['set-cookie', 'connection', 'keep-alive', 'transfer-encoding'].includes(name)) res.setHeader(name, incoming.headers[name]); });
      incoming.pipe(res);
    });
    outgoing.on('timeout', () => outgoing.destroy(new Error('timeout')));
    outgoing.on('error', () => { if (!res.headersSent) res.status(503).type('text/plain').send('The H5P editor service is not running.'); else res.end(); });
    if (payload !== null) outgoing.end(payload);
    else if (req.readable) req.pipe(outgoing);
    else outgoing.end();
  };
}

/** True when the user has opened an editor session (see h5pEditorRoutes.js) that has not run out. */
function hasEditorSession(user, session, now = Date.now()) {
  return Boolean(user && session && session.h5pEditorUntil > now);
}

module.exports = { hasEditorSession, sign, signedHeaders, settings, createClient, createProxy, EditorError, BASE };
