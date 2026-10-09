// Tests for the administrator's H5P approvals dialog markup (frontend/.../h5pApprovalReport.js).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

let report;
global.define = factory => { report = factory(); };
require(path.join(__dirname, '..', '..', 'frontend', 'src', 'modules', 'editor', 'global', 'h5pApprovalReport.js'));
delete global.define;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const t = (key, o) => key + (o ? JSON.stringify(o) : '');
const H = 'd'.repeat(64);
const entry = extra => Object.assign({ hash: H, fileName: 'quiz.h5p', size: 689040, title: 'Hello World', mainLibrary: 'H5P.TrueFalse', libraries: ['H5P.TrueFalse-1.6', 'H5P.Question-1.4'], seenIn: [{ courseId: 'c1', courseTitle: 'Study skills' }] }, extra);

test('a pending file shows what the administrator needs to decide, with approve and reject buttons', () => {
  const html = report.buildHtml({ pending: [entry()], approved: [], rejected: [] }, t, esc);
  assert.ok(html.includes('Hello World'));
  assert.ok(html.includes('quiz.h5p') && html.includes('673 KB'));
  assert.ok(html.includes('H5P.TrueFalse-1.6, H5P.Question-1.4'));
  assert.ok(html.includes('Study skills'));
  assert.ok(html.includes(`data-action="approve" data-hash="${H}"`));
  assert.ok(html.includes(`data-action="reject" data-hash="${H}"`));
  assert.ok(html.includes('app.h5pwarning'), 'the warning that H5P files are programs is always shown');
});

test('approved and rejected files offer to withdraw the decision', () => {
  const html = report.buildHtml({ pending: [], approved: [entry({ decidedBy: 'teacher@example.edu' })], rejected: [entry({ hash: 'e'.repeat(64) })] }, t, esc);
  assert.ok(html.includes(`data-action="revoke" data-hash="${H}"`));
  assert.ok(html.includes(`data-action="revoke" data-hash="${'e'.repeat(64)}"`));
  assert.ok(html.includes('teacher@example.edu'));
  assert.ok(!html.includes('data-action="approve"'));
});

test('text from uploaded files and courses is escaped (no HTML injection)', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const html = report.buildHtml({
    pending: [entry({ title: evil, fileName: evil, mainLibrary: evil, libraries: [evil], seenIn: [{ courseId: 'c', courseTitle: evil }] })],
    approved: [entry({ hash: 'f'.repeat(64), decidedBy: evil })], rejected: []
  }, t, esc);
  assert.ok(!html.includes('<img'), 'no raw tag survives');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('a malformed hash never reaches the page and gets no buttons', () => {
  ['"><script>alert(1)</script>', 'abc', 'D'.repeat(64), undefined].forEach(bad => {
    const html = report.buildHtml({ pending: [entry({ hash: bad })], approved: [], rejected: [] }, t, esc);
    assert.ok(!html.includes('data-hash'), String(bad));
    assert.ok(!html.includes('<script'), String(bad));
  });
});

test('empty states: nothing seen yet, and nothing waiting', () => {
  assert.ok(report.buildHtml({ pending: [], approved: [], rejected: [] }, t, esc).includes('app.h5pnoneseen'));
  const html = report.buildHtml({ pending: [], approved: [entry()], rejected: [] }, t, esc);
  assert.ok(html.includes('app.h5pnonepending'));
  assert.ok(!html.includes('app.h5pnoneseen'));
  assert.doesNotThrow(() => report.buildHtml(undefined, t, esc));
});

test('file sizes are shown in friendly units', () => {
  assert.strictEqual(report.formatSize(512), '512 B');
  assert.strictEqual(report.formatSize(2048), '2 KB');
  assert.strictEqual(report.formatSize(5 * 1024 * 1024), '5.0 MB');
  ['x', -1, NaN, undefined].forEach(v => assert.strictEqual(report.formatSize(v), ''));
});

test('each button has an accessible name that includes the activity, so identical buttons can be told apart', () => {
  const html = report.buildHtml({ pending: [entry({ title: 'Study habits quiz' }), entry({ hash: 'e'.repeat(64), title: 'Sort the tasks' })], approved: [], rejected: [] }, t, esc);
  assert.ok(html.includes('aria-label="app.h5papprove: Study habits quiz"'));
  assert.ok(html.includes('aria-label="app.h5papprove: Sort the tasks"'));
  // the label comes from uploaded data, so it is escaped too
  const evil = report.buildHtml({ pending: [entry({ title: '"><script>alert(1)</script>' })], approved: [], rejected: [] }, t, esc);
  assert.ok(!evil.includes('<script'));
});

test('an automatically approved file is badged and only offers "Do not approve"', () => {
  const html = report.buildHtml({ pending: [], approved: [entry({ auto: true, decidedBy: 'auto: uploaded by admin@example.edu' })], rejected: [] }, t, esc);
  assert.ok(html.includes('app.h5pautobadge'));
  assert.ok(html.includes(`data-action="reject" data-hash="${H}"`));
  assert.ok(!html.includes('data-action="revoke"'), 'withdrawing would just be re-approved on the next build');
  assert.ok(html.includes('auto: uploaded by admin@example.edu'));
});

test('a manually approved file has no badge', () => {
  const html = report.buildHtml({ pending: [], approved: [entry({ decidedBy: 'teacher@example.edu' })], rejected: [] }, t, esc);
  assert.ok(!html.includes('app.h5pautobadge'));
});
