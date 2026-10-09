// Importing a PowerPoint into a Slides component: the logic (plugins/output/adapt/slidesImport.js) with fake storage,
// and the dialog text (frontend/.../slidesImportReport.js).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const SAMPLE = path.join(__dirname, '..', '..', 'scripts', 'pptx-import', 'test', 'sample.pptx');
const { importDeckIntoComponent, SlidesImportError, hashedName } = require('../../plugins/output/adapt/slidesImport');

let report;
global.define = factory => { report = factory(); };
require(path.join(__dirname, '..', '..', 'frontend', 'src', 'modules', 'editor', 'global', 'slidesImportReport.js'));
delete global.define;

function fakeDeps() {
  const log = { imported: [], cleared: [], linked: [], saved: null };
  let next = 0;
  const byFile = new Map();
  return {
    log,
    deps: {
      async importAsset({ file, data, alt }) {
        log.imported.push({ file, bytes: data.length, alt });
        if (!byFile.has(file)) byFile.set(file, { assetId: 'asset' + (++next), filename: file });
        return byFile.get(file);
      },
      async clearAssetLinks(c) { log.cleared.push(c._id); },
      async linkAsset(c, assetId, filename) { log.linked.push({ component: c._id, assetId, filename }); },
      async saveItems(c, items) { log.saved = { id: c._id, items }; }
    }
  };
}
const slides = () => ({ _id: 'c1', _courseId: 'co', _parentId: 'b1', _component: 'slides', properties: { _items: [{ title: 'old' }] } });

test('fills the component with one item per slide and stores the pictures as linked assets', async () => {
  const { deps, log } = fakeDeps();
  const summary = await importDeckIntoComponent({ pptxPath: SAMPLE, component: slides(), deps });
  assert.strictEqual(log.saved.id, 'c1');
  assert.strictEqual(log.saved.items.length, summary.slides);
  assert.ok(summary.slides >= 3);
  assert.ok(log.saved.items.every(i => typeof i.title === 'string'));
  const withPicture = log.saved.items.filter(i => i._graphic.src);
  assert.ok(withPicture.length >= 1);
  withPicture.forEach(i => assert.match(i._graphic.src, /^course\/assets\/[0-9a-f]{16}\.(png|jpe?g|gif|svg|webp)$/));
  assert.ok(withPicture.some(i => i._graphic.alt === 'A blue library desk'));
  assert.strictEqual(summary.pictures, log.linked.length);
  assert.deepStrictEqual(log.cleared, ['c1'], 'the old slides\' picture links are removed first');
  log.linked.forEach(l => assert.strictEqual(l.component, 'c1'));
});

test('picture file names come from the picture itself, so identical pictures share an asset', () => {
  const a = Buffer.from('same'), b = Buffer.from('other');
  assert.strictEqual(hashedName(a, '.png'), hashedName(Buffer.from('same'), '.png'));
  assert.notStrictEqual(hashedName(a, '.png'), hashedName(b, '.png'));
  assert.match(hashedName(a, '.png'), /^[0-9a-f]{16}\.png$/);
});

test('only Slides components can be filled, and nothing is touched otherwise', async () => {
  const { deps, log } = fakeDeps();
  for (const component of [{ _id: 'x', _component: 'text' }, null, undefined]) {
    await assert.rejects(importDeckIntoComponent({ pptxPath: SAMPLE, component, deps }), e => e instanceof SlidesImportError && /Slides component/.test(e.message));
  }
  assert.strictEqual(log.imported.length + log.cleared.length + log.linked.length, 0);
  assert.strictEqual(log.saved, null);
});

test('a file that is not a PowerPoint is refused before any change is made', async () => {
  const { deps, log } = fakeDeps();
  const fs = require('fs'), os = require('os');
  const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bad-')), 'x.pptx');
  fs.writeFileSync(bad, 'nonsense');
  await assert.rejects(importDeckIntoComponent({ pptxPath: bad, component: slides(), deps }), e => e instanceof SlidesImportError && /not a valid \.pptx/.test(e.message));
  assert.strictEqual(log.saved, null);
  assert.strictEqual(log.cleared.length, 0);
});

const t = (key, o) => key + (o ? ' ' + Object.keys(o).map(k => `${k}=${o[k]}`).join(' ') : '');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

