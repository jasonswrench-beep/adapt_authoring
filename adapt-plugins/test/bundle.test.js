// Structural checks for conf/plugin-bundle.json and the plugins that live in adapt-plugins/.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, 'conf', 'plugin-bundle.json'), 'utf8'));
const TYPES = ['component', 'extension', 'menu', 'theme'];

test('every entry has a group and exactly one of repo / path', () => {
  bundle.plugins.forEach(p => {
    assert.ok(p.group && p.name, `entry needs group and name: ${JSON.stringify(p)}`);
    assert.ok(Boolean(p.repo) !== Boolean(p.path), `${p.name} must have either repo or path`);
    if (p.repo) assert.match(p.repo, /^[\w.-]+\/[\w.-]+$/, `${p.name} repo should be owner/name`);
  });
});

test('no plugin is listed twice', () => {
  const keys = bundle.plugins.map(p => p.repo || p.path);
  assert.strictEqual(new Set(keys).size, keys.length);
});

bundle.plugins.filter(p => p.path).forEach(p => {
  test(`local plugin ${p.name} is installable by the authoring tool`, () => {
    const dir = path.join(ROOT, p.path);
    const bower = JSON.parse(fs.readFileSync(path.join(dir, 'bower.json'), 'utf8'));
    assert.strictEqual(bower.name, p.name, 'bower.json name matches the bundle name');
    assert.match(bower.version, /^\d+\.\d+\.\d+$/);
    const types = TYPES.filter(t => typeof bower[t] === 'string');
    assert.strictEqual(types.length, 1, 'exactly one plugin type key');
    assert.ok(bower.targetAttribute && bower.targetAttribute.startsWith('_'));
    // without a properties.schema the authoring tool silently ignores the plugin
    const schema = JSON.parse(fs.readFileSync(path.join(dir, 'properties.schema'), 'utf8'));
    assert.ok(schema.properties, 'properties.schema has properties');
    assert.ok(fs.existsSync(path.join(dir, 'LICENSE')), 'GPL licence file kept');
    // package.json and bower.json carry the same identity
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.name, bower.name);
    assert.strictEqual(pkg.version, bower.version);
  });
});

test('the look plugins declare the keys the config hook expects', () => {
  const { PREFERRED_LOOK } = require('../../plugins/content/config/preferredLook');
  PREFERRED_LOOK.forEach(look => {
    assert.ok(bundle.plugins.some(p => p.name === look.name && p.path), `${look.name} must be in the bundle as a local plugin`);
  });
});

test('Spoor is flagged to be added to every new course (SCORM export refuses without it)', () => {
  const spoor = bundle.plugins.find(p => p.name === 'adapt-contrib-spoor');
  assert.ok(spoor, 'adapt-contrib-spoor is in the bundle');
  assert.strictEqual(spoor.addedByDefault, true);
});
