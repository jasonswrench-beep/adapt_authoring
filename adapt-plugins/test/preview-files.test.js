// Which course files a preview rewrites. A preview that needs no rebuild must refresh the pages, articles, blocks and
// components (so a replaced PowerPoint deck or H5P activity shows up) but must keep the built config.json and
// course.json, which the framework build adds defaults to.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const { OutputPlugin } = require('../../lib/outputmanager');

const course = () => ({
  course: { _type: 'course', title: 'Saved title', _globals: {} },
  config: { _type: 'config', _defaultLanguage: 'en', _theme: 'x' },
  contentobject: [{ _id: 'co-1', title: 'Page' }],
  article: [{ _id: 'a-1' }],
  block: [{ _id: 'b-1' }],
  component: [{ _id: 'c-1', _items: ['new deck'] }]
});

async function built() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-files-'));
  await fs.outputJson(path.join(dir, 'config.json'), { _type: 'config', screenSize: { large: 960 } });
  await fs.outputJson(path.join(dir, 'en', 'course.json'), { _globals: { _menu: 'framework defaults' } });
  await fs.outputJson(path.join(dir, 'en', 'components.json'), [{ _id: 'c-1', _items: ['old deck'] }]);
  return dir;
}
const write = (json, dir, options) => new Promise((resolve, reject) => OutputPlugin.prototype.writeCourseJSON.call({}, json, dir, e => e ? reject(e) : resolve(), options));

test('a full write replaces every course file', async () => {
  const dir = await built();
  await write(course(), dir);
  assert.deepStrictEqual((await fs.readJson(path.join(dir, 'en', 'components.json')))[0]._items, ['new deck']);
  assert.strictEqual((await fs.readJson(path.join(dir, 'en', 'course.json'))).title, 'Saved title');
  assert.strictEqual((await fs.readJson(path.join(dir, 'config.json')))._defaultLanguage, 'en');
});

test('with config and course skipped, content is refreshed and the built defaults are kept', async () => {
  const dir = await built();
  await write(course(), dir, { skip: ['config', 'course'] });
  assert.deepStrictEqual((await fs.readJson(path.join(dir, 'en', 'components.json')))[0]._items, ['new deck'], 'a replaced deck shows up');
  assert.deepStrictEqual((await fs.readJson(path.join(dir, 'config.json'))).screenSize, { large: 960 }, 'screenSize from the build survives');
  assert.strictEqual((await fs.readJson(path.join(dir, 'en', 'course.json')))._globals._menu, 'framework defaults', 'course defaults from the build survive');
  for (const f of ['contentObjects.json', 'articles.json', 'blocks.json']) assert.ok(await fs.pathExists(path.join(dir, 'en', f)), f);
});
