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
const { ApprovalStore, hashFile } = require('../../plugins/output/adapt/h5pApproval');
const FIXTURE = path.join(__dirname, 'fixtures', 'h5p-test.h5p');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'h5p-test-'));
// stands in for an approval list in which every file is approved (the approval gate has its own tests below)
const allowAll = { statusOf: async () => 'approved', recordPending: async () => {} };

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
  const result = await packaging.packageH5P({ components: [player(), { _id: 'c-006', _component: 'text' }], buildFolder: build, approvals: allowAll });
  assert.strictEqual(result.packaged, 1);
  assert.deepStrictEqual(result.warnings, []);
  assert.deepStrictEqual(result.pending, []);
  assert.ok(fs.existsSync(path.join(build, 'h5p', 'c-005', 'h5p.json')));
  assert.ok(!fs.existsSync(path.join(build, 'course', 'en', 'assets', 'activity.h5p')));
});

test('running again after the file was removed keeps the unpacked copy and does not warn', async () => {
  const build = course(FIXTURE);
  await packaging.packageH5P({ components: [player()], buildFolder: build, approvals: allowAll });
  const again = await packaging.packageH5P({ components: [player()], buildFolder: build, approvals: allowAll });
  assert.deepStrictEqual(again, { packaged: 0, warnings: [], pending: [] });
  assert.ok(fs.existsSync(path.join(build, 'h5p', 'c-005', 'h5p.json')));
});

test('a replaced file replaces the old unpacked content', async () => {
  const build = course(FIXTURE);
  await packaging.packageH5P({ components: [player()], buildFolder: build, approvals: allowAll });
  fs.writeFileSync(path.join(build, 'h5p', 'c-005', 'stale.txt'), 'old');
  fs.copyFileSync(FIXTURE, path.join(build, 'course', 'en', 'assets', 'activity.h5p'));
  await packaging.packageH5P({ components: [player()], buildFolder: build, approvals: allowAll });
  assert.ok(!fs.existsSync(path.join(build, 'h5p', 'c-005', 'stale.txt')));
});

test('a missing file is a warning, not a failure', async () => {
  const result = await packaging.packageH5P({ components: [player()], buildFolder: course(null), approvals: allowAll });
  assert.strictEqual(result.packaged, 0);
  assert.match(result.warnings[0], /file not found/);
});

test('an unusable archive fails with a readable message and leaves nothing behind', async () => {
  const dir = tmp();
  const bad = path.join(dir, 'bad.h5p');
  makeZip(bad, { 'readme.txt': 'no h5p.json here' });
  const build = course(bad);
  await assert.rejects(packaging.packageH5P({ components: [player({ title: 'My quiz' })], buildFolder: build, approvals: allowAll }), /"My quiz" could not be unpacked.*not a valid H5P file/);
  assert.ok(!fs.existsSync(path.join(build, 'h5p', 'c-005')));
});

test('a source path that points outside the course is rejected', async () => {
  const build = course(null);
  await assert.rejects(packaging.packageH5P({ components: [player({ _h5p: { _src: '../../etc/passwd' } })], buildFolder: build, approvals: allowAll }), /outside the course/);
});

test('courses without H5P components cost nothing', async () => {
  assert.deepStrictEqual(await packaging.packageH5P({ components: [{ _component: 'text' }], buildFolder: tmp(), approvals: allowAll }), { packaged: 0, warnings: [], pending: [] });
  assert.deepStrictEqual(await packaging.packageH5P({ components: undefined, buildFolder: tmp(), approvals: allowAll }), { packaged: 0, warnings: [], pending: [] });
});

