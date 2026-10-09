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

// stands in for the framework's installed plugins (the folder the wrapper reads versions from)
function fakeFrameworkSrc(themeVersion = '1.2.3', menuVersion = '4.5.6') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fwsrc-'));
  const put = (folder, name, extra) => {
    fs.mkdirSync(path.join(root, folder, name), { recursive: true });
    fs.writeFileSync(path.join(root, folder, name, 'bower.json'), JSON.stringify(Object.assign({ name, framework: '>=5.48.4' }, extra)));
  };
  put('theme', 'adapt-theme-modern', { version: themeVersion, theme: 'adapt-theme-modern' });
  put('menu', 'adapt-menu-lessons', { version: menuVersion, menu: 'adapt-menu-lessons' });
  return root;
}

test('the package names the installed theme and menu with their installed versions (the importer fails without them)', () => {
  const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-')), 'upload_abc123');
  fs.copyFileSync(SAMPLE, copy);
  const { zipPath } = convertToImportZip(copy, '5.56.3', fakeFrameworkSrc('1.2.3', '4.5.6'));
  const zip = new AdmZip(zipPath);
  const theme = read(zip, 'src/theme/adapt-theme-modern/bower.json');
  const menu = read(zip, 'src/menu/adapt-menu-lessons/bower.json');
  assert.strictEqual(theme.name, 'adapt-theme-modern');
  assert.strictEqual(theme.version, '1.2.3');
  assert.strictEqual(theme.theme, 'adapt-theme-modern');
  assert.strictEqual(menu.version, '4.5.6');
  assert.strictEqual(menu.menu, 'adapt-menu-lessons');
  // nothing but the version file: the importer must never have files here that could replace the real plugin
  assert.deepStrictEqual(zip.getEntries().filter(e => /^src\/(theme|menu)\//.test(e.entryName)).map(e => e.entryName).sort(),
    ['src/menu/adapt-menu-lessons/bower.json', 'src/theme/adapt-theme-modern/bower.json']);
});

test('a missing theme or menu on the server is a readable error, not a broken import', () => {
  const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-')), 'upload_abc123');
  fs.copyFileSync(SAMPLE, copy);
  assert.throws(() => convertToImportZip(copy, '5.56.3', fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'))), /not installed on this server/);
});

test('command-line packages also carry theme and menu version files (older version, so nothing is replaced)', () => {
  const zip = convert(SAMPLE, options).out;
  assert.strictEqual(read(zip, 'src/theme/adapt-theme-modern/bower.json').version, '0.0.1');
  assert.strictEqual(read(zip, 'src/menu/adapt-menu-lessons/bower.json').version, '0.0.1');
});

test('the editor wrapper recognises .pptx by name and writes an importable zip', () => {
  assert.ok(isPptx({ name: 'My Deck.PPTX' }));
  assert.ok(!isPptx({ name: 'course.zip' }));
  assert.ok(!isPptx(null));
  const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-')), 'upload_abc123');
  fs.copyFileSync(SAMPLE, copy); // formidable stores uploads under a random name, so the wrapper must not depend on the path
  const { zipPath, summary } = convertToImportZip(copy, '5.56.3', fakeFrameworkSrc());
  const zip = new AdmZip(zipPath);
  assert.ok(zip.getEntry('src/course/config.json'));
  assert.ok(zip.getEntry('src/course/en/components.json'));
  assert.strictEqual(JSON.parse(zip.readAsText(zip.getEntry('package.json'))).version, '5.56.3');
  assert.ok(summary.stats.slides >= 1);
});

test('a file that is not a PowerPoint gives a readable error', () => {
  const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-')), 'x.pptx');
  fs.writeFileSync(bad, 'not a zip at all');
  assert.throws(() => convertToImportZip(bad, '5.56.3', fakeFrameworkSrc()), /not a valid \.pptx/);
});

// ---- embedded video and audio ----
const VIDEO_SAMPLE = path.join(__dirname, '..', '..', 'scripts', 'pptx-import', 'test', 'sample-video.pptx');
const { extract, slidesItems } = require('../../scripts/pptx-import/pptx-to-adapt');

test('embedded video and audio are extracted and attached to their slides', () => {
  const r = extract(VIDEO_SAMPLE, { lang: 'en', notes: false, includeHidden: false, layout: 'slides' });
  assert.ok(r.media.some(m => m.kind === 'video' && /\.mp4$/.test(m.file) && m.data.length > 100));
  assert.ok(r.media.some(m => m.kind === 'audio' && /\.wav$/.test(m.file)));
  const { items } = slidesItems(r.slides, 'en');
  assert.match(items[0]._video.src, /^course\/en\/video\/slide01_media\d\.mp4$/);
  assert.strictEqual(items[0]._audio.src, '');
  assert.match(items[1]._audio.src, /^course\/en\/audio\/slide02_media\d\.wav$/);
  assert.strictEqual(items[1]._video.src, '');
});

test('media in a format browsers cannot play is skipped with a clear message, and a second clip is reported', () => {
  const r = extract(VIDEO_SAMPLE, { lang: 'en', notes: false, includeHidden: false, layout: 'slides' });
  assert.ok(r.warnings.some(w => /Slide 3: embedded \.avi file is not a web format/.test(w)));
  const { items, warnings } = slidesItems(r.slides, 'en');
  assert.strictEqual(items[2]._video.src + items[2]._audio.src, '');
  assert.ok(warnings.some(w => /Slide 4: 1 more video\/audio clip/.test(w)));
  assert.ok(warnings.some(w => /Slide 1: add a transcript/.test(w)), 'the learner is told to add a transcript');
});

test('the converted course packs the media under video/ and audio/ and nothing unused', () => {
  const zip = convert(VIDEO_SAMPLE, options).out;
  const names = zip.getEntries().map(e => e.entryName);
  assert.ok(names.some(n => /^src\/course\/en\/video\/slide01_media\d\.mp4$/.test(n)));
  assert.ok(names.some(n => /^src\/course\/en\/audio\/slide02_media\d\.wav$/.test(n)));
  assert.ok(!names.some(n => /\.avi$/.test(n)));
});

test('other layouts do not turn media into pictures: it is dropped with a warning', () => {
  const r = convert(VIDEO_SAMPLE, Object.assign({}, options, { layout: 'single' }));
  const comps = JSON.parse(r.out.readAsText(r.out.getEntry('src/course/en/components.json')));
  assert.ok(comps.every(c => c._component !== 'graphic'), 'no media became a graphic component');
  assert.ok(r.warnings.some(w => /only carried over in the slides layout/.test(w)));
});
