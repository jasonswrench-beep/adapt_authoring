// The PowerPoint converter's "slides" layout and the editor-side wrapper (plugins/output/adapt/pptxImport.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

const SAMPLE = path.join(__dirname, '..', '..', 'scripts', 'pptx-import', 'test', 'sample.pptx');
const { convert } = require('../../scripts/pptx-import/pptx-to-adapt');
const { isPptx, convertToImportZip } = require('../../plugins/output/adapt/pptxImport');

const options = { layout: 'slides', lang: 'en', framework: '5.56.3', notes: false, includeHidden: false, theme: 'adapt-theme-modern', menu: 'adapt-menu-lessons' };
const read = (zip, name) => JSON.parse(zip.readAsText(zip.getEntry(name)));

test('slides layout: one page, one Slides component, one item per visible slide', () => {
  const r = convert(SAMPLE, options);
  const zip = r.out;
  const cos = read(zip, 'src/course/en/contentObjects.json');
  const comps = read(zip, 'src/course/en/components.json');
  assert.strictEqual(cos.length, 1);
  assert.strictEqual(comps.length, 1);
  assert.strictEqual(comps[0]._component, 'slides');
  assert.strictEqual(comps[0]._items.length, r.stats.slides);
  assert.ok(comps[0]._items.every(i => typeof i.title === 'string' && i.title.length));
  assert.strictEqual(comps[0]._setCompletionOn, 'allSlides');
});

test('slides layout: text and tables become slide text; the first picture becomes the slide image with its alt text', () => {
  const comps = read(convert(SAMPLE, options).out, 'src/course/en/components.json');
  const items = comps[0]._items;
  assert.ok(items.some(i => /<ul>/.test(i.body)), 'bullets kept');
  assert.ok(items.some(i => /<table/.test(i.body)), 'table kept');
  const withImage = items.filter(i => i._graphic.src);
  assert.ok(withImage.length >= 1);
  assert.ok(withImage.every(i => /^course\/en\/images\/\w+\.(png|jpe?g|gif|svg|webp)$/.test(i._graphic.src)));
  assert.ok(withImage.some(i => i._graphic.alt === 'A blue library desk'), 'alt text carried over');
  assert.ok(items.every(i => !i._graphic.src || ['top', 'right'].includes(i._imagePosition)));
});

test('slides layout: only pictures that are used are packed, and each packed file is referenced', () => {
  const zip = convert(SAMPLE, options).out;
  const json = zip.readAsText(zip.getEntry('src/course/en/components.json'));
  const images = zip.getEntries().filter(e => /\/images\//.test(e.entryName)).map(e => path.basename(e.entryName));
  assert.ok(images.length >= 1);
  images.forEach(f => assert.ok(json.includes(f), `${f} is referenced`));
  assert.ok(images.every(f => /^\w+\.\w+$/.test(f)), 'filenames the importer accepts');
});

test('the editor wrapper recognises .pptx by name and writes an importable zip', () => {
  assert.ok(isPptx({ name: 'My Deck.PPTX' }));
  assert.ok(!isPptx({ name: 'course.zip' }));
  assert.ok(!isPptx(null));
  const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-')), 'upload_abc123');
  fs.copyFileSync(SAMPLE, copy); // formidable stores uploads under a random name, so the wrapper must not depend on the path
  const { zipPath, summary } = convertToImportZip(copy, '5.56.3');
  const zip = new AdmZip(zipPath);
  assert.ok(zip.getEntry('src/course/config.json'));
  assert.ok(zip.getEntry('src/course/en/components.json'));
  assert.strictEqual(JSON.parse(zip.readAsText(zip.getEntry('package.json'))).version, '5.56.3');
  assert.ok(summary.stats.slides >= 1);
});

test('a file that is not a PowerPoint gives a readable error', () => {
  const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-')), 'x.pptx');
  fs.writeFileSync(bad, 'not a zip at all');
  assert.throws(() => convertToImportZip(bad, '5.56.3'), /not a valid \.pptx/);
});
