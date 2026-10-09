#!/usr/bin/env node
/**
 * Accessibility checker for Adapt courses.
 *
 *   node a11y-check.js <build-folder | web-export.zip> [--html report.html] [--json report.json]
 *        [--no-browser] [--fail-on error|warning|never] [--browser /path/to/chrome]
 *
 * Input is a built course (the folder inside a Web export, or the .zip itself). A source course
 * (src/course) is accepted too, but then only the content rules run.
 * Exit code 1 if any finding at or above --fail-on (default: error) is found.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { checkContent } = require('./content-rules');
const { renderHtml, renderConsole } = require('./report');

function parseArgs(argv) {
  const o = { failOn: 'error', browser: true };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--html') o.html = argv[++i];
    else if (a === '--json') o.json = argv[++i];
    else if (a === '--fail-on') o.failOn = argv[++i];
    else if (a === '--no-browser') o.browser = false;
    else if (a === '--browser') o.browserPath = argv[++i];
    else if (a === '-h' || a === '--help') o.help = true;
    else rest.push(a);
  }
  o.input = rest[0];
  return o;
}

/** Find the folder holding course/<lang>/course.json (built) or src/course/<lang> (source). */
function locateCourse(root) {
  const candidates = [root, path.join(root, 'build'), path.join(root, 'src')];
  fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).forEach(d => candidates.push(path.join(root, d.name)));
  for (const dir of candidates) {
    const courseDir = path.join(dir, 'course');
    if (!fs.existsSync(courseDir)) continue;
    const langs = fs.readdirSync(courseDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && fs.existsSync(path.join(courseDir, d.name, 'course.json'))).map(d => d.name);
    if (langs.length) return { dir, courseDir, langs, built: fs.existsSync(path.join(dir, 'index.html')) };
  }
  throw new Error('Could not find a course (expected course/<lang>/course.json) in the input.');
}

function loadCourse(courseDir, lang) {
  const read = f => JSON.parse(fs.readFileSync(path.join(courseDir, f), 'utf8'));
  const configPath = fs.existsSync(path.join(courseDir, 'config.json')) ? path.join(courseDir, 'config.json') : null;
  return {
    config: configPath ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {},
    course: read(`${lang}/course.json`),
    contentObjects: read(`${lang}/contentObjects.json`),
    articles: read(`${lang}/articles.json`),
    blocks: read(`${lang}/blocks.json`),
    components: read(`${lang}/components.json`)
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.input) {
    console.log('Usage: node a11y-check.js <build-folder | web-export.zip> [--html report.html] [--json report.json] [--no-browser] [--fail-on error|warning|never]');
    process.exit(opts.help ? 0 : 1);
  }
  if (!fs.existsSync(opts.input)) throw new Error(`Not found: ${opts.input}`);
  let root = opts.input;
  let tmp;
  if (fs.statSync(root).isFile()) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-'));
    new AdmZip(root).extractAllTo(tmp, true);
    root = tmp;
  }
  try {
    const found = locateCourse(root);
    const lang = found.langs[0];
    const data = loadCourse(found.courseDir, lang);
    let findings = checkContent(data);
    const report = { input: opts.input, lang, generated: new Date().toISOString(), browser: { ran: false }, findings, review: [] };

    if (opts.browser && found.built) {
      const { checkInBrowser, findChrome } = require('./browser-check');
      if (!opts.browserPath && !findChrome()) {
        report.browser = { ran: false, reason: 'No Chrome/Chromium found. Set CHROME_PATH or pass --browser.' };
      } else {
        const routes = data.contentObjects.map(c => ({ id: c._id, title: (c.displayTitle || c.title || c._id).replace(/<[^>]*>/g, '') }));
        const b = await checkInBrowser(found.dir, routes, { browserPath: opts.browserPath });
        report.browser = { ran: true, pagesChecked: b.pagesChecked, errors: b.errors };
        report.findings = findings.concat(b.findings);
        report.review = b.review;
      }
    } else if (opts.browser) {
      report.browser = { ran: false, reason: 'Input is a source course, not a build; only content rules ran.' };
    }

    report.counts = ['error', 'warning', 'info'].reduce((c, s) => { c[s] = report.findings.filter(f => f.severity === s).length; return c; }, {});
    console.log(renderConsole(report));
    if (opts.json) fs.writeFileSync(opts.json, JSON.stringify(report, null, 2));
    if (opts.html) fs.writeFileSync(opts.html, renderHtml(report));
    const limit = { error: ['error'], warning: ['error', 'warning'], never: [] }[opts.failOn] || ['error'];
    process.exitCode = report.findings.some(f => limit.includes(f.severity)) ? 1 : 0;
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch(e => { console.error(`Error: ${e.message}`); process.exit(2); });
