// The H5P activity library: catalogue sanity, library-reference scanning, package assembly, the "add activity" logic
// (with fake storage), and the gallery's filter helpers.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const yauzl = require('yauzl');

const ROOT = path.join(__dirname, '..', '..', 'h5p-library');
const catalogue = require(path.join(ROOT, 'catalogue.json'));
const lock = require(path.join(ROOT, 'lock.json'));
const { subContentLibraries, requirementsOf } = require(path.join(ROOT, 'requirements.js'));
const { closure, assemble, cleanPackage } = require(path.join(ROOT, 'assemble.js'));
const { addActivityToComponent, loadCatalogue, LibraryError } = require('../../plugins/output/adapt/h5pLibrary');

let filter;
global.define = factory => { filter = factory(); };
require(path.join(__dirname, '..', '..', 'frontend', 'src', 'modules', 'editor', 'global', 'h5pLibraryFilter.js'));
delete global.define;

const listZip = file => new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true }, (e, zip) => {
  if (e) return reject(e);
  const names = [];
  zip.on('entry', entry => { names.push(entry.fileName); zip.readEntry(); });
  zip.on('end', () => resolve(names));
  zip.readEntry();
}));

/** A tiny fake library folder: Main needs Dep, Dep needs Leaf. */
async function fakeLibraries() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p-lib-test-'));
  const add = async (key, deps) => {
    await fs.outputJson(path.join(dir, key, 'library.json'), { preloadedDependencies: deps.map(d => { const m = /^(.+)-(\d+)\.(\d+)$/.exec(d); return { machineName: m[1], majorVersion: +m[2], minorVersion: +m[3] }; }) });
    await fs.outputFile(path.join(dir, key, 'code.js'), `// ${key}`);
  };
  await add('H5P.Main-1.0', ['H5P.Dep-1.0']);
  await add('H5P.Dep-1.0', ['H5P.Leaf-1.0']);
  await add('H5P.Leaf-1.0', []);
  await add('H5P.Extra-2.1', []);
  return dir;
}

async function contentZip(dir, contentJson) {
  const AdmZip = (() => { try { return require('adm-zip'); } catch (e) { return null; } })();
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p-content-test-'));
  await fs.outputJson(path.join(stage, 'h5p.json'), { title: 'T', mainLibrary: 'H5P.Main', preloadedDependencies: [{ machineName: 'H5P.Main', majorVersion: '1', minorVersion: '0' }] });
  await fs.outputJson(path.join(stage, 'content', 'content.json'), contentJson);
  const archiver = require('archiver');
  const file = path.join(dir, 'content.h5p');
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    const archive = archiver('zip');
    out.on('close', resolve); archive.on('error', reject); archive.pipe(out);
    archive.glob('**/*', { cwd: stage, dot: true });
    archive.finalize();
  });
  void AdmZip;
  return file;
}

test('every catalogue entry has what the gallery shows, and a content file', () => {
  const ids = new Set();
  for (const a of catalogue) {
    assert.ok(/^[a-z0-9-]+$/.test(a.id), `${a.id}: id`);
    assert.ok(!ids.has(a.id), `${a.id}: duplicate`);
    ids.add(a.id);
    for (const field of ['title', 'category', 'summary', 'bestFor']) assert.ok(a[field] && a[field].length >= 5, `${a.id}: ${field}`);
    assert.ok(['activity', 'viewed'].includes(a.completion), `${a.id}: completion`);
    assert.ok(fs.existsSync(path.join(ROOT, 'content', a.file)), `${a.id}: content file`);
  }
});

test('every library an activity needs is pinned to a commit in the lock file', async () => {
  for (const a of catalogue) {
    for (const key of await requirementsOf(path.join(ROOT, 'content', a.file))) {
      assert.ok(lock[key], `${a.id} needs ${key}, which is not in lock.json`);
      assert.match(lock[key].commit, /^[a-f0-9]{40}$/, `${key}: commit`);
    }
  }
});

