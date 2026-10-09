// Tests for the Slides component's decision logic (adapt-component-slides/js/slidesLogic.js).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

let logic;
test.before(async () => {
  logic = await import(pathToFileURL(path.join(__dirname, '..', 'adapt-component-slides', 'js', 'slidesLogic.js')).href);
});

test('clamp keeps the index inside the deck and survives junk', () => {
  assert.strictEqual(logic.clamp(-3, 5), 0);
  assert.strictEqual(logic.clamp(9, 5), 4);
  assert.strictEqual(logic.clamp(2.7, 5), 2);
  assert.strictEqual(logic.clamp(NaN, 5), 0);
  assert.strictEqual(logic.clamp(undefined, 5), 0);
});

test('free navigation allows any real slide and nothing else', () => {
  const free = target => logic.canGo({ target, count: 4, furthest: 0, isSequenced: false });
  assert.ok(free(0) && free(3));
  assert.ok(!free(-1) && !free(4) && !free(1.5) && !free(NaN) && !free('2'));
});

test('ordered navigation: back anywhere, forward only one past the furthest slide reached', () => {
  const go = (target, furthest) => logic.canGo({ target, count: 5, furthest, isSequenced: true });
  assert.ok(go(1, 0));
  assert.ok(!go(2, 0));
  assert.ok(go(0, 3) && go(2, 3) && go(4, 3));
  assert.ok(!go(5, 4));
});

test('progress text fills in the numbers and leaves other text alone', () => {
  assert.strictEqual(logic.progressText('', 2, 5), 'Slide 2 of 5');
  assert.strictEqual(logic.progressText(undefined, 1, 1), 'Slide 1 of 1');
  assert.strictEqual(logic.progressText('Step {{ current }}/{{total}} <b>', 3, 4), 'Step 3/4 <b>');
  assert.strictEqual(logic.progressText('Diapositiva {{current}} de {{total}}', 2, 3), 'Diapositiva 2 de 3');
});

test('button names say where they lead, strip markup, and handle the ends', () => {
  const items = [{ title: 'Intro' }, { title: 'Why <em>it</em> matters' }, { title: '' }];
  assert.strictEqual(logic.buttonLabel('next', items, 0), 'Next: Why it matters (slide 2 of 3)');
  assert.strictEqual(logic.buttonLabel('next', items, 1), 'Next (slide 3 of 3)');
  assert.strictEqual(logic.buttonLabel('back', items, 1), 'Back: Intro (slide 1 of 3)');
  assert.strictEqual(logic.buttonLabel('back', items, 0), 'Back');
  assert.strictEqual(logic.buttonLabel('next', items, 2), 'Next');
  assert.strictEqual(logic.buttonLabel('next', items, 0, { next: 'Siguiente' }), 'Siguiente: Why it matters (slide 2 of 3)');
});

test('keys: arrows step, Home and End jump, and right-to-left languages swap the arrows', () => {
  assert.strictEqual(logic.targetForKey('ArrowRight', 1, 4, false), 2);
  assert.strictEqual(logic.targetForKey('ArrowLeft', 1, 4, false), 0);
  assert.strictEqual(logic.targetForKey('ArrowRight', 3, 4, false), 3, 'stops at the end');
  assert.strictEqual(logic.targetForKey('ArrowLeft', 0, 4, false), 0, 'stops at the start');
  assert.strictEqual(logic.targetForKey('ArrowLeft', 1, 4, true), 2);
  assert.strictEqual(logic.targetForKey('ArrowRight', 1, 4, true), 0);
  assert.strictEqual(logic.targetForKey('Home', 2, 4), 0);
  assert.strictEqual(logic.targetForKey('End', 0, 4), 3);
  assert.strictEqual(logic.targetForKey('a', 0, 4), null);
  assert.strictEqual(logic.targetForKey('Tab', 0, 4), null);
});
