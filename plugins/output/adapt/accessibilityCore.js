// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Logic behind the editor's "Check accessibility" button, kept free of app dependencies so it can be
 * unit tested. The rules themselves live in scripts/a11y-check (shared with the command line tool).
 */
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkContent } = require('../../../scripts/a11y-check/content-rules');

const CHECKER_DIR = path.join(__dirname, '..', '..', '..', 'scripts', 'a11y-check');
const SEVERITIES = ['error', 'warning', 'info'];

const asList = v => (Array.isArray(v) ? v : []).map(i => (i && typeof i.toObject === 'function' ? i.toObject() : i));
const first = v => (Array.isArray(v) ? v[0] : v) || {};

/** Component settings are stored under `properties`; flatten them the way the publish step does. */
function flatten(item) {
  const flat = Object.assign({}, item, item.properties);
  delete flat.properties;
  return flat;
}

function countBySeverity(findings) {
  return SEVERITIES.reduce((counts, s) => {
    counts[s] = findings.filter(f => f.severity === s).length;
    return counts;
  }, {});
}

/** Fast check of the saved course content (the object returned by OutputPlugin#getCourseJSON). */
function quickCheck(data) {
  const findings = checkContent({
    config: first(asList(data.config)),
    course: first(asList(data.course)),
    contentObjects: asList(data.contentobject),
    articles: asList(data.article),
    blocks: asList(data.block),
    components: asList(data.component).map(flatten)
  });
  findings.forEach(f => { f.where.id = String(f.where.id); });
  return { generated: new Date().toISOString(), counts: countBySeverity(findings), findings, deepAvailable: deepAvailable() };
}

/** The full (rendered) check needs the checker's dependencies and a Chrome/Chromium on the server. */
function deepAvailable(checkerDir = CHECKER_DIR) {
  if (!fs.existsSync(path.join(checkerDir, 'node_modules'))) return false;
  const { findChrome } = require(path.join(checkerDir, 'browser-check'));
  return !!findChrome();
}

/**
 * Runs the command line checker (axe-core in a headless browser) over a built course.
 * Always resolves; failures are reported in `reason` so the quick results are never lost.
 */
function runDeepCheck(buildFolder, opts = {}) {
  const checkerDir = opts.checkerDir || CHECKER_DIR;
  const run = opts.execFileFn || execFile;
  const timeoutMs = opts.timeoutMs || 180000;
  if (!fs.existsSync(path.join(checkerDir, 'node_modules'))) {
    return Promise.resolve({ ran: false, reason: 'The full check is not installed on this server.' });
  }
  if (!fs.existsSync(path.join(buildFolder, 'index.html'))) {
    return Promise.resolve({ ran: false, reason: 'No built preview was found for this course.' });
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-'));
  const out = path.join(tmp, 'report.json');
  const args = [path.join(checkerDir, 'a11y-check.js'), buildFolder, '--json', out, '--fail-on', 'never'];
  return new Promise(resolve => {
    run(process.execPath, args, { timeout: timeoutMs, cwd: checkerDir, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
      try {
        if (error) {
          const reason = error.killed
            ? 'The full check took too long and was stopped.'
            : `The full check failed: ${String(stderr || error.message).split('\n')[0].slice(0, 200)}`;
          return resolve({ ran: false, reason });
        }
        const report = JSON.parse(fs.readFileSync(out, 'utf8'));
        if (!report.browser || !report.browser.ran) {
          return resolve({ ran: false, reason: (report.browser && report.browser.reason) || 'The browser check did not run.' });
        }
        const errors = report.browser.errors || [];
        // a check that looked at nothing must never read as "all clear"
        if (!report.browser.pagesChecked) {
          const why = errors.length ? errors.slice(0, 2).join(' | ') : 'no pages were opened';
          return resolve({ ran: false, reason: `The browser could not open the course (${String(why).slice(0, 600)}).` });
        }
        resolve({
          ran: true,
          pagesChecked: report.browser.pagesChecked,
          errors,
          // content rules were already run (on the saved data) by quickCheck
          findings: report.findings.filter(f => f.rule.indexOf('axe:') === 0),
          review: report.review || []
        });
      } catch (e) {
        resolve({ ran: false, reason: `The full check result could not be read: ${e.message}` });
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
}

module.exports = { quickCheck, runDeepCheck, deepAvailable, countBySeverity, CHECKER_DIR };