test('subContentLibraries finds library references at any depth', () => {
  const found = subContentLibraries({ a: [{ library: 'H5P.Image 1.1', params: { b: { library: 'H5P.Text 1.1' } } }], library: 'not a library', other: 'H5P.X 1.0' });
  assert.deepStrictEqual([...found].sort(), ['H5P.Image-1.1', 'H5P.Text-1.1']);
});

test('closure lists dependencies before the libraries that need them and tolerates cycles', () => {
  const libs = { 'A-1.0': ['B-1.0'], 'B-1.0': ['C-1.0'], 'C-1.0': ['A-1.0'] };
  const read = key => ({ preloadedDependencies: libs[key].map(k => { const m = /^(.+)-(\d+)\.(\d+)$/.exec(k); return { machineName: m[1], majorVersion: +m[2], minorVersion: +m[3] }; }) });
  assert.deepStrictEqual(closure([{ machineName: 'A', majorVersion: 1, minorVersion: 0 }], read), ['C-1.0', 'B-1.0', 'A-1.0']);
});

test('assemble adds the main library, sub-content libraries and their dependencies, with readable content', async () => {
  const libs = await fakeLibraries();
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p-asm-test-'));
  const file = await contentZip(work, { child: { library: 'H5P.Extra 2.1', x: 1 }, other: { library: 'H5P.Extra 2.1' } });
  const out = path.join(work, 'out.h5p');
  const { libraries } = await assemble({ contentFile: file, libraryDir: libs, outFile: out });
  assert.deepStrictEqual(libraries, ['H5P.Leaf-1.0', 'H5P.Dep-1.0', 'H5P.Main-1.0', 'H5P.Extra-2.1']);
  const names = await listZip(out);
  for (const n of ['h5p.json', 'content/content.json', 'H5P.Leaf-1.0/code.js', 'H5P.Main-1.0/library.json', 'H5P.Extra-2.1/code.js']) assert.ok(names.includes(n), n);
  // the zip must be readable by a standard extractor with correct sizes
  const { extractZipSafely } = require('../../plugins/output/adapt/h5pPackaging');
  const dest = path.join(work, 'x');
  await extractZipSafely(out, dest);
  const meta = await fs.readJson(path.join(dest, 'h5p.json'));
  assert.deepStrictEqual(meta.preloadedDependencies.map(d => d.machineName), ['H5P.Leaf', 'H5P.Dep', 'H5P.Main', 'H5P.Extra']);
  assert.strictEqual((await fs.readJson(path.join(dest, 'content', 'content.json'))).other.library, 'H5P.Extra 2.1');
  assert.strictEqual(await fs.readFile(path.join(dest, 'H5P.Dep-1.0', 'code.js'), 'utf8'), '// H5P.Dep-1.0');
});

test('assemble names the missing library clearly', async () => {
  const libs = await fakeLibraries();
  await fs.remove(path.join(libs, 'H5P.Leaf-1.0'));
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p-asm-test-'));
  const file = await contentZip(work, {});
  await assert.rejects(assemble({ contentFile: file, libraryDir: libs, outFile: path.join(work, 'o.h5p') }), /H5P\.Leaf-1\.0 is not installed \(needed by H5P\.Dep-1\.0\)/);
});

/** A catalogue root with one activity whose "libraries" are the fake ones. */
async function fakeRoot(completion) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p-root-test-'));
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p-c-test-'));
  const content = await contentZip(work, { a: 1 });
  await fs.copy(content, path.join(root, 'content', 'main.h5p'));
  await fs.outputJson(path.join(root, 'catalogue.json'), [{ id: 'main', file: 'main.h5p', title: 'Main thing', category: 'Test', summary: 'summary text', bestFor: 'best for text', completion, notes: 'a note' }]);
  await fs.outputJson(path.join(root, 'lock.json'), { 'H5P.Main-1.0': {}, 'H5P.Dep-1.0': {}, 'H5P.Leaf-1.0': {}, 'H5P.Extra-2.1': {} });
  return root;
}

