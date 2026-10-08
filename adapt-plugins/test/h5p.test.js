// Tests for the H5P Player: xAPI helpers (component) and safe unpacking (export step).
// The export step needs the main app's dependencies: run `npm install` first, or set NODE_PATH.
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const packaging = require('../../plugins/output/adapt/h5pPackaging');
const FIXTURE = path.join(__dirname, 'fixtures', 'h5p-test.h5p');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'h5p-test-'));

/** Writes a zip with arbitrary entry names (Python's zipfile does not sanitise them, unlike most libraries). */
function makeZip(file, entries) {
  const script = 'import sys,json,zipfile\nz=zipfile.ZipFile(sys.argv[1],"w")\n[z.writestr(n,d) for n,d in json.loads(sys.argv[2]).items()]\nz.close()';
  execFileSync('python3', ['-c', script, file, JSON.stringify(entries)]);
}
const validH5p = extra => Object.assign({ 'h5p.json': '{"title":"x","mainLibrary":"H5P.TrueFalse"}', 'content/content.json': '{}' }, extra);

// ---------- component helpers ----------
let events;
test.before(async () => {
  events = await import(pathToFileURL(path.join(__dirname, '..', 'adapt-component-h5p', 'js', 'h5pEvents.js')).href);
});

test('finished statements: completed, answered, passed, failed or result.completion', () => {
  const verb = v => ({ verb: { id: `http://adlnet.gov/expapi/verbs/${v}` } });
  ['completed', 'answered', 'passed', 'failed'].forEach(v => assert.strictEqual(events.isFinishedStatement(verb(v)), true, v));
  assert.strictEqual(events.isFinishedStatement({ verb: { id: 'http://adlnet.gov/expapi/verbs/interacted' } }), false);
  assert.strictEqual(events.isFinishedStatement({ result: { completion: true } }), true);
  assert.strictEqual(events.isFinishedStatement(null), false);
  assert.strictEqual(events.isFinishedStatement({}), false);
});

test('statements about sub-parts of an activity are ignored', () => {
  assert.strictEqual(events.isTopLevelStatement({ context: { contextActivities: { parent: [{ id: 'x' }] } } }), false);
  assert.strictEqual(events.isTopLevelStatement({ context: { contextActivities: {} } }), true);
  assert.strictEqual(events.isTopLevelStatement({}), true);
});

test('the folder the player reads matches the folder the export step writes', () => {
  ['c-005', '5f1d7f3a9d1b2c0017a4e8b1', 'weird id/../x'].forEach(id => {
    assert.strictEqual(events.contentFolderFor(id), `./h5p/${packaging.folderName(id)}`);
  });
  assert.ok(!packaging.folderName('a/../b').includes('/'));
});

// ---------- extraction ----------
test('unpacks a real H5P file', async () => {
  const dest = tmp();
  await packaging.extractZipSafely(FIXTURE, dest);
  assert.ok(fs.existsSync(path.join(dest, 'h5p.json')));
  assert.ok(fs.existsSync(path.join(dest, 'content', 'content.json')));
  assert.ok(fs.readdirSync(dest).some(n => n.startsWith('H5P.TrueFalse')), 'library folders are unpacked');
});

test('refuses a path that escapes the destination', async () => {
  const dir = tmp();
  const zip = path.join(dir, 'evil.zip');
  makeZip(zip, { '../evil.txt': 'x' });
  await assert.rejects(packaging.extractZipSafely(zip, path.join(dir, 'out')), /invalid relative path|Unsafe path/i);
  assert.ok(!fs.existsSync(path.join(dir, 'evil.txt')), 'nothing written outside the destination');
});

test('refuses absolute paths', async () => {
  const dir = tmp();
  const zip = path.join(dir, 'abs.zip');
  makeZip(zip, { '/tmp/h5p-absolute-test.txt': 'x' });
  await assert.rejects(packaging.extractZipSafely(zip, path.join(dir, 'out')));
  assert.ok(!fs.existsSync('/tmp/h5p-absolute-test.txt'));
});

