// H5P editor service for the course authoring tool.
//
// Built on Lumi's h5p-nodejs-library (GPL-3.0). It is not reachable by browsers directly: the course tool proxies
// /h5p-editor/* to it after checking the user, and adds a signed header (see auth.mjs). Content and libraries live
// in the data folder; libraries are installed by h5p-library/install.js (never from the editor's own UI).
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import bodyParser from 'body-parser';
import express from 'express';
import fileUpload from 'express-fileupload';
import i18next from 'i18next';
import i18nextFsBackend from 'i18next-fs-backend';
import i18nextHttpMiddleware from 'i18next-http-middleware';
import * as H5P from '@lumieducation/h5p-server';
import { h5pAjaxExpressRouter } from '@lumieducation/h5p-express';
import PermissionSystem from './permissions.mjs';
import renderEditorPage from './renderer.mjs';
import { verifyHeaders } from './auth.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BASE = '/h5p-editor';

/**
 * Builds the Express app. Separate from listening so tests can run it on any port.
 * @param {{dataDir: string, secret: string, coreDir?: string, editorDir?: string}} options
 */
export async function createApp({ dataDir, secret, coreDir = path.join(dataDir, 'core'), editorDir = path.join(dataDir, 'editor') }) {
  if (!secret) throw new Error('H5P_EDITOR_SECRET is not set');
  for (const d of ['libraries', 'content', 'temporary', 'userdata']) fs.mkdirSync(path.join(dataDir, d), { recursive: true });

  const i18n = i18next.createInstance();
  await i18n.use(i18nextFsBackend).use(i18nextHttpMiddleware.LanguageDetector).init({
    backend: { loadPath: path.join(path.dirname(fileURLToPath(import.meta.resolve('@lumieducation/h5p-server'))), 'assets/translations/{{ns}}/{{lng}}.json') },
    defaultNS: 'server',
    fallbackLng: 'en',
    ns: ['client', 'copyright-semantics', 'hub', 'library-metadata', 'metadata-semantics', 'mongo-s3-content-storage', 's3-temporary-storage', 'server', 'storage-file-implementations'],
    preload: ['en']
  });

  // The content type list comes from the libraries we installed; the H5P Hub is not used (no outbound calls, and
  // only vetted libraries can ever be offered).
  const configPath = path.join(dataDir, 'config.json');
  if (!fs.existsSync(configPath)) fs.writeFileSync(configPath, '{}');
  const config = await new H5P.H5PConfig(new H5P.fsImplementations.JsonStorage(configPath)).load();
  config.baseUrl = BASE;
  config.fetchingDisabled = 1;
  config.contentHubEnabled = false;
  config.sendUsageStatistics = false;
  config.maxFileSize = 200 * 1024 * 1024;
  config.maxTotalSize = 400 * 1024 * 1024;
  const permissionSystem = new PermissionSystem();
  const urlGenerator = new H5P.UrlGenerator(config);

  const editor = H5P.fs(
    config,
    path.join(dataDir, 'libraries'),
    path.join(dataDir, 'temporary'),
    path.join(dataDir, 'content'),
    undefined,
    undefined,
    (key, language) => i18n.t(key, { lng: language }),
    urlGenerator,
    { permissionSystem }
  );
  editor.setRenderer(model => model);

  const app = express();
  app.disable('x-powered-by');
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // Everything else needs the course tool's signature.
  app.use((req, res, next) => {
    const user = verifyHeaders(secret, req.headers);
    if (!user) return res.status(401).type('text/plain').send('Not authorised');
    req.user = user;
    next();
  });
  app.use(bodyParser.json({ limit: '400mb' }));
  app.use(bodyParser.urlencoded({ extended: true, limit: '400mb' }));
  app.use(fileUpload({ limits: { fileSize: config.maxTotalSize }, useTempFiles: true, tempFileDir: path.join(dataDir, 'temporary') }));
  app.use(i18nextHttpMiddleware.handle(i18n));

  // The H5P Hub is not used (see above), so the content hub's metadata is empty instead of being fetched
  app.get(`${BASE}/ajax`, (req, res, next) => {
    if (req.query.action !== 'content-hub-metadata-cache') return next();
    res.json({ success: true, data: { languages: [], licenses: [], levels: [], disciplines: [] } });
  });

  // The editor's own endpoints (ajax, libraries, core and editor scripts, content files)
  app.use(BASE, h5pAjaxExpressRouter(editor, coreDir, editorDir, undefined, 'en'));

  const language = req => (req.language || 'en');

  app.get(`${BASE}/edit/:contentId`, async (req, res) => {
    try {
      const model = await editor.render(String(req.params.contentId), language(req), req.user);
      res.type('html').send(renderEditorPage(model));
    } catch (error) { res.status(error.httpStatusCode || 500).type('text/plain').send(error.message); }
  });
  app.post(`${BASE}/edit/:contentId`, async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.params || !body.params.params || !body.params.metadata || !body.library) return res.status(400).send('Malformed request');
      const contentId = await editor.saveOrUpdateContent(String(req.params.contentId), body.params.params, body.params.metadata, body.library, req.user);
      res.json({ contentId });
    } catch (error) { res.status(error.httpStatusCode || 500).type('text/plain').send(error.message); }
  });
  app.get(`${BASE}/new`, async (req, res) => {
    try {
      const model = await editor.render(undefined, language(req), req.user);
      res.type('html').send(renderEditorPage(model));
    } catch (error) { res.status(error.httpStatusCode || 500).type('text/plain').send(error.message); }
  });
  app.post(`${BASE}/new`, async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.params || !body.params.params || !body.params.metadata || !body.library) return res.status(400).send('Malformed request');
      const contentId = await editor.saveOrUpdateContent(undefined, body.params.params, body.params.metadata, body.library, req.user);
      res.json({ contentId });
    } catch (error) { res.status(error.httpStatusCode || 500).type('text/plain').send(error.message); }
  });

  // Course tool only: put an existing .h5p into the editor (returns the id to edit) ...
  app.post(`${BASE}/internal/import`, async (req, res) => {
    if (req.user.role !== 'system') return res.status(403).send('Forbidden');
    try {
      const file = req.files && req.files.file;
      if (!file) return res.status(400).send('No file');
      const { parameters, metadata } = await editor.uploadPackage(file.tempFilePath, req.user);
      if (!parameters || !metadata) return res.status(400).send('That is not an H5P content file');
      // the editor wants the main library as "Name major.minor"
      const main = (metadata.preloadedDependencies || []).find(d => d.machineName === metadata.mainLibrary);
      if (!main) return res.status(400).send('That is not an H5P content file (no main library)');
      const contentId = await editor.saveOrUpdateContent(undefined, parameters, metadata, `${main.machineName} ${main.majorVersion}.${main.minorVersion}`, req.user);
      res.json({ contentId });
    } catch (error) { res.status(error.httpStatusCode || 500).type('text/plain').send(error.message); }
  });
  // ... and take the finished one out as a complete .h5p
  app.get(`${BASE}/internal/export/:contentId`, async (req, res) => {
    if (req.user.role !== 'system') return res.status(403).send('Forbidden');
    try {
      res.type('application/zip');
      const out = new PassThrough();
      out.pipe(res);
      await editor.exportContent(String(req.params.contentId), out, req.user);
    } catch (error) { if (!res.headersSent) res.status(error.httpStatusCode || 500).type('text/plain').send(error.message); else res.end(); }
  });

  // Course tool only: remove content once it has been handed back
  app.delete(`${BASE}/internal/content/:contentId`, async (req, res) => {
    if (req.user.role !== 'system') return res.status(403).send('Forbidden');
    try {
      await editor.deleteContent(String(req.params.contentId), req.user);
      res.json({ deleted: true });
    } catch (error) { res.status(error.httpStatusCode || 500).type('text/plain').send(error.message); }
  });

  return { app, editor, config };
}

/**
 * Removes edited content nobody has touched for `days` days (an author who closed the editor without saving leaves
 * a copy behind). Only direct sub-folders of the content folder are considered.
 */
export function purgeOldContent(contentDir, days, now = Date.now()) {
  let removed = 0;
  if (!fs.existsSync(contentDir)) return removed;
  for (const entry of fs.readdirSync(contentDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(contentDir, entry.name);
    if (now - fs.statSync(dir).mtimeMs > days * 86400 * 1000) { fs.rmSync(dir, { recursive: true, force: true }); removed++; }
  }
  return removed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dataDir = path.resolve(process.env.H5P_EDITOR_DATA || path.join(here, 'data'));
  const { app } = await createApp({ dataDir, secret: process.env.H5P_EDITOR_SECRET });
  const purge = () => { try { purgeOldContent(path.join(dataDir, 'content'), Number(process.env.H5P_EDITOR_KEEP_DAYS || 14)); } catch (error) { console.error('purge failed', error.message); } };
  purge();
  setInterval(purge, 6 * 3600 * 1000).unref();
  const port = Number(process.env.PORT || 8080);
  app.listen(port, () => console.log(`H5P editor listening on ${port}`));
}
