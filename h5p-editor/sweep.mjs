// Opens every catalogue activity in the real H5P editor and reports which ones load. Dev tool.
//   H5P_EDITOR_TEST_DATA=<prepared editor data> H5P_SWEEP_LIBS=<runtime library folder> node sweep.mjs [ids]
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { createRequire } from 'node:module';
import { createApp } from './server.mjs';
import { signedHeaders } from './auth.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright-core', { paths: [path.join(import.meta.dirname, '..', 'scripts', 'a11y-check')] }));
const { assemble } = require('../h5p-library/assemble.js');
const DATA = process.env.H5P_EDITOR_TEST_DATA; const LIBS = process.env.H5P_SWEEP_LIBS; const SECRET = 's';
const only = process.argv[2] ? process.argv[2].split(',') : null;
const catalogue = JSON.parse(fs.readFileSync('../h5p-library/catalogue.json', 'utf8')).filter(a => !only || only.includes(a.id));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-'));
fs.cpSync(DATA, work, { recursive: true, filter: src => !/^\/(content|temporary|userdata)(\/|$)/.test(src.slice(DATA.length)) });
const { app } = await createApp({ dataDir: work, secret: SECRET });
const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const results = {};
for (const a of catalogue) {
  const problems = [];
  try {
    const out = path.join(work, `${a.id}.h5p`);
    await assemble({ contentFile: `../h5p-library/content/${a.file}`, libraryDir: LIBS, outFile: out });
    const form = new FormData(); form.append('file', new Blob([fs.readFileSync(out)]), 'a.h5p');
    const imp = await fetch(base + '/h5p-editor/internal/import', { method: 'POST', body: form, headers: signedHeaders(SECRET, { id: 'u' }, 'system') });
    if (imp.status !== 200) throw new Error('import: ' + (await imp.text()).slice(0, 160));
    const { contentId } = await imp.json();
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
    await ctx.route(base + '/**', r => r.continue({ headers: { ...r.request().headers(), ...signedHeaders(SECRET, { id: 'u' }, 'author') } }));
    const page = await ctx.newPage();
    page.on('dialog', d => { problems.push('dialog: ' + d.message().slice(0, 100)); d.dismiss().catch(() => {}); });
    page.on('pageerror', e => problems.push('script: ' + String(e.message || JSON.stringify(e)).slice(0, 120)));
    page.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) problems.push(`${r.status()} ${r.url().replace(base, '').slice(0, 90)}`); });
    await page.goto(`${base}/h5p-editor/edit/${contentId}?component=x&return=/`);
    let loaded = false;
    for (let i = 0; i < 40 && !loaded; i++) {
      await page.waitForTimeout(1000);
      loaded = (await Promise.all(page.frames().map(f => f.evaluate(() => !!document.querySelector('.h5peditor .h5p-editor-field, .h5peditor [class*="field"], .h5peditor-label')).catch(() => false)))).some(Boolean);
    }
    if (!loaded) problems.push('editor form did not appear');
    await ctx.close();
  } catch (e) { problems.push(e.message.slice(0, 200)); }
  results[a.id] = problems;
  console.log(problems.length ? 'FAIL' : 'OK  ', a.id, [...new Set(problems)].slice(0, 4).join(' | '));
}
await browser.close(); server.close(); fs.rmSync(work, { recursive: true, force: true });
fs.writeFileSync(process.env.H5P_SWEEP_OUT || 'sweep-result.json', JSON.stringify(results, null, 1));
process.exit(0);
