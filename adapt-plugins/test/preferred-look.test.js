const test = require('node:test');
const assert = require('node:assert');
const prefer = require('../../plugins/content/config/preferredLook');

const fakeDb = installed => ({
  retrieve(model, query, cb) {
    setImmediate(() => cb(null, installed.includes(`${model}:${query.name}`) ? [{ name: query.name }] : []));
  }
});
const run = (db, config = {}) => new Promise(resolve => prefer(db, config, () => resolve(config)));

test('uses the Modern theme and Lessons menu when both are installed', async () => {
  const config = await run(fakeDb(['themetype:adapt-theme-modern', 'menutype:adapt-menu-lessons']));
  assert.deepStrictEqual(config, { _theme: 'adapt-theme-modern', _menu: 'adapt-menu-lessons' });
});

test('keeps the defaults (leaves keys unset) when they are not installed', async () => {
  assert.deepStrictEqual(await run(fakeDb([])), {});
});

test('each one is decided independently', async () => {
  assert.deepStrictEqual(await run(fakeDb(['themetype:adapt-theme-modern'])), { _theme: 'adapt-theme-modern' });
  assert.deepStrictEqual(await run(fakeDb(['menutype:adapt-menu-lessons'])), { _menu: 'adapt-menu-lessons' });
});

test('database errors and exceptions never block course creation', async () => {
  const erroring = { retrieve: (m, q, cb) => setImmediate(() => cb(new Error('db down'))) };
  assert.deepStrictEqual(await run(erroring), {});
  const throwing = { retrieve() { throw new Error('boom'); } };
  assert.deepStrictEqual(await run(throwing), {});
  assert.deepStrictEqual(await run(null), {});
});

test('does not overwrite other config values', async () => {
  const config = await run(fakeDb(['themetype:adapt-theme-modern']), { _questionWeight: 1 });
  assert.strictEqual(config._questionWeight, 1);
});
