// The Lessons menu must carry its own card styling so it is not plain text under themes (such as Vanilla) that do not
// style it, and must only use LESS variables every theme defines (an undefined variable breaks the whole course build).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PLUGIN = path.join(__dirname, '..', 'adapt-menu-lessons');
const less = name => fs.readFileSync(path.join(PLUGIN, 'less', name), 'utf8');

test('the menu styles its own cards, status label, number and button', () => {
  const item = less('lessonsMenuItem.less');
  for (const piece of ['&__inner', '&__number', '&__status-text', '&__button-container', '&__button']) assert.ok(item.includes(piece), piece);
  assert.match(less('lessonsMenu.less'), /&__title/);
  assert.match(less('lessonsMenu.less'), /&__header-inner/);
});

test('it uses no variable that only the Modern theme defines', () => {
  for (const name of ['lessonsMenu.less', 'lessonsMenuItem.less', 'lessonsMenuGroup.less']) {
    const code = less(name).split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    assert.ok(!/@accent/.test(code), `${name} uses @accent, which Vanilla does not define`);
  }
});

test('the version was raised so servers that already have the plugin pick up the styling', () => {
  const bower = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'bower.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'package.json'), 'utf8'));
  assert.strictEqual(bower.version, pkg.version);
  assert.notStrictEqual(bower.version, '1.0.0');
});
