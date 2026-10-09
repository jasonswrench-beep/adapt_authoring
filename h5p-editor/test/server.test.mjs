import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp, purgeOldContent } from '../server.mjs';
import { signedHeaders } from '../auth.mjs';

const SECRET = 'a-long-test-secret';
async function serve() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'h5p-editor-test-'));
  const { app } = await createApp({ dataDir, secret: SECRET });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

test('the editor service refuses requests that are not signed by the course tool, but answers the health check', async () => {
  const { base, close } = await serve();
  try {
    assert.strictEqual((await fetch(`${base}/healthz`)).status, 200);
    for (const p of ['/h5p-editor/new', '/h5p-editor/edit/1', '/h5p-editor/ajax?action=libraries', '/h5p-editor/internal/export/1']) {
      assert.strictEqual((await fetch(base + p)).status, 401, p);
    }
    const forged = await fetch(`${base}/h5p-editor/new`, { headers: Object.assign(signedHeaders('wrong', { id: 'u' }), {}) });
    assert.strictEqual(forged.status, 401);
  } finally { close(); }
});

test('an author cannot use the course-tool-only import and export routes', async () => {
  const { base, close } = await serve();
  try {
    const headers = signedHeaders(SECRET, { id: 'u1', name: 'A' }, 'author');
    assert.strictEqual((await fetch(`${base}/h5p-editor/internal/export/1`, { headers })).status, 403);
    assert.strictEqual((await fetch(`${base}/h5p-editor/internal/import`, { method: 'POST', headers })).status, 403);
  } finally { close(); }
});

test('an author cannot delete content; only the course tool can', async () => {
  const { base, close } = await serve();
  try {
    const headers = signedHeaders(SECRET, { id: 'u1', name: 'A' }, 'author');
    assert.strictEqual((await fetch(`${base}/h5p-editor/internal/content/1`, { method: 'DELETE', headers })).status, 403);
  } finally { close(); }
});

test('purgeOldContent removes only old content folders', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h5p-purge-'));
  for (const name of ['old', 'new']) fs.mkdirSync(path.join(dir, name));
  fs.writeFileSync(path.join(dir, 'keep.txt'), 'x');
  const old = Date.now() - 20 * 86400 * 1000;
  fs.utimesSync(path.join(dir, 'old'), old / 1000, old / 1000);
  assert.strictEqual(purgeOldContent(dir, 14), 1);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['keep.txt', 'new']);
  assert.strictEqual(purgeOldContent(path.join(dir, 'missing'), 14), 0);
});