function fakeDeps({ approve = true } = {}) {
  const log = { approved: [], imported: [], cleared: 0, linked: [], saved: null };
  return {
    log,
    deps: {
      async approve(hash, info, label) { log.approved.push({ hash, info, label }); return approve; },
      async importAsset(a) { log.imported.push(a); return { assetId: 'asset1', filename: 'stored.h5p' }; },
      async clearAssetLinks() { log.cleared++; },
      async linkAsset(c, id, name) { log.linked.push([id, name]); },
      async saveComponent(c, changes) { log.saved = changes; }
    }
  };
}

test('adding an activity approves it, stores it once, links it and sets the completion mode', async () => {
  const root = await fakeRoot('activity');
  const libs = await fakeLibraries();
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p-cache-test-'));
  const component = { _id: 'c1', _component: 'h5pPlayer', properties: { _h5p: { _src: '', _minHeight: 300 } } };
  const first = fakeDeps();
  const summary = await addActivityToComponent({ activityId: 'main', component, deps: first.deps, libraryDir: libs, cacheDir: cache, root });
  assert.strictEqual(summary.title, 'Main thing');
  assert.strictEqual(first.log.saved._setCompletionOn, 'completed');
  assert.deepStrictEqual(first.log.saved._h5p, { _src: 'course/assets/stored.h5p', _minHeight: 300 });
  assert.deepStrictEqual(first.log.linked, [['asset1', 'stored.h5p']]);
  assert.match(first.log.approved[0].hash, /^[a-f0-9]{64}$/);
  assert.strictEqual(first.log.approved[0].info.mainLibrary, 'H5P.Main');
  assert.strictEqual(first.log.approved[0].label, 'the H5P activity library');
  assert.match(first.log.imported[0].file, /^[a-f0-9]{40}\.h5p$/);

  // choosing the same activity again produces identical bytes, so one approval and one asset serve every use
  const second = fakeDeps();
  await addActivityToComponent({ activityId: 'main', component, deps: second.deps, libraryDir: libs, cacheDir: cache, root });
  assert.strictEqual(second.log.approved[0].hash, first.log.approved[0].hash);
  assert.strictEqual(second.log.imported[0].file, first.log.imported[0].file);
});

test('view-only activities complete when viewed', async () => {
  const root = await fakeRoot('viewed');
  const { deps, log } = fakeDeps();
  await addActivityToComponent({ activityId: 'main', component: { _id: 'c', _component: 'h5pPlayer', properties: {} }, deps, libraryDir: await fakeLibraries(), cacheDir: await fs.mkdtemp(path.join(os.tmpdir(), 'k-')), root });
  assert.strictEqual(log.saved._setCompletionOn, 'inview');
});

test('refuses other component types, unknown ids, rejected files and missing libraries, changing nothing', async () => {
  const root = await fakeRoot('activity');
  const libs = await fakeLibraries();
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'k-'));
  const run = (activityId, component, extra, depsOptions) => {
    const f = fakeDeps(depsOptions);
    return addActivityToComponent(Object.assign({ activityId, component, deps: f.deps, libraryDir: libs, cacheDir: cache, root }, extra)).then(() => f.log, e => { e.log = f.log; throw e; });
  };
  const good = { _id: 'c', _component: 'h5pPlayer', properties: {} };
  await assert.rejects(run('main', { _id: 'c', _component: 'text' }), /only works on an H5P Player/);
  await assert.rejects(run('nope', good), e => e instanceof LibraryError && e.status === 404);
  await assert.rejects(run('../x', good), e => e.status === 404);
  await assert.rejects(run('main', good, null, { approve: false }), e => { assert.strictEqual(e.status, 403); assert.strictEqual(e.log.saved, null); assert.strictEqual(e.log.imported.length, 0); return true; });
  await assert.rejects(run('main', good, { libraryDir: path.join(os.tmpdir(), 'no-such-libs') }), e => e.status === 503);
});

