/**
 * Renders a built Adapt course in headless Chromium and runs axe-core on the menu and every page.
 * Finds what content rules cannot: colour contrast, ARIA misuse, focus and landmark problems.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg', '.vtt': 'text/vtt', '.xml': 'text/xml', '.txt': 'text/plain'
};
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

function serve(root) {
  const resolvedRoot = path.resolve(root);
  const server = http.createServer((req, res) => {
    let file = path.join(resolvedRoot, decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(resolvedRoot)) { res.statusCode = 403; return res.end(); }
    if (file.endsWith(path.sep)) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
      res.end(data);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function findChrome() {
  const candidates = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  return candidates.find(p => p && fs.existsSync(p));
}

async function scrollThrough(page) {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < document.documentElement.scrollHeight + step; y += step) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
}

/**
 * @param {string} root folder containing index.html of the built course
 * @param {Array<{id, title}>} routes content objects to visit (the menu is always visited)
 * @returns {Promise<{findings: Array, review: Array, pagesChecked: number, errors: Array}>}
 */
async function checkInBrowser(root, routes, options = {}) {
  const { chromium } = require('playwright-core');
  const executablePath = options.browserPath || findChrome();
  const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  const server = await serve(root);
  const base = `http://127.0.0.1:${server.address().port}/index.html`;
  const result = { findings: [], review: [], pagesChecked: 0, errors: [] };
  let browser;
  try {
    browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
    const context = await browser.newContext({ viewport: { width: options.width || 1280, height: 900 }, reducedMotion: 'reduce' });
    const targets = [{ id: '', title: 'Course menu' }].concat(routes);
    for (const target of targets) {
      const page = await context.newPage();
      const label = target.title || target.id;
      const clues = [];
      const clue = text => { if (clues.length < 4 && !clues.includes(text)) clues.push(text); };
      page.on('pageerror', e => clue(`script error: ${String(e.message).split('\n')[0].slice(0, 120)}`));
      page.on('requestfailed', r => clue(`request failed: ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 80)} (${(r.failure() || {}).errorText || 'unknown'})`));
      page.on('response', r => { if (r.status() >= 400) clue(`HTTP ${r.status()}: ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 80)}`); });
      try {
        await page.goto(`${base}#/${target.id ? `id/${target.id}` : ''}`, { waitUntil: 'load' });
        await page.waitForFunction(() => document.querySelector('#wrapper .contentobject') && !/^Loading/.test(document.body.innerText.trim()), null, { timeout: 20000 });
        await page.waitForTimeout(600);
        await scrollThrough(page);
        await page.waitForTimeout(300);
        await page.addScriptTag({ content: axeSource });
        const axeResults = await page.evaluate(tags => window.axe.run(document, {
          runOnly: { type: 'tag', values: tags }, resultTypes: ['violations', 'incomplete']
        }), AXE_TAGS);
        result.pagesChecked++;
        axeResults.violations.forEach(v => result.findings.push(toFinding(v, label, target.id)));
        axeResults.incomplete.forEach(v => result.review.push(toFinding(v, label, target.id, true)));
      } catch (e) {
        // say what the page was showing, so a failure can be diagnosed from the report alone
        const shown = await page.evaluate(() => document.body ? document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 100) : '').catch(() => '');
        const detail = [shown ? `page showed "${shown}"` : 'page was blank'].concat(clues).join('; ');
        result.errors.push(`${label}: ${e.message.split('\n')[0]} [${detail}]`);
      } finally {
        await page.close();
      }
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }
  return result;
}

const SEVERITY = { critical: 'error', serious: 'error', moderate: 'warning', minor: 'info' };

function toFinding(v, pageTitle, pageId, needsReview) {
  const wcag = (v.tags.find(t => /^wcag\d{3,4}$/.test(t)) || '').replace('wcag', '').split('').join('.');
  return {
    rule: `axe:${v.id}`,
    severity: needsReview ? 'info' : (SEVERITY[v.impact] || 'warning'),
    wcag,
    where: { type: 'rendered page', id: pageId, title: pageTitle, page: pageTitle },
    message: `${v.help}${needsReview ? ' (needs manual review)' : ''}`,
    fix: v.helpUrl,
    nodes: v.nodes.slice(0, 5).map(n => ({ target: n.target.join(' '), html: n.html.slice(0, 160), summary: (n.failureSummary || '').replace(/\s+/g, ' ').slice(0, 220) })),
    nodeCount: v.nodes.length
  };
}

module.exports = { checkInBrowser, findChrome };
