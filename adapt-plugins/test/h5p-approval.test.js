// Tests for the H5P approval list (plugins/output/adapt/h5pApproval.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ApprovalStore, hashFile, isHash } = require('../../plugins/output/adapt/h5pApproval');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'h5p-approval-'));
const store = () => new ApprovalStore(path.join(tmp(), 'data', 'h5p-approvals.json'));
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const info = { fileName: 'quiz.h5p', size: 1234, title: 'Quiz', mainLibrary: 'H5P.TrueFalse', libraries: ['H5P.TrueFalse-1.6'] };

test('hashes are 64 lowercase hex characters', () => {
  assert.ok(isHash(H1));
  ['', 'abc', 'A'.repeat(64), 'g'.repeat(64), null, undefined, 5, '../x'].forEach(v => assert.ok(!isHash(v), String(v)));
});

test('hashFile gives the SHA-256 of the bytes', async () => {
  const file = path.join(tmp(), 'f.bin');
  fs.writeFileSync(file, 'abc');
  assert.strictEqual(await hashFile(file), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('an unseen file is unknown; recording it makes it pending, never approved', async () => {
  const s = store();
  assert.strictEqual(await s.statusOf(H1), 'unknown');
  await s.recordPending(H1, info, { courseId: 'c1', courseTitle: 'Course one' });
  assert.strictEqual(await s.statusOf(H1), 'pending');
});

test('approve, reject and revoke move a file between states', async () => {
  const s = store();
  await s.recordPending(H1, info);
  assert.strictEqual(await s.approve(H1, 'admin@example.edu'), true);
  assert.strictEqual(await s.statusOf(H1), 'approved');
  assert.strictEqual(await s.reject(H1, 'admin@example.edu'), true);
  assert.strictEqual(await s.statusOf(H1), 'rejected');
  assert.strictEqual(await s.revoke(H1), true);
  assert.strictEqual(await s.statusOf(H1), 'unknown');
  assert.strictEqual(await s.revoke(H1), false, 'nothing left to revoke');
});

test('a hash that was never seen cannot be approved (no pre-approving)', async () => {
  const s = store();
  assert.strictEqual(await s.approve(H2, 'admin'), false);
  assert.strictEqual(await s.statusOf(H2), 'unknown');
});

test('recording a file again never overturns a decision', async () => {
  const s = store();
  await s.recordPending(H1, info);
  await s.approve(H1, 'admin');
  await s.recordPending(H1, info, { courseId: 'c2', courseTitle: 'Other' });
  assert.strictEqual(await s.statusOf(H1), 'approved');
  await s.reject(H1, 'admin');
  await s.recordPending(H1, info);
  assert.strictEqual(await s.statusOf(H1), 'rejected');
});

test('the courses a pending file appears in are collected without duplicates', async () => {
  const s = store();
  await s.recordPending(H1, info, { courseId: 'c1', courseTitle: 'One' });
  await s.recordPending(H1, info, { courseId: 'c1', courseTitle: 'One' });
  await s.recordPending(H1, info, { courseId: 'c2', courseTitle: 'Two' });
  const [entry] = (await s.list()).pending;
  assert.deepStrictEqual(entry.seenIn.map(c => c.courseId), ['c1', 'c2']);
  assert.strictEqual(entry.hash, H1);
  assert.strictEqual(entry.title, 'Quiz');
});

test('decisions record who made them and when', async () => {
  const s = store();
  await s.recordPending(H1, info);
  await s.approve(H1, 'admin@example.edu');
  const [entry] = (await s.list()).approved;
  assert.strictEqual(entry.decidedBy, 'admin@example.edu');
  assert.ok(!Number.isNaN(Date.parse(entry.decidedAt)));
});

test('decisions persist across store instances (a restart)', async () => {
  const file = path.join(tmp(), 'h5p-approvals.json');
  const first = new ApprovalStore(file);
  await first.recordPending(H1, info);
  await first.approve(H1, 'admin');
  assert.strictEqual(await new ApprovalStore(file).statusOf(H1), 'approved');
});

test('many simultaneous writes are all kept', async () => {
  const s = store();
  const hashes = Array.from({ length: 30 }, (_, i) => i.toString(16).padStart(2, '0').repeat(32));
  await Promise.all(hashes.map(h => s.recordPending(h, info)));
  assert.strictEqual((await s.list()).pending.length, 30);
});

test('invalid hashes are rejected before anything is written', async () => {
  const s = store();
  await assert.rejects(s.recordPending('../../etc/passwd', info), /Invalid file hash/);
  await assert.rejects(s.approve('xyz'), /Invalid file hash/);
  await assert.rejects(s.reject(''), /Invalid file hash/);
  await assert.rejects(s.revoke(null), /Invalid file hash/);
  assert.ok(!fs.existsSync(s.filePath));
});

test('an unreadable state file fails closed: it is an error, never "approved"', async () => {
  const dir = tmp();
  const file = path.join(dir, 'h5p-approvals.json');
  fs.writeFileSync(file, '{ not json');
  await assert.rejects(new ApprovalStore(file).statusOf(H1));
  await assert.rejects(new ApprovalStore(file).recordPending(H1, info));
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{ not json', 'the damaged file is left alone for the administrator to inspect');
});
