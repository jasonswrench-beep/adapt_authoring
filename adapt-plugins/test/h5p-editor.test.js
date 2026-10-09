// The course tool's side of the H5P editor: settings, who may reach the editor, the start/finish routes (with a fake
// editor service and fake storage), and the proxy that forwards a signed-in author's requests.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const http = require('http');
const os = require('os');
const path = require('path');

const client = require('../../plugins/output/adapt/h5pEditorClient');
const handler = require('../../plugins/output/adapt/h5pEditorRoutes');
const { assemble } = require('../../h5p-library/assemble');

const SECRET = 'a-long-test-secret';
const ID = 'a'.repeat(24);

test('settings: environment secret, secret file, or off', async () => {
  assert.deepStrictEqual(client.settings({ H5P_EDITOR_SECRET: 's', H5P_EDITOR_URL: 'http://x:1/' }), { enabled: true, url: 'http://x:1', secret: 's' });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p-secret-'));
  await fs.writeFile(path.join(dir, 'secret'), 'from-file\n');
  assert.strictEqual(client.settings({ H5P_EDITOR_SECRET_FILE: path.join(dir, 'secret') }).secret, 'from-file');
  assert.strictEqual(client.settings({ H5P_EDITOR_SECRET_FILE: path.join(dir, 'missing') }).enabled, false);
  assert.strictEqual(client.settings({ H5P_EDITOR_SECRET_FILE: path.join(dir, 'missing') }).url, 'http://h5p-editor:8080');
});

test('only a signed-in user with an unexpired editor session may reach the editor', () => {
  const now = 1000;
  assert.strictEqual(client.hasEditorSession({ _id: 'u' }, { h5pEditorUntil: now + 1 }, now), true);
  assert.strictEqual(client.hasEditorSession({ _id: 'u' }, { h5pEditorUntil: now - 1 }, now), false);
  assert.strictEqual(client.hasEditorSession({ _id: 'u' }, {}, now), false);
  assert.strictEqual(client.hasEditorSession({ _id: 'u' }, undefined, now), false);
  assert.strictEqual(client.hasEditorSession(null, { h5pEditorUntil: now + 1 }, now), false);
});

test('only paths on this site are accepted as the place to return to', () => {
  const { safeReturn } = handler;
  assert.strictEqual(safeReturn('/#editor/1/page/2'), '/#editor/1/page/2');
  for (const bad of ['//evil.example', 'https://evil.example', 'javascript:alert(1)', '/\\evil', '/a b', '', undefined, 5]) assert.strictEqual(safeReturn(bad), '/', String(bad));
});

/** A stand-in for the editor service: checks the signature like the real one, then answers import and export. */
async function fakeEditor(exportFile) {
  const seen = [];
  const { verifyHeaders } = await import('../../h5p-editor/auth.mjs');
  const server = http.createServer((req, res) => {
    const user = verifyHeaders(SECRET, req.headers);
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, user, body: Buffer.concat(chunks), headers: req.headers });
      if (!user) { res.statusCode = 401; return res.end('no'); }
      if (req.method === 'DELETE') { res.setHeader('content-type', 'application/json'); return res.end('{"deleted":true}'); }
      if (req.url === '/h5p-editor/internal/import') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ contentId: '4242' })); }
      if (req.url.startsWith('/h5p-editor/internal/export/')) { res.setHeader('content-type', 'application/zip'); return res.end(fs.readFileSync(exportFile)); }
      res.setHeader('content-type', 'text/plain'); res.statusCode = req.url.includes('missing') ? 404 : 200; res.end(`${req.method} ${req.url}`);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() };
}

async function realPackage() {
  // a complete small .h5p built from fake libraries, so the finish route can read and approve it
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p-ed-test-'));
  const libs = path.join(dir, 'libs');
  await fs.outputJson(path.join(libs, 'H5P.Main-1.0', 'library.json'), { preloadedDependencies: [] });
  await fs.outputFile(path.join(libs, 'H5P.Main-1.0', 'code.js'), '//');
  const stage = path.join(dir, 'stage');
  await fs.outputJson(path.join(stage, 'h5p.json'), { title: 'Edited', mainLibrary: 'H5P.Main', preloadedDependencies: [{ machineName: 'H5P.Main', majorVersion: '1', minorVersion: '0' }] });
  await fs.outputJson(path.join(stage, 'content', 'content.json'), { a: 1 });
  const archiver = require('archiver');
  const content = path.join(dir, 'content.h5p');
  await new Promise((resolve, reject) => { const out = fs.createWriteStream(content); const a = archiver('zip'); out.on('close', resolve); a.on('error', reject); a.pipe(out); a.glob('**/*', { cwd: stage, dot: true }); a.finalize(); });
  const complete = path.join(dir, 'complete.h5p');
  await assemble({ contentFile: content, libraryDir: libs, outFile: complete });
  return complete;
}

