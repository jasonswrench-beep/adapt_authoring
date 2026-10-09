#!/usr/bin/env node
// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Opens every activity in the catalogue in a real browser using the same H5P player the courses use, and reports
 * whether it started cleanly (no script errors, no missing files). It also saves a picture of each one, which the
 * gallery uses as its thumbnail.
 *
 *   node render-check.js <libraryDir> [thumbsDir] [id,id,...]
 * Needs Chromium (CHROME_PATH) and playwright-core (scripts/a11y-check).
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { assemble } = require('./assemble');
const { extractZipSafely } = require('../plugins/output/adapt/h5pPackaging');

const PLAYER = path.join(__dirname, '..', 'adapt-plugins', 'adapt-component-h5p', 'assets', 'h5p-player');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm' };
const PAGE = id => `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#fff;font-family:sans-serif}#h5p{width:760px;margin:0 auto}</style></head><body><div id="h5p"></div>
<script src="/player/main.bundle.js"></script>
<script>
window.__xapi = [];
new H5PStandalone.H5P(document.getElementById('h5p'), { h5pJsonPath: '/content/${id}', frameJs: '/player/frame.bundle.js', frameCss: '/player/styles/h5p.css', frame: false, copyright: false, export: false, icon: false, fullScreen: false })
  .then(function () { window.H5P.externalDispatcher.on('xAPI', function (e) { window.__xapi.push(e.data.statement.verb.id.split('/').pop()); }); window.__started = true; })
  .catch(function (e) { window.__failed = String(e && e.message || e); });
</script></body></html>`;

function serve(contentRoot) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      const base = url.startsWith('/player/') ? [PLAYER, url.slice(8)] : [contentRoot, url];
      if (url.startsWith('/page/')) { res.setHeader('Content-Type', 'text/html'); return res.end(PAGE(url.slice(6))); }
      const file = path.resolve(base[0], '.' + path.sep + base[1]);
      if (!file.startsWith(path.resolve(base[0]) + path.sep)) { res.statusCode = 403; return res.end(); }
      fs.readFile(file, (error, data) => {
        if (error) { res.statusCode = 404; return res.end(); }
        res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const [libraryDir, thumbsDir, only] = process.argv.slice(2);
  if (!libraryDir) { console.error('usage: node render-check.js <libraryDir> [thumbsDir] [ids]'); process.exit(2); }
  const { chromium } = require(require.resolve('playwright-core', { paths: [path.join(__dirname, '..', 'scripts', 'a11y-check')] }));
  const catalogue = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalogue.json'), 'utf8')).filter(a => !only || only.split(',').includes(a.id));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'h5p-render-'));
  const contentRoot = path.join(work, 'content');
  const server = await serve(work);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  if (thumbsDir) fs.mkdirSync(thumbsDir, { recursive: true });
  const results = [];
  for (const activity of catalogue) {
    const result = { id: activity.id, ok: false, problems: [] };
    results.push(result);
    try {
      const packed = path.join(work, `${activity.id}.h5p`);
      const { libraries } = await assemble({ contentFile: path.join(__dirname, 'content', activity.file), libraryDir, outFile: packed });
      result.libraries = libraries.length;
      await extractZipSafely(packed, path.join(contentRoot, activity.id));
      const page = await (await browser.newContext({ viewport: { width: 800, height: 600 }, reducedMotion: 'reduce' })).newPage();
      page.on('pageerror', e => result.problems.push(`script error: ${e.message.slice(0, 160)} @ ${String(e.stack || "").split("\n").slice(1, 3).join(" | ").slice(0, 200)}`));
      page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text() + m.location().url) && !/Failed to load resource/.test(m.text())) result.problems.push(`console: ${m.text().slice(0, 160)}`); });
      page.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) result.problems.push(`${r.status()} ${r.url().replace(/^http:\/\/127.0.0.1:\d+/, '')}`); });
      await page.goto(`http://127.0.0.1:${server.address().port}/page/${activity.id}`);
      await page.waitForFunction(() => window.__started || window.__failed, null, { timeout: 30000 });
      const failed = await page.evaluate(() => window.__failed);
      if (failed) result.problems.push(`player: ${failed}`);
      await page.waitForSelector('#h5p iframe', { timeout: 15000 });
      await page.waitForTimeout(3500);
      // picture-only activities (sliders, panoramas) have no text, so images and canvases count as visible too
      const body = page.frameLocator('#h5p iframe').locator('body');
      const text = await body.innerText({ timeout: 10000 }).catch(() => '');
      const visuals = await body.locator('img, canvas, video, svg').count().catch(() => 0);
      result.visibleText = text.trim().length + visuals;
      if (!result.visibleText) result.problems.push('nothing visible in the activity');
      if (thumbsDir) await page.locator('#h5p').screenshot({ path: path.join(thumbsDir, `${activity.id}.jpg`), type: 'jpeg', quality: 72 });
      result.ok = !result.problems.length;
      await page.context().close();
    } catch (error) {
      result.problems.push(error.message.slice(0, 200));
    }
    console.log(`${result.ok ? 'OK  ' : 'FAIL'} ${activity.id}${result.problems.length ? '\n       ' + [...new Set(result.problems)].slice(0, 6).join('\n       ') : ''}`);
  }
  await browser.close();
  server.close();
  fs.rmSync(work, { recursive: true, force: true });
  const bad = results.filter(r => !r.ok);
  console.log(`${results.length - bad.length} of ${results.length} activities started cleanly`);
  process.exitCode = bad.length ? 1 : 0;
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
