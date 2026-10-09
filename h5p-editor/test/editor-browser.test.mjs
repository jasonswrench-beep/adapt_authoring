// Drives the real H5P editor in a browser: opens an activity, changes its text, saves, and checks the saved package.
// Needs the editor data folder prepared (core, editor and libraries: see setup-core.sh and h5p-library/install.js
// --editor), Chromium and an assembled activity, so it only runs when H5P_EDITOR_TEST_DATA and H5P_EDITOR_TEST_PACKAGE
// are set. h5p-library/render-check.js's helpers can produce the package.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createApp } from '../server.mjs';
import { signedHeaders } from '../auth.mjs';

const require = createRequire(import.meta.url);
const DATA = process.env.H5P_EDITOR_TEST_DATA;
const PACKAGE = process.env.H5P_EDITOR_TEST_PACKAGE;
const SECRET = 'a-long-test-secret';
const skip = !DATA || !PACKAGE ? 'set H5P_EDITOR_TEST_DATA and H5P_EDITOR_TEST_PACKAGE to run' : false;

test('an activity can be opened, edited and saved in the editor, and exported with the change', { skip, timeout: 240000 }, async () => {
  const { chromium } = require(require.resolve('playwright-core', { paths: [path.join(import.meta.dirname, '..', '..', 'scripts', 'a11y-check')] }));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'h5p-editor-run-'));
  // a private copy of the prepared data so the test never changes it
  fs.cpSync(DATA, work, { recursive: true, filter: src => !/^\/(content|temporary|userdata)(\/|$)/.test(src.slice(DATA.length)) });
  const { app } = await createApp({ dataDir: work, secret: SECRET });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    // course tool step 1: put the activity into the editor
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(PACKAGE)]), 'activity.h5p');
    const imported = await fetch(`${base}/h5p-editor/internal/import`, { method: 'POST', body: form, headers: signedHeaders(SECRET, { id: 'u1', name: 'A' }, 'system') });
    assert.strictEqual(imported.status, 200, await imported.clone().text());
    const { contentId } = await imported.json();
    assert.ok(contentId);

    // the browser reaches the service only through the course tool, which adds the signature; do the same here
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    await context.route(`${base}/**`, route => route.continue({ headers: Object.assign({}, route.request().headers(), signedHeaders(SECRET, { id: 'u1', name: 'A' }, 'author')) }));
    let finishCalled = null;
    await context.route('**/api/content/component/*/h5peditor/finish', route => {
      finishCalled = JSON.parse(route.request().postData());
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
    const page = await context.newPage();
    const problems = [];
    page.on('pageerror', e => problems.push(e.message.slice(0, 200)));
    await page.goto(`${base}/h5p-editor/edit/${contentId}?component=abc&return=/done`);
    // change the text of an answer option. The editor draws itself inside an iframe and its text fields are rich-text
    // (contenteditable) boxes; typing into one is what an author does.
    const findBox = async () => {
      for (const frame of page.frames()) {
        const handle = await frame.evaluateHandle(() => [...document.querySelectorAll('[contenteditable="true"]')].find(e => e.textContent.trim() === 'Blue')).catch(() => null);
        const element = handle && handle.asElement();
        if (element) return element;
      }
      return null;
    };
    let box = null;
    for (let i = 0; i < 90 && !box; i++) { box = await findBox(); if (!box) await page.waitForTimeout(1000); }
    assert.ok(box, 'the editor never showed the answer options');
    await box.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Edited answer about blackcurrants');
    await box.evaluate(e => e.blur());
    await page.waitForTimeout(500);
    await page.click('#adapt-h5p-save');
    await page.waitForURL(u => new URL(u).pathname === '/done', { timeout: 60000 });
    assert.strictEqual(finishCalled && finishCalled.contentId, String(contentId), 'the page did not tell the course tool the activity was saved');

    // course tool step 2: take the finished activity out
    const exported = await fetch(`${base}/h5p-editor/internal/export/${contentId}`, { headers: signedHeaders(SECRET, { id: 'u1', name: 'A' }, 'system') });
    assert.strictEqual(exported.status, 200);
    const out = path.join(work, 'out.h5p');
    fs.writeFileSync(out, Buffer.from(await exported.arrayBuffer()));
    const { readEntries } = await import('../../h5p-library/requirements.js');
    const entries = await readEntries(out, name => name === 'content/content.json' || name === 'h5p.json');
    const content = entries.find(e => e.name === 'content/content.json').data.toString('utf8');
    assert.match(content, /Edited answer about blackcurrants/);
    assert.deepStrictEqual(problems, []);

    // course tool step 3: once handed back, the content is removed from the editor
    const gone = await fetch(`${base}/h5p-editor/internal/content/${contentId}`, { method: 'DELETE', headers: signedHeaders(SECRET, { id: 'u1', name: 'A' }, 'system') });
    assert.strictEqual(gone.status, 200);
    const again = await fetch(`${base}/h5p-editor/internal/export/${contentId}`, { headers: signedHeaders(SECRET, { id: 'u1', name: 'A' }, 'system') });
    assert.notStrictEqual(again.status, 200, 'the content should no longer exist');
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