test('loadCatalogue marks activities unavailable until every locked library is installed', async () => {
  const root = await fakeRoot('activity');
  const libs = await fakeLibraries();
  assert.strictEqual((await loadCatalogue({ libraryDir: libs, root }))[0].available, true);
  await fs.remove(path.join(libs, 'H5P.Extra-2.1'));
  assert.strictEqual((await loadCatalogue({ libraryDir: libs, root }))[0].available, false);
});

test('gallery filter: category, words from any field, and categories in first-seen order', () => {
  const list = [
    { title: 'Multiple Choice', summary: 'pick answers', bestFor: 'quick checks', category: 'Check' },
    { title: 'Timeline', summary: 'dates', bestFor: 'history', category: 'Explore' },
    { title: 'Quiz', summary: 'mixed', bestFor: 'end of lesson', category: 'Check' }
  ];
  assert.deepStrictEqual(filter.categories(list), ['Check', 'Explore']);
  assert.strictEqual(filter.filter(list, 'Check', '').length, 2);
  assert.deepStrictEqual(filter.filter(list, '', 'HISTORY').map(a => a.title), ['Timeline']);
  assert.deepStrictEqual(filter.filter(list, '', 'quick answers').map(a => a.title), ['Multiple Choice']);
  assert.strictEqual(filter.filter(list, 'Explore', 'quiz').length, 0);
});

// ---- routes (fake app: no database) ----
function fakeApp({ allowed = true, component = { _id: 'a'.repeat(24), _courseId: 'co', _component: 'h5pPlayer', properties: {} } } = {}) {
  const calls = { destroyed: 0, updated: 0 };
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'h5p-app-test-'));
  return {
    calls,
    app: {
      configuration: { serverRoot: dataRoot, getConfig: k => (k === 'dataRoot' ? 'data' : undefined) },
      usermanager: { getCurrentUser: () => ({ _id: 'u1', tenant: { _id: 't1' } }) },
      db: { retrieve: (type, q, o, cb) => cb(null, component && q._id === component._id ? [component] : []), destroy: (t, q, cb) => { calls.destroyed++; cb(); } },
      contentmanager: {
        getContentPlugin: (type, cb) => cb(null, {
          hasPermission: (action, user, tenant, content, done) => done(null, allowed),
          update: (q, c, done) => { calls.updated++; done(); },
          create: (c, done) => done()
        })
      }
    }
  };
}
function fakeRes() {
  const res = { statusCode: 200, body: undefined, status(c) { res.statusCode = c; return res; }, json(b) { res.body = b; return res; }, end() { return res; }, set() { return res; }, type() { return res; } };
  return res;
}
const routes = (app, approvals) => require('../../plugins/output/adapt/h5pLibraryRoutes')(app, { importAsset: (m, md, cb) => cb(new Error('must not be reached')) }, () => approvals || { autoApprove: async () => { throw new Error('must not be reached'); } });

test('routes: a bad component id is refused', async () => {
  const { app } = fakeApp();
  const res = fakeRes();
  await routes(app).add({ params: { id: 'nope' }, body: { activity: 'multiple-choice' } }, res);
  assert.strictEqual(res.statusCode, 400);
});

test('routes: an unknown component is a 404', async () => {
  const { app } = fakeApp({ component: null });
  const res = fakeRes();
  await routes(app).list({ params: { id: 'b'.repeat(24) } }, res);
  assert.strictEqual(res.statusCode, 404);
});

test('routes: without permission nothing is listed, approved, stored or changed', async () => {
  const { app, calls } = fakeApp({ allowed: false });
  for (const fn of ['list', 'add']) {
    const res = fakeRes();
    await routes(app)[fn]({ params: { id: 'a'.repeat(24) }, body: { activity: 'multiple-choice' } }, res);
    assert.strictEqual(res.statusCode, 403, fn);
  }
  assert.strictEqual(calls.destroyed + calls.updated, 0);
});

