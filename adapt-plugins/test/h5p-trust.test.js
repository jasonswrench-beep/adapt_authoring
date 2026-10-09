// Tests for the trusted-uploader shortcut (h5pTrust.js, ApprovalStore.autoApprove, packageH5P trustedUploads).
// Needs the main app's dependencies: run `npm install` first, or set NODE_PATH.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const packaging = require('../../plugins/output/adapt/h5pPackaging');
const { ApprovalStore, hashFile } = require('../../plugins/output/adapt/h5pApproval');
const { computeTrustedUploads, safeDecode } = require('../../plugins/output/adapt/h5pTrust');
const FIXTURE = path.join(__dirname, 'fixtures', 'h5p-test.h5p');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'h5p-trust-'));
const gate = () => new ApprovalStore(path.join(tmp(), 'h5p-approvals.json'));
const ctx = { courseId: 'c1', courseTitle: 'Course' };

const admins = new Set(['admin']);
const trusted = async id => admins.has(id);
const label = async id => id + '@example.edu';

test('safeDecode decodes percent-encoding and leaves malformed input alone', () => {
  assert.strictEqual(safeDecode('Week%203%20quiz.h5p'), 'Week 3 quiz.h5p');
  assert.strictEqual(safeDecode('caf%C3%A9.h5p'), 'café.h5p');
  assert.strictEqual(safeDecode('100%.h5p'), '100%.h5p');
});

test('only files uploaded by a trusted user are trusted', async () => {
  const map = await computeTrustedUploads([
    { filename: 'a.h5p', createdBy: 'admin' }, { filename: 'b.h5p', createdBy: 'student' }, { filename: 'c.h5p' }
  ], trusted, label);
  assert.deepStrictEqual([...map], [['a.h5p', 'admin@example.edu']]);
});

test('a filename shared with an untrusted upload is not trusted', async () => {
  const map = await computeTrustedUploads([
    { filename: 'a.h5p', createdBy: 'admin' }, { filename: 'a.h5p', createdBy: 'student' }
  ], trusted, label);
  assert.strictEqual(map.size, 0);
});

test('a failing permission check means not trusted', async () => {
  const map = await computeTrustedUploads([{ filename: 'a.h5p', createdBy: 'admin' }], async () => { throw new Error('db down'); }, label);
  assert.strictEqual(map.size, 0);
});

test('a failing label lookup still trusts the file', async () => {
  const map = await computeTrustedUploads([{ filename: 'a.h5p', createdBy: 'admin' }], trusted, async () => { throw new Error('x'); });
  assert.strictEqual(map.size, 1);
});

test('autoApprove approves, records who, and never overrides a rejection', async () => {
  const s = gate();
  const H = 'a'.repeat(64);
  assert.strictEqual(await s.autoApprove(H, { fileName: 'q.h5p' }, 'admin@example.edu'), true);
  assert.strictEqual(await s.statusOf(H), 'approved');
  const [row] = (await s.list()).approved;
  assert.strictEqual(row.auto, true);
  assert.strictEqual(row.decidedBy, 'auto: uploaded by admin@example.edu');
  await s.reject(H, 'admin');
  assert.strictEqual(await s.autoApprove(H, { fileName: 'q.h5p' }, 'admin@example.edu'), false);
  assert.strictEqual(await s.statusOf(H), 'rejected');
});

function course(fileName) {
  const build = tmp();
  fs.mkdirSync(path.join(build, 'course', 'en', 'assets'), { recursive: true });
  fs.copyFileSync(FIXTURE, path.join(build, 'course', 'en', 'assets', fileName));
  return build;
}
const player = src => ({ _id: 'c-005', _component: 'h5pPlayer', title: 'Quiz', _h5p: { _src: src } });
const run = (build, approvals, src, trustedUploads) =>
  packaging.packageH5P({ components: [player(src)], buildFolder: build, approvals, context: ctx, trustedUploads });

test('a trusted upload is unpacked on the first build, with no administrator click', async () => {
  const build = course('activity.h5p');
  const approvals = gate();
  const result = await run(build, approvals, 'course/en/assets/activity.h5p', new Map([['activity.h5p', 'admin@example.edu']]));
  assert.strictEqual(result.packaged, 1);
  assert.deepStrictEqual(result.pending, []);
  assert.ok(fs.existsSync(path.join(build, 'h5p', 'c-005', 'h5p.json')));
  assert.strictEqual(await approvals.statusOf(await hashFile(FIXTURE)), 'approved');
});

test('an untrusted upload still waits', async () => {
  const build = course('activity.h5p');
  const result = await run(build, gate(), 'course/en/assets/activity.h5p', new Map([['other.h5p', 'admin']]));
  assert.strictEqual(result.packaged, 0);
  assert.strictEqual(result.pending[0].status, 'pending');
});

test('an already pending file is approved once a trusted user uploads the same bytes', async () => {
  const build = course('activity.h5p');
  const approvals = gate();
  await run(build, approvals, 'course/en/assets/activity.h5p');
  const result = await run(build, approvals, 'course/en/assets/activity.h5p', new Map([['activity.h5p', 'admin']]));
  assert.strictEqual(result.packaged, 1);
  assert.strictEqual((await approvals.list()).pending.length, 0);
});

test('a file the administrator rejected stays rejected even when a trusted user uploads it', async () => {
  const build = course('activity.h5p');
  const approvals = gate();
  const first = await run(build, approvals, 'course/en/assets/activity.h5p');
  await approvals.reject(first.pending[0].hash, 'admin');
  const result = await run(build, approvals, 'course/en/assets/activity.h5p', new Map([['activity.h5p', 'admin']]));
  assert.strictEqual(result.packaged, 0);
  assert.strictEqual(result.pending[0].status, 'rejected');
});

test('file names with spaces, accents and a stray % are found (the path in the course JSON is URL-encoded)', async () => {
  for (const name of ['Week 3 quiz.h5p', 'café quiz.h5p', '100% done.h5p']) {
    const build = course(name);
    const src = 'course/en/assets/' + (name === '100% done.h5p' ? name : encodeURIComponent(name));
    const result = await run(build, gate(), src, new Map([[name, 'admin']]));
    assert.deepStrictEqual(result.warnings, [], name);
    assert.strictEqual(result.packaged, 1, name);
  }
});