test('enforces file count and size limits', async () => {
  const dir = tmp();
  const many = path.join(dir, 'many.zip');
  makeZip(many, Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}.txt`, 'x'])));
  await assert.rejects(packaging.extractZipSafely(many, path.join(dir, 'a'), { maxFiles: 10 }), /more than 10 files/);
  const big = path.join(dir, 'big.zip');
  makeZip(big, { 'a.bin': 'x'.repeat(5000), 'b.bin': 'x'.repeat(5000) });
  await assert.rejects(packaging.extractZipSafely(big, path.join(dir, 'b'), { maxEntryBytes: 4000 }), /larger than/);
  await assert.rejects(packaging.extractZipSafely(big, path.join(dir, 'c'), { maxTotalBytes: 8000 }), /unpacked/);
});

test('a file that is not a zip is rejected', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'x.h5p'), 'not a zip');
  await assert.rejects(packaging.extractZipSafely(path.join(dir, 'x.h5p'), path.join(dir, 'out')));
});

// ---------- packageH5P ----------
function course(src) {
  const build = tmp();
  fs.mkdirSync(path.join(build, 'course', 'en', 'assets'), { recursive: true });
  if (src) fs.copyFileSync(src, path.join(build, 'course', 'en', 'assets', 'activity.h5p'));
  return build;
}
const player = (extra = {}) => Object.assign({ _id: 'c-005', _component: 'h5pPlayer', title: 'Quiz', _h5p: { _src: 'course/en/assets/activity.h5p' } }, extra);

test('packages each H5P component into h5p/<id> and removes the .h5p file', async () => {
  const build = course(FIXTURE);
  const result = await packaging.packageH5P({ components: [player(), { _id: 'c-006', _component: 'text' }], buildFolder: build });
  assert.strictEqual(result.packaged, 1);
  assert.deepStrictEqual(result.warnings, []);
  assert.ok(fs.existsSync(path.join(build, 'h5p', 'c-005', 'h5p.json')));
  assert.ok(!fs.existsSync(path.join(build, 'course', 'en', 'assets', 'activity.h5p')));
});

test('running again after the file was removed keeps the unpacked copy and does not warn', async () => {
  const build = course(FIXTURE);
  await packaging.packageH5P({ components: [player()], buildFolder: build });
  const again = await packaging.packageH5P({ components: [player()], buildFolder: build });
  assert.deepStrictEqual(again, { packaged: 0, warnings: [] });
  assert.ok(fs.existsSync(path.join(build, 'h5p', 'c-005', 'h5p.json')));
});

test('a replaced file replaces the old unpacked content', async () => {
  const build = course(FIXTURE);
  await packaging.packageH5P({ components: [player()], buildFolder: build });
  fs.writeFileSync(path.join(build, 'h5p', 'c-005', 'stale.txt'), 'old');
  fs.copyFileSync(FIXTURE, path.join(build, 'course', 'en', 'assets', 'activity.h5p'));
  await packaging.packageH5P({ components: [player()], buildFolder: build });
  assert.ok(!fs.existsSync(path.join(build, 'h5p', 'c-005', 'stale.txt')));
});

test('a missing file is a warning, not a failure', async () => {
  const result = await packaging.packageH5P({ components: [player()], buildFolder: course(null) });
  assert.strictEqual(result.packaged, 0);
  assert.match(result.warnings[0], /file not found/);
});

test('an unusable archive fails with a readable message and leaves nothing behind', async () => {
  const dir = tmp();
  const bad = path.join(dir, 'bad.h5p');
  makeZip(bad, { 'readme.txt': 'no h5p.json here' });
  const build = course(bad);
  await assert.rejects(packaging.packageH5P({ components: [player({ title: 'My quiz' })], buildFolder: build }), /"My quiz" could not be unpacked.*not a valid H5P file/);
  assert.ok(!fs.existsSync(path.join(build, 'h5p', 'c-005')));
});

test('a source path that points outside the course is rejected', async () => {
  const build = course(null);
  await assert.rejects(packaging.packageH5P({ components: [player({ _h5p: { _src: '../../etc/passwd' } })], buildFolder: build }), /outside the course/);
});

test('courses without H5P components cost nothing', async () => {
  assert.deepStrictEqual(await packaging.packageH5P({ components: [{ _component: 'text' }], buildFolder: tmp() }), { packaged: 0, warnings: [] });
  assert.deepStrictEqual(await packaging.packageH5P({ components: undefined, buildFolder: tmp() }), { packaged: 0, warnings: [] });
});

test('two components that use the same .h5p file are both packaged', async () => {
  const build = course(FIXTURE);
  const result = await packaging.packageH5P({ components: [player(), player({ _id: 'c-006' })], buildFolder: build });
  assert.strictEqual(result.packaged, 2);
  assert.deepStrictEqual(result.warnings, []);
  assert.ok(fs.existsSync(path.join(build, 'h5p', 'c-005', 'h5p.json')));
  assert.ok(fs.existsSync(path.join(build, 'h5p', 'c-006', 'h5p.json')));
  assert.ok(!fs.existsSync(path.join(build, 'course', 'en', 'assets', 'activity.h5p')), 'the source is removed once all uses are unpacked');
});

test('activity IRIs are unique per component and ignore the page hash', async () => {
  const a = events.activityIriFor('http://x/index.html#/id/co-005', 'c-1');
  const b = events.activityIriFor('http://x/index.html#/id/co-009', 'c-1');
  const c = events.activityIriFor('http://x/index.html', 'c-10');
  assert.strictEqual(a, b, 'the same component has the same IRI wherever the learner is');
  assert.notStrictEqual(a, c);
  assert.ok(events.isFromActivity({ object: { id: a } }, a));
  assert.ok(events.isFromActivity({ object: { id: `${a}?subContentId=abc` } }, a));
  assert.ok(!events.isFromActivity({ object: { id: c } }, a), 'c-10 is not c-1');
  assert.ok(!events.isFromActivity({ object: { id: `${a}0` } }, a), 'prefix collisions do not match');
  assert.ok(!events.isFromActivity({}, a));
});
