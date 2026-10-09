#!/usr/bin/env node
// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Works out which H5P libraries (and exactly which source versions) the activity gallery needs.
 *
 * Starting from the libraries each catalogue entry's content package asks for, this walks library.json
 * `preloadedDependencies` recursively, finds the matching tag in the library's GitHub repository, and writes
 * lock.json: machineName -> { repo, tag, commit, version }. Everything is pinned to a commit, so what the
 * server installs later is exactly what was reviewed here.
 *
 *   node resolve.js <cacheDir> <requirementsFile>
 * requirementsFile: JSON array of "H5P.MultiChoice-1.16" strings.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OWNERS = ['h5p', 'NDLANO', 'otacke', 'tunapanda', 'icc', 'jhlabs', 'Lumieducation'];
const OVERRIDES = require('./repo-overrides.json');

function kebab(name) {
  return name.replace(/^H5P\./, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

const git = (args, opts) => execFileSync('git', args, Object.assign({ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }, opts));

function candidates(machineName) {
  if (OVERRIDES[machineName]) return [OVERRIDES[machineName]];
  const slug = `h5p-${kebab(machineName)}`;
  return OWNERS.map(o => `${o}/${slug}`);
}

const repoUrl = repo => (/^https?:/.test(repo) ? repo : `https://github.com/${repo}`);

function listTags(repo) {
  try {
    const out = git(['ls-remote', '--tags', repoUrl(repo)]);
    const tags = new Map();
    out.split('\n').filter(Boolean).forEach(line => {
      const [sha, ref] = line.split('\t');
      const name = ref.replace('refs/tags/', '').replace(/\^\{\}$/, '');
      if (ref.endsWith('^{}') || !tags.has(name)) tags.set(name, sha);
    });
    return tags;
  } catch (e) {
    return new Map();
  }
}

/** Highest tag whose version is major.minor.* */
function pickTags(tags, major, minor) {
  const parse = t => { const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?$/.exec(t); return m && [+m[1], +m[2], +(m[3] || 0)]; };
  const matching = [...tags.keys()].map(t => ({ t, v: parse(t) })).filter(x => x.v && x.v[0] === major && x.v[1] === minor);
  matching.sort((a, b) => b.v[2] - a.v[2]);
  if (matching.length) return matching.map(x => x.t);
  // very old H5P repositories only have dated release tags; the library.json is checked after cloning
  const releases = [...tags.keys()].filter(t => /^release-/.test(t)).sort();
  return releases.length && ![...tags.keys()].some(t => parse(t)) ? [releases[releases.length - 1]] : [];
}

function resolve(cacheDir, requirements) {
  const lock = {};
  const problems = [];
  const queue = requirements.map(r => { const m = /^(.+)-(\d+)\.(\d+)$/.exec(r); return { name: m[1], major: +m[2], minor: +m[3], via: 'catalogue' }; });
  const seen = new Set();
  while (queue.length) {
    const req = queue.shift();
    const key = `${req.name}-${req.major}.${req.minor}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const dir = path.join(cacheDir, key);
    let found = null;
    let lib = null;
    const notes = [];
    for (const repo of candidates(req.name)) {
      for (const tag of pickTags(listTags(repo), req.major, req.minor)) {
        fs.rmSync(dir, { recursive: true, force: true });
        try {
          git(['clone', '--quiet', '--depth', '1', '--branch', tag, repoUrl(repo), dir]);
          const candidate = JSON.parse(fs.readFileSync(path.join(dir, 'library.json'), 'utf8'));
          // some tags are mislabelled, so the version inside the tag is what counts
          if (candidate.machineName === req.name && candidate.majorVersion === req.major && candidate.minorVersion === req.minor) { found = { repo, tag }; lib = candidate; break; }
          notes.push(`${repo} ${tag} contains ${candidate.machineName} ${candidate.majorVersion}.${candidate.minorVersion}`);
        } catch (e) {
          notes.push(`${repo} ${tag}: ${String(e.stderr || e.message).split('\n')[0]}`);
        }
      }
      if (found) break;
    }
    if (!found) { problems.push(`${key}: no usable source found (needed by ${req.via})${notes.length ? ' - ' + notes.slice(0, 2).join('; ') : ''}`); fs.rmSync(dir, { recursive: true, force: true }); continue; }
    const commit = git(['rev-parse', 'HEAD'], { cwd: dir }).trim();
    lock[key] = { machineName: lib.machineName, repo: found.repo, tag: found.tag, commit, version: `${lib.majorVersion}.${lib.minorVersion}.${lib.patchVersion}` };
    // editor dependencies are not needed to play content, only preloaded ones are followed
    (lib.preloadedDependencies || []).forEach(d => queue.push({ name: d.machineName, major: d.majorVersion, minor: d.minorVersion, via: key }));
    // files that must exist for the library to run
    const missing = [].concat(lib.preloadedJs || [], lib.preloadedCss || []).map(f => f.path).filter(f => !fs.existsSync(path.join(dir, f)));
    if (missing.length) lock[key].missingFiles = missing;
  }
  return { lock, problems };
}

if (require.main === module) {
  const [cacheDir, reqFile, outFile] = process.argv.slice(2);
  fs.mkdirSync(cacheDir, { recursive: true });
  const { lock, problems } = resolve(cacheDir, JSON.parse(fs.readFileSync(reqFile, 'utf8')));
  fs.writeFileSync(outFile || path.join(__dirname, 'lock.json'), JSON.stringify(lock, null, 2) + '\n');
  console.log(`${Object.keys(lock).length} libraries resolved`);
  const needBuild = Object.keys(lock).filter(k => lock[k].missingFiles);
  if (needBuild.length) console.log('Need a build step (missing files):\n  ' + needBuild.map(k => `${k}: ${lock[k].missingFiles.slice(0, 2).join(', ')}`).join('\n  '));
  if (problems.length) { console.log('PROBLEMS:\n  ' + problems.join('\n  ')); process.exitCode = 1; }
}

module.exports = { kebab, pickTags, resolve };
