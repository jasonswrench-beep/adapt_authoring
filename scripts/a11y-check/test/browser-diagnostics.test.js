// A page that never finishes loading must produce an error that says what the page showed (needs Chromium; skipped without it).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkInBrowser, findChrome } = require('../browser-check');

test('a course that never loads is reported with what the page showed and what failed', { skip: !findChrome() && 'no Chromium available', timeout: 90000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stuck-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<html><body>Loading... please wait<script src="missing.js"></script></body></html>');
  const result = await checkInBrowser(root, [], { width: 800 });
  assert.strictEqual(result.pagesChecked, 0);
  assert.strictEqual(result.errors.length, 1);
  assert.match(result.errors[0], /Course menu: .*Timeout/);
  assert.match(result.errors[0], /page showed "Loading\.\.\. please wait"/);
  assert.match(result.errors[0], /HTTP 404: \/missing\.js/);
});