function fakeApp({ allowed = true, component } = {}) {
  const log = { destroyed: 0, updated: [], linked: [], imported: [] };
  const comp = component === undefined ? { _id: ID, _courseId: 'co', _parentId: 'pa', _component: 'h5pPlayer', properties: { _h5p: { _src: '' } } } : component;
  return {
    log,
    app: {
      configuration: { serverRoot: os.tmpdir(), getConfig: () => undefined },
      usermanager: { getCurrentUser: () => ({ _id: 'u1', email: 'a@b.edu', tenant: { _id: 't1' } }) },
      db: { retrieve: (t, q, o, cb) => cb(null, comp && q._id === comp._id ? [comp] : []), destroy: (t, q, cb) => { log.destroyed++; cb(); } },
      contentmanager: {
        getContentPlugin: (type, cb) => cb(null, {
          hasPermission: (a, u, t, c, done) => done(null, allowed),
          update: (q, c, done) => { log.updated.push(c); done(); },
          create: (c, done) => { log.linked.push(c); done(); }
        })
      }
    },
    helpers: { importAsset: (meta, md, cb) => { log.imported.push(meta); md.idMap[meta.oldId] = 'asset1'; md.assetNameMap.asset1 = meta.filename; cb(); } }
  };
}
const res = () => { const r = { statusCode: 200, body: undefined, status(c) { r.statusCode = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const req = (body, id = ID) => ({ params: { id }, body, session: {} });

test('start: the editor not being set up is said plainly and nothing happens', async () => {
  const { app, helpers, log } = fakeApp();
  const r = res();
  await handler(app, helpers, () => ({}), { H5P_EDITOR_SECRET_FILE: '/nowhere' }).start(req({ mode: 'new' }), r);
  assert.strictEqual(r.statusCode, 503);
  assert.match(r.body.message, /not set up/);
  assert.strictEqual(log.updated.length, 0);
});

test('start and finish: without permission nothing is sent to the editor, approved, stored or changed', async () => {
  const editor = await fakeEditor(await realPackage());
  try {
    const { app, helpers, log } = fakeApp({ allowed: false });
    const routes = handler(app, helpers, () => ({ autoApprove: async () => { throw new Error('must not be reached'); } }), { H5P_EDITOR_URL: editor.url, H5P_EDITOR_SECRET: SECRET });
    for (const [fn, body] of [['start', { mode: 'new' }], ['finish', { contentId: '4242' }]]) {
      const r = res(); const rq = req(body);
      await routes[fn](rq, r);
      assert.strictEqual(r.statusCode, 403, fn);
      assert.strictEqual(rq.session.h5pEditorUntil, undefined, 'no editor session is opened');
    }
    assert.strictEqual(editor.seen.length, 0);
    assert.strictEqual(log.updated.length + log.imported.length, 0);
  } finally { editor.close(); }
});

test('start (new) opens an editor session and returns the editor address, with a safe return path', async () => {
  const editor = await fakeEditor(await realPackage());
  try {
    const { app, helpers } = fakeApp();
    const routes = handler(app, helpers, () => ({}), { H5P_EDITOR_URL: editor.url, H5P_EDITOR_SECRET: SECRET });
    const rq = req({ mode: 'new', returnTo: '//evil.example' });
    const r = res();
    await routes.start(rq, r);
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(r.body.payload.url, `/h5p-editor/new?component=${ID}&return=%2F`);
    assert.ok(rq.session.h5pEditorUntil > Date.now());
  } finally { editor.close(); }
});

test('start (edit) on a component with no activity asks the author to choose one first', async () => {
  const editor = await fakeEditor(await realPackage());
  try {
    const { app, helpers } = fakeApp();
    const r = res(); const rq = req({ mode: 'edit' });
    await handler(app, helpers, () => ({}), { H5P_EDITOR_URL: editor.url, H5P_EDITOR_SECRET: SECRET }).start(rq, r);
    assert.strictEqual(r.statusCode, 400);
    assert.match(r.body.message, /no activity yet/);
    assert.strictEqual(rq.session.h5pEditorUntil, undefined);
  } finally { editor.close(); }
});

test('start refuses components that are not H5P Player components', async () => {
  const editor = await fakeEditor(await realPackage());
  try {
    const { app, helpers } = fakeApp({ component: { _id: ID, _courseId: 'co', _component: 'text', properties: {} } });
    const r = res();
    await handler(app, helpers, () => ({}), { H5P_EDITOR_URL: editor.url, H5P_EDITOR_SECRET: SECRET }).start(req({ mode: 'new' }), r);
    assert.strictEqual(r.statusCode, 400);
  } finally { editor.close(); }
});

test('finish takes the finished activity from the editor, approves it, stores it and points the component at it', async () => {
  const pkg = await realPackage();
  const editor = await fakeEditor(pkg);
  try {
    const { app, helpers, log } = fakeApp();
    const approvals = [];
    const routes = handler(app, helpers, () => ({ autoApprove: async (hash, info, label) => { approvals.push({ hash, info, label }); return true; } }), { H5P_EDITOR_URL: editor.url, H5P_EDITOR_SECRET: SECRET });
    const r = res();
    await routes.finish(req({ contentId: '4242' }), r);
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
    assert.strictEqual(editor.seen[0].url, '/h5p-editor/internal/export/4242');
    assert.strictEqual(editor.seen[0].user.role, 'system', 'the export is requested as the course tool, not as the author');
    assert.strictEqual(approvals.length, 1);
    assert.match(approvals[0].label, /a@b\.edu using the H5P editor/);
    assert.strictEqual(approvals[0].info.mainLibrary, 'H5P.Main');
    assert.strictEqual(log.imported.length, 1);
    assert.deepStrictEqual(log.updated[0].properties._h5p, { _src: 'course/assets/' + log.imported[0].filename });
    assert.strictEqual(log.linked.length, 1);
    assert.strictEqual(log.destroyed, 1);
    assert.ok(editor.seen.some(x => x.method === 'DELETE' && x.url === '/h5p-editor/internal/content/4242' && x.user.role === 'system'), 'the finished content is removed from the editor');
  } finally { editor.close(); }
});

test('finish refuses a malformed content id, and a file an administrator rejected is not attached', async () => {
  const editor = await fakeEditor(await realPackage());
  try {
    const { app, helpers, log } = fakeApp();
    const routes = handler(app, helpers, () => ({ autoApprove: async () => false }), { H5P_EDITOR_URL: editor.url, H5P_EDITOR_SECRET: SECRET });
    let r = res();
    await routes.finish(req({ contentId: '../../x' }), r);
    assert.strictEqual(r.statusCode, 400);
    r = res();
    await routes.finish(req({}), r);
    assert.strictEqual(r.statusCode, 400, 'a missing content id is refused too');
    r = res();
    await routes.finish(req({ contentId: '4242' }), r);
    assert.strictEqual(r.statusCode, 403);
    assert.strictEqual(log.updated.length + log.imported.length + log.linked.length, 0);
  } finally { editor.close(); }
});

test('finish says so when the editor service is not running', async () => {
  const { app, helpers } = fakeApp();
  const r = res();
  await handler(app, helpers, () => ({}), { H5P_EDITOR_URL: 'http://127.0.0.1:1', H5P_EDITOR_SECRET: SECRET }).finish(req({ contentId: '4242' }), r);
  assert.strictEqual(r.statusCode, 503);
  assert.match(r.body.message, /not running/);
});

test('the proxy signs the request, keeps the path, drops cookies, resends a parsed JSON body and passes the answer back', async () => {
  const editor = await fakeEditor(await realPackage());
  try {
    const proxy = client.createProxy({ getSettings: () => ({ enabled: true, url: editor.url, secret: SECRET }), getUser: () => ({ _id: 'u1', email: 'a@b.edu' }) });
    const run = request => new Promise(resolve => {
      const response = { headers: {}, statusCode: 200, status(c) { response.statusCode = c; return response; }, setHeader(k, v) { response.headers[k] = v; }, type() { return response; }, send(b) { resolve({ status: response.statusCode, body: b }); return response; }, json(b) { resolve({ status: response.statusCode, body: JSON.stringify(b) }); return response; }, write() {}, end(b) { resolve({ status: response.statusCode, body: b }); return response; }, on() { return response; }, once() { return response; }, emit() { return response; }, removeListener() { return response; } };
      proxy(request, response);
    });
    const body = await run({ method: 'POST', originalUrl: '/h5p-editor/edit/9?component=x&return=/', headers: { cookie: 'connect.sid=secret', 'content-type': 'application/json', 'content-length': '2' }, body: { library: 'H5P.Main 1.0' }, readable: false });
    void body;
    await new Promise(resolve => setTimeout(resolve, 200));
    const seen = editor.seen[0];
    assert.strictEqual(seen.url, '/h5p-editor/edit/9?component=x&return=/');
    assert.strictEqual(seen.method, 'POST');
    assert.strictEqual(seen.user.id, 'u1');
    assert.strictEqual(seen.user.role, 'author');
    assert.strictEqual(seen.headers.cookie, undefined, 'the course tool session cookie must not reach the editor');
    assert.deepStrictEqual(JSON.parse(seen.body.toString()), { library: 'H5P.Main 1.0' });
  } finally { editor.close(); }
});

test('the proxy refuses when there is no user and when the editor is off', () => {
  const answer = [];
  const response = { status(c) { answer.push(c); return response; }, json() { return response; }, type() { return response; }, send() { return response; } };
  client.createProxy({ getSettings: () => ({ enabled: true, url: 'http://x', secret: 's' }), getUser: () => null })({ headers: {}, originalUrl: '/h5p-editor/x', method: 'GET' }, response);
  client.createProxy({ getSettings: () => ({ enabled: false }), getUser: () => ({ _id: 'u' }) })({ headers: {}, originalUrl: '/h5p-editor/x', method: 'GET' }, response);
  assert.deepStrictEqual(answer, [403, 503]);
});

test('start (edit) sends the component\'s current activity to the editor and returns the edit address', async () => {
  const pkg = await realPackage();
  const editor = await fakeEditor(pkg);
  try {
    const { app, helpers } = fakeApp({ component: { _id: ID, _courseId: 'co', _component: 'h5pPlayer', properties: { _h5p: { _src: 'course/assets/x.h5p' } } } });
    const rq = req({ mode: 'edit', returnTo: '/#editor/1/component/2/edit' });
    const r = res();
    await handler(app, helpers, () => ({}), { H5P_EDITOR_URL: editor.url, H5P_EDITOR_SECRET: SECRET }, { currentPackage: async () => pkg, notEditable: () => [] }).start(rq, r);
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.payload.url, `/h5p-editor/edit/4242?component=${ID}&return=${encodeURIComponent('/#editor/1/component/2/edit')}`);
    assert.strictEqual(editor.seen[0].url, '/h5p-editor/internal/import');
    assert.strictEqual(editor.seen[0].user.role, 'system');
    assert.ok(editor.seen[0].body.length > 100, 'the activity file was sent');
    assert.ok(rq.session.h5pEditorUntil > Date.now());
  } finally { editor.close(); }
});

test('start (edit) says so, and sends nothing, for an activity whose editing widgets are not installed', async () => {
  const pkg = await realPackage();
  const editor = await fakeEditor(pkg);
  try {
    const { app, helpers } = fakeApp({ component: { _id: ID, _courseId: 'co', _component: 'h5pPlayer', properties: { _h5p: { _src: 'course/assets/x.h5p' } } } });
    const rq = req({ mode: 'edit' });
    const r = res();
    await handler(app, helpers, () => ({}), { H5P_EDITOR_URL: editor.url, H5P_EDITOR_SECRET: SECRET }, { currentPackage: async () => pkg, notEditable: () => ['H5P.Main'] }).start(rq, r);
    assert.strictEqual(r.statusCode, 400);
    assert.match(r.body.message, /not edited in this tool/);
    assert.strictEqual(editor.seen.length, 0);
    assert.strictEqual(rq.session.h5pEditorUntil, undefined);
  } finally { editor.close(); }
});

test('the proxy resends a form body that the course tool already parsed, keeping nested fields such as libraries[]', async () => {
  const editor = await fakeEditor(await realPackage());
  try {
    const qs = require('qs');
    const proxy = client.createProxy({ getSettings: () => ({ enabled: true, url: editor.url, secret: SECRET }), getUser: () => ({ _id: 'u1' }) });
    const original = 'libraries%5B%5D=H5P.MultiChoice%201.16&libraries%5B%5D=H5P.TrueFalse%201.8';
    const response = { statusCode: 200, status() { return response; }, setHeader() {}, type() { return response; }, send() { return response; }, json() { return response; }, write() {}, end() { return response; }, on() { return response; }, once() { return response; }, emit() { return response; }, removeListener() { return response; } };
    proxy({ method: 'POST', originalUrl: '/h5p-editor/ajax?action=libraries', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: qs.parse(original), readable: false }, response);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.deepStrictEqual(qs.parse(editor.seen[0].body.toString()), { libraries: ['H5P.MultiChoice 1.16', 'H5P.TrueFalse 1.8'] });
  } finally { editor.close(); }
});
