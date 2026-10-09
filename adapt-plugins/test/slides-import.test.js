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
