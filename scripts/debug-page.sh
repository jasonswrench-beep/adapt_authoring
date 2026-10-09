#!/bin/sh
# Opens the newest built course in the server's headless Chromium and prints the full script errors, the browser's
# user agent and what the page shows. Read-only. Run on the server from the repository folder:  sh scripts/debug-page.sh
cd "$(dirname "$0")/.." || exit 1
docker compose exec -T -w /app/scripts/a11y-check adapt node - <<'JS'
const fs = require('fs'), http = require('http'), path = require('path'), cp = require('child_process');
const { chromium } = require('playwright-core');
const B = cp.execSync('ls -dt /app/temp/*/adapt_framework/courses/*/*/build | head -1').toString().trim();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const srv = http.createServer((q, r) => { let p = path.join(B, decodeURIComponent(q.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; fs.readFile(p, (e, d) => { if (e) { console.log('404', q.url); r.statusCode = 404; return r.end(); } r.setHeader('Content-Type', mime[path.extname(p)] || 'application/octet-stream'); r.end(d); }); });
srv.listen(0, async () => {
  const exe = process.env.CHROME_PATH;
  const b = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  console.log('browser:', b.version(), '| folder:', B);
  const pg = await b.newPage();
  pg.on('pageerror', e => console.log('PAGE ERROR:\n' + (e.stack || e.message).split('\n').slice(0, 6).join('\n')));
  pg.on('console', m => { if (['error', 'warning'].includes(m.type())) console.log('console.' + m.type() + ':', m.text().slice(0, 200)); });
  await pg.goto('http://127.0.0.1:' + srv.address().port + '/index.html');
  await pg.waitForTimeout(6000);
  console.log('user agent:', await pg.evaluate(() => navigator.userAgent));
  console.log('page shows:', JSON.stringify(await pg.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 120))));
  await b.close(); srv.close();
});
JS
