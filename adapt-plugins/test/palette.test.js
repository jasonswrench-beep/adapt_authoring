// WCAG contrast checks for the Modern theme palette (adapt-theme-modern/less/_defaults/_colors.less).
// Run: node --test adapt-plugins/test/palette.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const less = fs.readFileSync(path.join(__dirname, '..', 'adapt-theme-modern', 'less', '_defaults', '_colors.less'), 'utf8');
const color = name => {
  const m = new RegExp(`^@${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`, 'm').exec(less);
  assert.ok(m, `@${name} must be a 6-digit hex colour in _colors.less`);
  return m[1];
};
const channel = c => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const luminance = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// equivalent of LESS darken(): lower HSL lightness by `points` percentage points
const darken = (hex, points) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2 - points / 100;
  const s = d === 0 ? 0 : d / (1 - Math.abs(max + min - 1));
  const h = d === 0 ? 0 : max === r ? (((g - b) / d) % 6 + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = l - c / 2;
  const rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h) % 6].map(v => Math.round((v + m) * 255));
  return '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
};
const WHITE = '#FFFFFF';
// text pairings used by the theme and menu; WCAG AA needs 4.5:1 for normal text
const PAIRS = [
  ['body text on white', color('greyDark'), WHITE],
  ['headings on white', color('blueDark'), WHITE],
  ['links on white', color('blue'), WHITE],
  ['link hover, darken(@blue, 8%), on white', darken(color('blue'), 8), WHITE],
  ['primary button text on primary', WHITE, color('blue')],
  ['body text on soft grey surface', color('greyDark'), color('greyLight')],
  ['primary on soft grey surface', color('blue'), color('greyLight')],
  ['primary on tinted surface', color('blue'), color('indigoLight')],
  ['success text on white', color('teal'), WHITE],
  ['muted status text on white', '#4B5563', WHITE],
  ['validation success on white', '#166534', WHITE],
  ['validation error on white', '#B91C1C', WHITE],
  ['navigation icons on dark navigation', WHITE, color('greyDark')]
];

PAIRS.forEach(([name, fg, bg]) => {
  test(`contrast: ${name} (${fg} on ${bg}) is at least 4.5:1`, () => {
    const r = ratio(fg, bg);
    assert.ok(r >= 4.5, `${name} is only ${r.toFixed(2)}:1`);
  });
});

test('darken() helper matches the value LESS produces for @link-hover', () => {
  // verified against the compiled CSS of the built theme: darken(#3730A3, 8%) is #2c2783
  assert.strictEqual(darken('#3730A3', 8), '#2C2783');
});