test('two components that use the same .h5p file are both packaged', async () => {
  const build = course(FIXTURE);
  const result = await packaging.packageH5P({ components: [player(), player({ _id: 'c-006' })], buildFolder: build, approvals: allowAll });
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

// ---------- approval gate ----------
const gate = () => new ApprovalStore(path.join(tmp(), 'h5p-approvals.json'));
const status = (build, id = 'c-005') => JSON.parse(fs.readFileSync(path.join(build, 'h5p', id, 'status.json'), 'utf8'));
const ctx = { courseId: 'course1', courseTitle: 'Study skills' };
const run = (build, approvals, comps = [player()]) => packaging.packageH5P({ components: comps, buildFolder: build, approvals, context: ctx });

test('readH5pInfo reads the title and libraries without unpacking', async () => {
  const info = await packaging.readH5pInfo(FIXTURE);
  assert.strictEqual(info.title, 'Hello World');
  assert.strictEqual(info.mainLibrary, 'H5P.TrueFalse');
  assert.ok(info.libraries.includes('H5P.TrueFalse-1.6'));
});

test('an unapproved file is not unpacked; it is recorded as pending and reported', async () => {
  const build = course(FIXTURE);
  const approvals = gate();
  const result = await run(build, approvals);
  assert.strictEqual(result.packaged, 0);
  assert.strictEqual(result.pending.length, 1);
  assert.strictEqual(result.pending[0].status, 'pending');
  assert.strictEqual(result.pending[0].title, 'Quiz');
  assert.strictEqual(result.pending[0].hash, await hashFile(FIXTURE));
  assert.ok(!fs.existsSync(path.join(build, 'h5p', 'c-005', 'h5p.json')), 'nothing from the file was unpacked');
  assert.strictEqual(status(build).status, 'pending');
  assert.ok(fs.existsSync(path.join(build, 'course', 'en', 'assets', 'activity.h5p')), 'kept so approving later needs no rebuild');
  const [entry] = (await approvals.list()).pending;
  assert.strictEqual(entry.title, 'Hello World');
  assert.strictEqual(entry.fileName, 'activity.h5p');
  assert.deepStrictEqual(entry.seenIn, [ctx]);
});

test('after approval the next run unpacks it without a rebuild and removes the packed file', async () => {
  const build = course(FIXTURE);
  const approvals = gate();
  const first = await run(build, approvals);
  await approvals.approve(first.pending[0].hash, 'admin@example.edu');
  const second = await run(build, approvals);
  assert.strictEqual(second.packaged, 1);
  assert.deepStrictEqual(second.pending, []);
  assert.ok(fs.existsSync(path.join(build, 'h5p', 'c-005', 'h5p.json')));
  assert.strictEqual(status(build).status, 'approved');
  assert.ok(!fs.existsSync(path.join(build, 'course', 'en', 'assets', 'activity.h5p')));
});

test('a rejected file stays blocked and is reported as rejected', async () => {
  const build = course(FIXTURE);
  const approvals = gate();
  const first = await run(build, approvals);
  await approvals.reject(first.pending[0].hash, 'admin');
  const second = await run(build, approvals);
  assert.strictEqual(second.pending[0].status, 'rejected');
  assert.strictEqual(status(build).status, 'rejected');
  assert.ok(!fs.existsSync(path.join(build, 'h5p', 'c-005', 'h5p.json')));
});

test('approval belongs to the exact file: a different file with the same name is not approved', async () => {
  const approvals = gate();
  const first = await run(course(FIXTURE), approvals);
  await approvals.approve(first.pending[0].hash, 'admin');
  // same name, different bytes (a valid H5P with one extra file)
  const other = path.join(tmp(), 'other.h5p');
  fs.copyFileSync(FIXTURE, other);
  execFileSync('python3', ['-c', 'import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1],"a")\nz.writestr("extra.txt","changed")\nz.close()', other]); // a real extra entry: still valid, different bytes
  const build = course(other);
  const result = await run(build, approvals);
  assert.strictEqual(result.packaged, 0);
  assert.strictEqual(result.pending.length, 1);
  assert.notStrictEqual(result.pending[0].hash, first.pending[0].hash);
});

test('withdrawing an approval takes down an already unpacked activity', async () => {
  const build = course(FIXTURE);
  const approvals = gate();
  const first = await run(build, approvals);
  await approvals.approve(first.pending[0].hash, 'admin');
  await run(build, approvals);                                  // unpacked, source removed
  assert.ok(fs.existsSync(path.join(build, 'h5p', 'c-005', 'h5p.json')));
  await approvals.revoke(first.pending[0].hash);
  const third = await run(build, approvals);                    // no rebuild: only the marker is left to go on
  assert.strictEqual(third.pending[0].status, 'pending');
  assert.strictEqual(third.pending[0].needsRebuild, true);
  assert.ok(!fs.existsSync(path.join(build, 'h5p', 'c-005', 'h5p.json')), 'unpacked content removed');
  assert.strictEqual(status(build).status, 'pending');
});

test('with no approval list nothing is unpacked (fail closed)', async () => {
  const build = course(FIXTURE);
  await assert.rejects(packaging.packageH5P({ components: [player()], buildFolder: build }), /approval list is not available/);
  assert.ok(!fs.existsSync(path.join(build, 'h5p')));
});

test('an unreadable approval list is an error, not an approval', async () => {
  const file = path.join(tmp(), 'h5p-approvals.json');
  fs.writeFileSync(file, '{ broken');
  const build = course(FIXTURE);
  await assert.rejects(run(build, new ApprovalStore(file)));
  assert.ok(!fs.existsSync(path.join(build, 'h5p', 'c-005', 'h5p.json')));
});

test('a file that is not H5P fails clearly and does not bother the administrator', async () => {
  const dir = tmp();
  const bad = path.join(dir, 'bad.h5p');
  makeZip(bad, { 'readme.txt': 'no h5p.json here' });
  const approvals = gate();
  await assert.rejects(run(course(bad), approvals), /could not be unpacked.*not a valid H5P file \(missing h5p.json\)/);
  assert.deepStrictEqual((await approvals.list()).pending, []);
  const notZip = path.join(dir, 'x.h5p');
  fs.writeFileSync(notZip, 'plain text');
  await assert.rejects(run(course(notZip), approvals), /not a zip archive/);
});

test('two components with the same unapproved file give one approval request', async () => {
  const build = course(FIXTURE);
  const approvals = gate();
  const result = await run(build, approvals, [player(), player({ _id: 'c-006', title: 'Second' })]);
  assert.strictEqual(result.pending.length, 2);
  const { pending } = await approvals.list();
  assert.strictEqual(pending.length, 1, 'one file, one decision');
  assert.deepStrictEqual(pending[0].seenIn, [ctx]);
});

test('status marker URL sits inside the activity folder, and only pending/rejected block loading', () => {
  assert.strictEqual(events.statusUrlFor('c-005'), `${events.contentFolderFor('c-005')}/status.json`);
  assert.strictEqual(events.statusUrlFor('a/../b'), `./h5p/${packaging.folderName('a/../b')}/status.json`);
  assert.ok(events.isBlockedStatus('pending'));
  assert.ok(events.isBlockedStatus('rejected'));
  ['approved', null, undefined, '', 'something-else'].forEach(v => assert.ok(!events.isBlockedStatus(v), String(v)));
});

test('what is approved is what is unpacked: the file is checked and unpacked from one private copy', async () => {
  const build = course(FIXTURE);
  const hashes = [];
  // an approval list that swaps the file in the build for a different one right after it has been asked about it
  const swapping = {
    statusOf: async hash => { hashes.push(hash); fs.writeFileSync(path.join(build, 'course', 'en', 'assets', 'activity.h5p'), 'swapped after the check'); return 'approved'; },
    recordPending: async () => {}
  };
  const result = await packaging.packageH5P({ components: [player()], buildFolder: build, approvals: swapping });
  assert.strictEqual(hashes[0], await hashFile(FIXTURE), 'the hash asked about is that of the original bytes');
  assert.strictEqual(result.packaged, 1, 'the original, approved bytes were unpacked even though the file changed during the check');
  assert.ok(fs.existsSync(path.join(build, 'h5p', 'c-005', 'h5p.json')));
});

test('no private copies are left behind', async () => {
  const before = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('h5p-snapshot-')).length;
  await run(course(FIXTURE), gate());
  await packaging.packageH5P({ components: [player()], buildFolder: course(FIXTURE), approvals: allowAll });
  await assert.rejects(run(course(FIXTURE), { statusOf: async () => { throw new Error('list unreadable'); } }));
  assert.strictEqual(fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('h5p-snapshot-')).length, before);
});
