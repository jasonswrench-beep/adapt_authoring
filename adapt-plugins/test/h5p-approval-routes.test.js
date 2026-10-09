// Tests for the H5P approval request handlers (plugins/output/adapt/h5pApprovalRoutes.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ApprovalStore } = require('../../plugins/output/adapt/h5pApproval');
const routes = require('../../plugins/output/adapt/h5pApprovalRoutes');

const H = 'c'.repeat(64);
const info = { fileName: 'q.h5p', size: 1, title: 'Quiz', mainLibrary: 'H5P.TrueFalse', libraries: [] };

function setup() {
  const store = new ApprovalStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'h5p-routes-')), 'a.json'));
  return { store, h: routes(() => store, () => 'teacher@example.edu') };
}
/** Minimal Express-like response that resolves when the handler answers. */
function call(handler, req = {}) {
  return new Promise(resolve => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { resolve({ status: this.statusCode, body }); } };
    handler(Object.assign({ params: {} }, req), res);
  });
}

test('list returns pending, approved and rejected files', async () => {
  const { store, h } = setup();
  await store.recordPending(H, info);
  const { status, body } = await call(h.list);
  assert.strictEqual(status, 200);
  assert.strictEqual(body.success, true);
  assert.strictEqual(body.payload.pending[0].hash, H);
  assert.deepStrictEqual(Object.keys(body.payload).sort(), ['approved', 'pending', 'rejected']);
});

test('approve records the approver and moves the file to approved', async () => {
  const { store, h } = setup();
  await store.recordPending(H, info);
  const { status, body } = await call(h.approve, { params: { hash: H } });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.success, true);
  const [entry] = (await store.list()).approved;
  assert.strictEqual(entry.decidedBy, 'teacher@example.edu');
});

test('approving a file the server has never seen is a 404 (no pre-approval)', async () => {
  const { store, h } = setup();
  const { status, body } = await call(h.approve, { params: { hash: H } });
  assert.strictEqual(status, 404);
  assert.strictEqual(body.success, false);
  assert.strictEqual(await store.statusOf(H), 'unknown');
});

test('reject and revoke work, and revoking with nothing to withdraw is a 404', async () => {
  const { store, h } = setup();
  await store.recordPending(H, info);
  assert.strictEqual((await call(h.reject, { params: { hash: H } })).status, 200);
  assert.strictEqual(await store.statusOf(H), 'rejected');
  assert.strictEqual((await call(h.revoke, { params: { hash: H } })).status, 200);
  assert.strictEqual(await store.statusOf(H), 'unknown');
  assert.strictEqual((await call(h.revoke, { params: { hash: H } })).status, 404);
});

test('a malformed hash is a 400 and touches nothing', async () => {
  const { store, h } = setup();
  for (const hash of ['xyz', '../../etc/passwd', 'C'.repeat(64), '']) {
    for (const action of [h.approve, h.reject, h.revoke]) {
      const { status } = await call(action, { params: { hash } });
      assert.strictEqual(status, 400, `hash "${hash}"`);
    }
  }
  assert.ok(!fs.existsSync(store.filePath));
});

test('a store failure is reported as a 500 with a message, not a crash', async () => {
  const broken = routes(() => ({ list: () => Promise.reject(new Error('disk full')), approve: () => { throw new Error('boom'); } }), () => 'x');
  const listed = await call(broken.list);
  assert.strictEqual(listed.status, 500);
  assert.strictEqual(listed.body.message, 'disk full');
  const approved = await call(broken.approve, { params: { hash: H } });
  assert.strictEqual(approved.status, 500);
  assert.strictEqual(approved.body.message, 'boom');
});