test('routes: the catalogue is listed, as unavailable until the libraries are installed', async () => {
  const { app } = fakeApp();
  const res = fakeRes();
  await routes(app).list({ params: { id: 'a'.repeat(24) } }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.payload.length, catalogue.length);
  assert.ok(res.body.payload.every(a => a.available === false));
});

test('routes: choosing an activity before the libraries are installed says so and changes nothing', async () => {
  const { app, calls } = fakeApp();
  const res = fakeRes();
  await routes(app).add({ params: { id: 'a'.repeat(24) }, body: { activity: 'multiple-choice' } }, res);
  assert.strictEqual(res.statusCode, 503);
  assert.match(res.body.message, /update routine/);
  assert.strictEqual(calls.destroyed + calls.updated, 0);
});

test('routes: thumbnails are only served for catalogue-shaped names', async () => {
  const { app } = fakeApp();
  for (const [name, expected] of [['../../package', 404], ['multiple-choice', 200], ['nope', 404]]) {
    const res = fakeRes();
    res.pipeTarget = true;
    await routes(app).thumb({ params: { id: 'a'.repeat(24), activity: name } }, Object.assign(res, { on() { return res; }, once() { return res; }, emit() { return res; }, write() {}, removeListener() { return res; } }));
    if (expected === 404) assert.strictEqual(res.statusCode, 404, name);
  }
});

test('cleanPackage drops files H5P refuses inside library folders and keeps everything else, as a readable zip', async () => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p-tidy-test-'));
  const stage = path.join(work, 'stage');
  await fs.outputJson(path.join(stage, 'h5p.json'), { title: 'T', mainLibrary: 'H5P.Main' });
  await fs.outputJson(path.join(stage, 'content', 'content.json'), { a: 1 });
  await fs.outputFile(path.join(stage, 'content', 'images', 'pic.png'), 'png');
  await fs.outputJson(path.join(stage, 'H5P.Main-1.0', 'library.json'), { machineName: 'H5P.Main' });
  await fs.outputFile(path.join(stage, 'H5P.Main-1.0', 'main.js'), '//js');
  await fs.outputFile(path.join(stage, 'H5P.Main-1.0', 'main.css'), '/*css*/');
  await fs.outputFile(path.join(stage, 'H5P.Main-1.0', 'LICENSE'), 'licence');
  await fs.outputFile(path.join(stage, 'H5P.Main-1.0', 'eslint.config.mjs'), 'x');
  await fs.outputFile(path.join(stage, 'H5P.Main-1.0', 'crowdin.yml'), 'x');
  const archiver = require('archiver');
  const dirty = path.join(work, 'dirty.h5p');
  await new Promise((resolve, reject) => { const out = fs.createWriteStream(dirty); const a = archiver('zip'); out.on('close', resolve); a.on('error', reject); a.pipe(out); a.glob('**/*', { cwd: stage, dot: true }); a.finalize(); });
  const clean = path.join(work, 'clean.h5p');
  const { removed } = await cleanPackage({ file: dirty, outFile: clean });
  assert.strictEqual(removed, 3);
  const names = (await listZip(clean)).filter(n => !n.endsWith('/')).sort();
  assert.deepStrictEqual(names, ['H5P.Main-1.0/library.json', 'H5P.Main-1.0/main.css', 'H5P.Main-1.0/main.js', 'content/content.json', 'content/images/pic.png', 'h5p.json']);
  const { extractZipSafely } = require('../../plugins/output/adapt/h5pPackaging');
  await extractZipSafely(clean, path.join(work, 'x'));
  assert.strictEqual(await fs.readFile(path.join(work, 'x', 'H5P.Main-1.0', 'main.js'), 'utf8'), '//js');
});