test('the dialog summarises the import and escapes text that came from the file', () => {
  const html = report.buildHtml({ slides: 6, pictures: 2, warnings: ['Slide 4: a <script>x</script> chart was not converted'], noAlt: ['a', 'b'] }, t, esc);
  assert.ok(html.includes('app.importpptxdone slides=6 pictures=2'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('app.importpptxnoalt count=2'));
});

test('the dialog lists at most eight warnings and says how many more there are', () => {
  const warnings = Array.from({ length: 11 }, (_, i) => `w${i}`);
  const html = report.buildHtml({ slides: 1, pictures: 0, warnings, noAlt: [] }, t, esc);
  assert.strictEqual((html.match(/<li/g) || []).length, 9);
  assert.ok(html.includes('app.importpptxmore count=3'));
  assert.ok(!html.includes('app.importpptxnoalt'));
});

// ---- the route handler, run through a real HTTP upload with a permission check that fails like the tool's own ----
const http = require('http');
const express = require('express');
const makeHandler = require('../../plugins/output/adapt/slidesImportRoutes');

async function serve({ component, allowed = true }) {
  const calls = { permission: [], updates: [], assets: [], links: [], destroyed: [] };
  const user = { _id: 'u1', tenant: { _id: 't1' } };
  const componentPlugin = {
    // like helpers.hasCoursePermission: without a _courseId the tool treats the item's _id as a course id and fails
    hasPermission(action, userId, tenantId, item, cb) {
      calls.permission.push(item);
      if (!item._courseId) return cb(new Error(`Course ${item._id} not found`));
      cb(null, allowed);
    },
    update(search, delta, cb) { calls.updates.push({ search, delta }); cb(null, {}); }
  };
  const courseAssetPlugin = { create(data, cb) { calls.links.push(data); cb(null, data); } };
  const app = {
    usermanager: { getCurrentUser: () => user },
    configuration: { getConfig: key => (key === 'maxFileUploadSize' ? 50 * 1024 * 1024 : undefined) },
    contentmanager: { getContentPlugin: (type, cb) => cb(null, type === 'courseasset' ? courseAssetPlugin : componentPlugin) },
    db: {
      retrieve: (type, search, opts, cb) => cb(null, component && search._id === component._id ? [component] : []),
      destroy: (type, search, cb) => { calls.destroyed.push({ type, search }); cb(null); }
    }
  };
  const helpers = {
    importAsset(meta, metadata, cb) {
      calls.assets.push(meta.filename);
      metadata.idMap[meta.oldId] = 'asset-' + meta.filename;
      metadata.assetNameMap['asset-' + meta.filename] = meta.filename;
      cb();
    }
  };
  const server = express();
  server.post('/api/content/component/:id/pptx', makeHandler(app, helpers));
  const httpServer = await new Promise(resolve => { const s = server.listen(0, () => resolve(s)); });
  const url = id => `http://127.0.0.1:${httpServer.address().port}/api/content/component/${id}/pptx`;
  return { calls, url, close: () => httpServer.close() };
}
const upload = async (url, name = 'deck.pptx', bytes = require('fs').readFileSync(SAMPLE)) => {
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  const res = await fetch(url, { method: 'POST', body: form });
  return { status: res.status, json: await res.json() };
};
const COMPONENT_ID = 'a'.repeat(24);
const slidesDoc = () => ({ _id: COMPONENT_ID, _courseId: 'b'.repeat(24), _parentId: 'c'.repeat(24), _component: 'slides', properties: { _isSequenced: true, _items: [] } });

test('route: imports the deck, asks permission WITH the course id, keeps the other settings, links the pictures', async () => {
  const s = await serve({ component: slidesDoc() });
  try {
    const r = await upload(s.url(COMPONENT_ID));
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.success && r.json.payload.slides >= 3);
    assert.strictEqual(s.calls.permission[0]._courseId, 'b'.repeat(24), 'the permission check was given the course id');
    assert.strictEqual(s.calls.updates.length, 1);
    assert.strictEqual(s.calls.updates[0].delta._courseId, 'b'.repeat(24));
    assert.strictEqual(s.calls.updates[0].delta.properties._isSequenced, true, 'other component settings are kept');
    assert.ok(s.calls.updates[0].delta.properties._items.length >= 3);
    assert.strictEqual(s.calls.links.length, r.json.payload.pictures);
    s.calls.links.forEach(l => assert.deepStrictEqual([l._contentType, l._contentTypeId, l._courseId], ['component', COMPONENT_ID, 'b'.repeat(24)]));
    assert.strictEqual(s.calls.destroyed.length, 1);
  } finally { s.close(); }
});

test('route: someone without permission changes nothing', async () => {
  const s = await serve({ component: slidesDoc(), allowed: false });
  try {
    const r = await upload(s.url(COMPONENT_ID));
    assert.strictEqual(r.status, 403);
    assert.strictEqual(s.calls.updates.length + s.calls.assets.length + s.calls.links.length + s.calls.destroyed.length, 0);
  } finally { s.close(); }
});

test('route: unknown component, bad id, wrong component type and wrong file type are refused with a message', async () => {
  const other = Object.assign(slidesDoc(), { _component: 'text' });
  let s = await serve({ component: null });
  try {
    assert.strictEqual((await upload(s.url(COMPONENT_ID))).status, 404);
    assert.strictEqual((await upload(s.url('not-an-id'))).status, 400);
  } finally { s.close(); }
  s = await serve({ component: other });
  try {
    const r = await upload(s.url(COMPONENT_ID));
    assert.strictEqual(r.status, 400);
    assert.match(r.json.message, /Slides component/);
  } finally { s.close(); }
  s = await serve({ component: slidesDoc() });
  try {
    const r = await upload(s.url(COMPONENT_ID), 'notes.docx');
    assert.strictEqual(r.status, 400);
    assert.match(r.json.message, /\.pptx/);
    assert.strictEqual(s.calls.updates.length, 0);
  } finally { s.close(); }
});
