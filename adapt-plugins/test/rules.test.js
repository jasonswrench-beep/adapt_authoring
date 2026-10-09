// Tests for the Rules extension's decision logic (adapt-extension-rules/js/rulesCore.js).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

let core;
test.before(async () => {
  core = await import(pathToFileURL(path.join(__dirname, '..', 'adapt-extension-rules', 'js', 'rulesCore.js')).href);
});
const store = () => core.initialState([
  { name: 'Score', type: 'number', initial: '5' },
  { name: 'Name', type: 'text', initial: 'Pat' },
  { name: 'Flag', type: 'true/false', initial: 'TRUE' }
]);

test('variables start with typed values; bad or repeated names are ignored', () => {
  const s = core.initialState([
    { name: 'Score', type: 'number', initial: '5' }, { name: 'Score', type: 'number', initial: '9' },
    { name: 'Bad name!', type: 'number', initial: '1' }, { name: '1abc', type: 'text' }, { name: '', type: 'text' },
    { name: 'N', type: 'number', initial: 'abc' }, { name: 'T', type: 'weird', initial: 7 }
  ]);
  assert.deepStrictEqual(s.values, { Score: 5, N: 0, T: '7' });
  assert.strictEqual(s.types.T, 'text');
});

test('restoring keeps only known variables and re-applies their types', () => {
  const s = core.restore(store(), { Score: '12', Flag: 'false', Evil: 1, Name: 'Sam' });
  assert.deepStrictEqual(s.values, { Score: 12, Name: 'Sam', Flag: false });
  assert.deepStrictEqual(core.restore(store(), 'nonsense').values, store().values);
  assert.deepStrictEqual(core.restore(store(), null).values, store().values);
});

test('comparisons: numbers compare as numbers, text ignores case, contains is a substring test', () => {
  assert.ok(core.compare(10, '>', '9'), '10 > 9 numerically, not as text');
  assert.ok(core.compare(10, '≥', 10));
  assert.ok(core.compare(2, '<', '10'));
  assert.ok(core.compare('Pat', '=', 'pat'));
  assert.ok(core.compare('Pat', '≠', 'sam'));
  assert.ok(core.compare('Patricia', 'contains', 'TRI'));
  assert.ok(core.compare(true, '=', 'true'));
  assert.ok(!core.compare(true, '=', 'false'));
  assert.ok(!core.compare(1, '??', 1), 'unknown operator is never true');
});

test('a condition needs a known variable; no condition always runs', () => {
  const s = store();
  assert.ok(core.conditionMet(s, {}));
  assert.ok(core.conditionMet(s, { _ifVariable: 'Score', _ifOperator: '≥', _ifValue: '5' }));
  assert.ok(!core.conditionMet(s, { _ifVariable: 'Score', _ifOperator: '>', _ifValue: '5' }));
  assert.ok(!core.conditionMet(s, { _ifVariable: 'Missing', _ifOperator: '=', _ifValue: '' }));
});

test('rules are matched by event and by element id or class; disabled rules are skipped', () => {
  const rules = [
    { _when: 'viewed', _target: 'c-005' }, { _when: 'viewed', _target: '.intro' }, { _when: 'viewed', _target: 'intro', _isEnabled: false },
    { _when: 'completed', _target: 'c-005' }, { _when: 'start' }, { _when: 'variable', _watch: 'Score' }, { _when: 'viewed', _target: '' }
  ];
  const subject = { id: 'c-005', classes: ['intro'] };
  assert.strictEqual(core.rulesFor(rules, 'viewed', subject).length, 2);
  assert.strictEqual(core.rulesFor(rules, 'completed', subject).length, 1);
  assert.strictEqual(core.rulesFor(rules, 'start').length, 1);
  assert.strictEqual(core.rulesFor(rules, 'variable', 'Score').length, 1);
  assert.strictEqual(core.rulesFor(rules, 'variable', 'Other').length, 0);
  assert.strictEqual(core.rulesFor(rules, 'viewed', { id: 'c-999', classes: [] }).length, 0);
});

test('variable actions set, add and toggle, and report what changed', () => {
  const s = store();
  assert.deepStrictEqual(core.applyVariableAction(s, { _do: 'add-to-variable', _variable: 'Score', _value: '3' }), { changed: 'Score' });
  assert.strictEqual(s.values.Score, 8);
  assert.deepStrictEqual(core.applyVariableAction(s, { _do: 'set-variable', _variable: 'Score', _value: '8' }), { changed: null }, 'same value is not a change');
  core.applyVariableAction(s, { _do: 'set-variable', _variable: 'Name', _value: 'Sam' });
  assert.strictEqual(s.values.Name, 'Sam');
  core.applyVariableAction(s, { _do: 'toggle-variable', _variable: 'Flag' });
  assert.strictEqual(s.values.Flag, false);
  assert.deepStrictEqual(core.applyVariableAction(s, { _do: 'add-to-variable', _variable: 'Name', _value: '1' }), { changed: null }, 'cannot add to text');
  assert.deepStrictEqual(core.applyVariableAction(s, { _do: 'set-variable', _variable: 'Nope', _value: '1' }), { changed: null });
});

test('[[name]] is replaced by the value; unknown names are left alone', () => {
  const s = store();
  assert.strictEqual(core.substitute('Hi [[Name]], score [[Score]], flag [[Flag]], [[Other]], [[bad name]]', s), 'Hi Pat, score 5, flag true, [[Other]], [[bad name]]');
});

test('classesOf splits the editor Classes box', () => {
  assert.deepStrictEqual(core.classesOf({ _classes: '  one   two ' }), ['one', 'two']);
  assert.deepStrictEqual(core.classesOf({}), []);
});
