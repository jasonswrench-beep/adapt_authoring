import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { sign, signedHeaders, verifyHeaders } from '../auth.mjs';

const require = createRequire(import.meta.url);
const SECRET = 'a-long-test-secret';

test('a signed request is accepted and describes the user', () => {
  const user = verifyHeaders(SECRET, signedHeaders(SECRET, { id: 'u1', name: 'Dr Wrench' }));
  assert.deepStrictEqual({ id: user.id, name: user.name, role: user.role }, { id: 'u1', name: 'Dr Wrench', role: 'author' });
});

test('wrong secret, tampered fields, missing headers, expired and non-numeric timestamps are refused', () => {
  const good = signedHeaders(SECRET, { id: 'u1', name: 'A' });
  assert.strictEqual(verifyHeaders('another-secret', good), null);
  assert.strictEqual(verifyHeaders(SECRET, Object.assign({}, good, { 'x-adapt-user': 'u2' })), null);
  assert.strictEqual(verifyHeaders(SECRET, Object.assign({}, good, { 'x-adapt-role': 'system' })), null, 'an author cannot claim the system role');
  assert.strictEqual(verifyHeaders(SECRET, {}), null);
  assert.strictEqual(verifyHeaders(SECRET, signedHeaders(SECRET, { id: 'u1' }, 'author', Date.now() - 5 * 60 * 1000)), null);
  assert.strictEqual(verifyHeaders(SECRET, Object.assign({}, good, { 'x-adapt-ts': 'abc' })), null);
  assert.strictEqual(verifyHeaders('', good), null, 'no secret configured means nobody gets in');
  assert.strictEqual(verifyHeaders(SECRET, Object.assign({}, good, { 'x-adapt-sig': 'zz' })), null);
});

test('only the two known roles are accepted', () => {
  const now = Date.now();
  const forged = { 'x-adapt-ts': String(now), 'x-adapt-user': 'u1', 'x-adapt-name': '', 'x-adapt-role': 'admin', 'x-adapt-sig': sign(SECRET, String(now), 'u1', 'admin') };
  assert.strictEqual(verifyHeaders(SECRET, forged), null);
});

let client = null;
try { client = require('../../plugins/output/adapt/h5pEditorClient.js'); } catch (error) { /* the course tool's modules are not installed next to this service */ }

test('the course tool signs exactly the way the service verifies', { skip: client ? false : 'run with NODE_PATH pointing at the course tool\'s node_modules' }, () => {
  const now = Date.now();
  const headers = client.signedHeaders(SECRET, { _id: 'abc123', email: 'jason@example.edu' }, 'system', now);
  const user = verifyHeaders(SECRET, headers, now);
  assert.deepStrictEqual({ id: user.id, name: user.name, role: user.role }, { id: 'abc123', name: 'jason@example.edu', role: 'system' });
  assert.strictEqual(client.sign(SECRET, '1', 'u', 'author'), sign(SECRET, '1', 'u', 'author'));
});
