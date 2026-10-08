// Tests for the editor's "Check accessibility" button: server core and report builder.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('../../../plugins/output/adapt/accessibilityCore');

// the report builder is an AMD module; load it with a tiny define() shim
let report;
global.define = factory => { report = factory(); };
require('../../../frontend/src/modules/editor/global/accessibilityReport');
delete global.define;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const t = (key, o) => key + (o ? JSON.stringify(o) : '');

// shaped like OutputPlugin#getCourseJSON: arrays of records, ObjectId-like ids, settings under `properties`
const oid = hex => ({ toString: () => hex, toJSON: () => hex });
function courseData(componentOverrides = {}) {
  return {
    course: [{ _id: oid('c0'), _type: 'course', title: 'Course' }],
    config: [{ _defaultLanguage: 'en', _accessibility: { _isEnabled: true, _isSkipNavigationEnabled: true } }],
    contentobject: [{ _id: oid('p1'), _parentId: oid('c0'), _type: 'page', title: 'Page <b>one</b>', displayTitle: 'Page <b>one</b>' }],
    article: [{ _id: oid('a1'), _parentId: oid('p1'), _type: 'article', title: 'A' }],
    block: [{ _id: oid('b1'), _parentId: oid('a1'), _type: 'block', title: 'B' }],
    component: [Object.assign({
      _id: oid('k1'), _parentId: oid('b1'), _type: 'component', _component: 'media', title: 'Video',
      properties: { _media: { mp4: 'a.mp4' }, _transcript: {} }
    }, componentOverrides)]
  };
}

test('quickCheck flattens component properties and reports findings with string ids', () => {
  const result = core.quickCheck(courseData());
  const rules = result.findings.map(f => f.rule);
  assert.ok(rules.includes('media-transcript'), 'rules read settings stored under properties');
  result.findings.forEach(f => assert.strictEqual(typeof f.where.id, 'string'));
  assert.strictEqual(result.counts.error, result.findings.filter(f => f.severity === 'error').length);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.strictEqual(typeof result.deepAvailable, 'boolean');
});

test('quickCheck accepts mongoose-style documents (toObject)', () => {
  const data = courseData();
  data.component = data.component.map(c => ({ toObject: () => c }));
  assert.ok(core.quickCheck(data).findings.length > 0);
});

test('quickCheck tolerates missing collections', () => {
  assert.doesNotThrow(() => core.quickCheck({ course: [{ _id: 'c', title: 'x' }] }));
});

test('runDeepCheck: not installed / no build', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'nochecker-'));
  assert.match((await core.runDeepCheck('/x', { checkerDir: empty })).reason, /not installed/);
  fs.mkdirSync(path.join(empty, 'node_modules'));
  assert.match((await core.runDeepCheck(path.join(empty, 'nobuild'), { checkerDir: empty })).reason, /No built preview/);
});

function fakeChecker({ error, stderr, report: reportJson }) {
  const checkerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checker-'));
  fs.mkdirSync(path.join(checkerDir, 'node_modules'));
  const build = fs.mkdtempSync(path.join(os.tmpdir(), 'build-'));
  fs.writeFileSync(path.join(build, 'index.html'), '');
  const execFileFn = (cmd, args, opts, cb) => {
    if (reportJson) fs.writeFileSync(args[args.indexOf('--json') + 1], JSON.stringify(reportJson));
    cb(error || null, '', stderr || '');
  };
  return { checkerDir, build, execFileFn };
}

test('runDeepCheck: success keeps only axe findings and the review list', async () => {
  const f = fakeChecker({ report: {
    browser: { ran: true, pagesChecked: 3, errors: ['x'] },
    findings: [{ rule: 'axe:color-contrast', severity: 'error' }, { rule: 'image-alt-missing', severity: 'error' }],
    review: [{ rule: 'axe:x', severity: 'info' }]
  } });
  const r = await core.runDeepCheck(f.build, f);
  assert.strictEqual(r.ran, true);
  assert.strictEqual(r.pagesChecked, 3);
  assert.deepStrictEqual(r.findings.map(x => x.rule), ['axe:color-contrast']);
  assert.strictEqual(r.review.length, 1);
});

test('runDeepCheck: failures become a reason, never a throw', async () => {
  let f = fakeChecker({ error: Object.assign(new Error('boom'), { killed: true }) });
  assert.match((await core.runDeepCheck(f.build, f)).reason, /too long/);
  f = fakeChecker({ error: new Error('x'), stderr: 'Error: Chromium crashed\nstack...' });
  assert.match((await core.runDeepCheck(f.build, f)).reason, /Chromium crashed/);
  f = fakeChecker({ report: { browser: { ran: false, reason: 'No Chrome/Chromium found.' }, findings: [], review: [] } });
  assert.match((await core.runDeepCheck(f.build, f)).reason, /No Chrome/);
  f = fakeChecker({});
  assert.match((await core.runDeepCheck(f.build, f)).reason, /could not be read/);
});

test('report: summary counts include full-check findings only when it ran', () => {
  const payload = { findings: [{ severity: 'error' }, { severity: 'warning' }], deep: { ran: true, findings: [{ severity: 'error' }], review: [] } };
  assert.deepStrictEqual(report.summarise(payload), { errors: 2, warnings: 1, info: 0, total: 3 });
  payload.deep = { ran: false, reason: 'x' };
  assert.strictEqual(report.summarise(payload).total, 2);
});

test('report: course-supplied text is escaped (no HTML injection)', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const html = report.buildHtml({
    findings: [{ rule: 'r', severity: 'error', wcag: '1.1.1', message: 'Problem ' + evil, fix: 'Fix ' + evil,
      where: { type: 'text component', title: evil, page: evil } }],
    deep: { ran: false, reason: evil }
  }, t, esc);
  assert.ok(!html.includes('<img'), 'no raw tag from content');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('report: only axe-core help links are rendered as links', () => {
  const mk = fix => report.buildHtml({ findings: [{ rule: 'axe:x', severity: 'error', message: 'm', fix, where: {} }] }, t, esc);
  assert.ok(mk('https://dequeuniversity.com/rules/axe/4.14/image-alt').includes('<a href="https://dequeuniversity.com/'));
  assert.ok(!mk('javascript:alert(1)').includes('<a '));
  assert.ok(!mk('https://evil.example/').includes('<a '));
});

test('report: groups repeats, truncates long place lists, handles an empty result', () => {
  const places = n => Array.from({ length: n }, (_, i) => ({ type: 'graphic', title: 'T' + i }));
  const findings = places(8).map(w => ({ rule: 'image-alt-missing', severity: 'error', message: 'No alt', where: w }));
  const html = report.buildHtml({ findings }, t, esc);
  assert.strictEqual((html.match(/a11y-group/g) || []).length, 1);
  assert.ok(html.includes('app.a11ymore{&quot;count&quot;:3}'), 'shows how many places were hidden');
  assert.ok(report.buildHtml({ findings: [] }, t, esc).includes('app.a11ynone'));
});
