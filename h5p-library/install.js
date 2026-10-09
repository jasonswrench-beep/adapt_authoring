#!/usr/bin/env node
// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Installs the H5P libraries pinned in lock.json into a library folder (one sub-folder per library, named
 * <machineName>-<major>.<minor>). Each library is fetched at the exact commit that was reviewed, built if its
 * repository does not ship built files, and checked: a library whose preloaded files are missing is reported
 * and left out, so a broken library can never half-work.
 *
 *   node install.js <outLibDir> [workDir] [lockFile]
 *
 * Idempotent: a library that is already installed at the locked commit is skipped.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const run = (cmd, args, cwd, timeout) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeout || 600000 });
const SKIP = new Set(['node_modules', '.git', '.github', 'test', 'tests', 'screenshots', '.gitignore', '.travis.yml']);

function fetchCommit(dir, repo, commit) {
  const url = /^https?:/.test(repo) ? repo : `https://github.com/${repo}`;
  fs.mkdirSync(dir, { recursive: true });
  run('git', ['init', '--quiet'], dir);
  run('git', ['fetch', '--quiet', '--depth', '1', url, commit], dir);
  run('git', ['checkout', '--quiet', 'FETCH_HEAD'], dir);
}

/** Fixes for upstream bugs live in patches/<library>.patch; they are applied to the pinned commit before building. */
function patchFor(key) {
  const file = path.join(__dirname, 'patches', `${key}.patch`);
  return fs.existsSync(file) ? file : null;
}

function build(dir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (!pkg.scripts || !pkg.scripts.build) throw new Error('has no build script');
  try {
    run('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], dir);
  } catch (e) {
    run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], dir);
  }
  run('npm', ['run', 'build'], dir);
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    if (entry.isDirectory()) copyTree(from, path.join(dest, entry.name));
    else if (entry.isFile()) fs.copyFileSync(from, path.join(dest, entry.name)); // symbolic links are never followed
  }
}

function install(outDir, workDir, lock, log) {
  const failures = [];
  fs.mkdirSync(outDir, { recursive: true });
  for (const key of Object.keys(lock)) {
    const entry = lock[key];
    const target = path.join(outDir, key);
    const marker = path.join(target, '.locked-commit');
    const patch = patchFor(key);
    const stamp = patch ? `${entry.commit}+${require('crypto').createHash('sha1').update(fs.readFileSync(patch)).digest('hex').slice(0, 8)}` : entry.commit;
    if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === stamp) { log(`${key}: already installed`); continue; }
    const src = path.join(workDir, key);
    try {
      if (!fs.existsSync(path.join(src, 'library.json'))) {
        fs.rmSync(src, { recursive: true, force: true });
        fetchCommit(src, entry.repo, entry.commit);
        if (patch) run('git', ['apply', patch], src);
      }
      const lib = JSON.parse(fs.readFileSync(path.join(src, 'library.json'), 'utf8'));
      const files = () => [].concat(lib.preloadedJs || [], lib.preloadedCss || []).map(f => f.path);
      if (files().some(f => !fs.existsSync(path.join(src, f)))) {
        log(`${key}: building`);
        build(src);
      }
      const missing = files().filter(f => !fs.existsSync(path.join(src, f)));
      if (missing.length) throw new Error(`files still missing after build: ${missing.join(', ')}`);
      fs.rmSync(target, { recursive: true, force: true });
      copyTree(src, target);
      fs.writeFileSync(marker, stamp + '\n');
      log(`${key}: installed`);
    } catch (e) {
      failures.push({ key, reason: String(e.stderr || e.message).trim().split('\n').slice(-3).join(' | ') });
      log(`${key}: FAILED - ${failures[failures.length - 1].reason}`);
    }
  }
  return failures;
}

if (require.main === module) {
  const [outDir, workDir = path.join(require('os').tmpdir(), 'h5p-library-work'), lockFile = path.join(__dirname, 'lock.json')] = process.argv.slice(2);
  if (!outDir) { console.error('usage: node install.js <outLibDir> [workDir] [lockFile]'); process.exit(2); }
  const failures = install(outDir, workDir, JSON.parse(fs.readFileSync(lockFile, 'utf8')), m => console.log(m));
  console.log(failures.length ? `${failures.length} librar${failures.length === 1 ? 'y' : 'ies'} could not be installed` : 'All H5P libraries installed');
  process.exitCode = failures.length ? 1 : 0;
}

module.exports = { install, copyTree };
