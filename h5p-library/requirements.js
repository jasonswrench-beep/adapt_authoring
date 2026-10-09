#!/usr/bin/env node
// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Lists every H5P library a set of content-only .h5p files needs: the libraries named in h5p.json plus every
 * library used by sub-content inside content/content.json (a Course Presentation slide holding a Multiple Choice,
 * for example). Output: sorted JSON array of "H5P.Name-major.minor".
 *
 *   node requirements.js <contentDir> > requirements.json
 */
const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');

const LIBRARY_REF = /^([\w.]+) (\d+)\.(\d+)$/;

function readEntry(zipPath, name) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      let done = false;
      zip.on('end', () => { if (!done) reject(new Error(`${name} not found in ${path.basename(zipPath)}`)); });
      zip.on('entry', entry => {
        if (entry.fileName !== name) return zip.readEntry();
        done = true;
        zip.openReadStream(entry, (e, stream) => {
          if (e) return reject(e);
          const chunks = [];
          stream.on('data', c => chunks.push(c));
          stream.on('end', () => { zip.close(); resolve(Buffer.concat(chunks).toString('utf8')); });
        });
      });
      zip.readEntry();
    });
  });
}

/** Library references ("H5P.Image 1.1") found anywhere inside parsed content JSON. */
function subContentLibraries(node, found = new Set()) {
  if (Array.isArray(node)) node.forEach(n => subContentLibraries(n, found));
  else if (node && typeof node === 'object') {
    Object.keys(node).forEach(key => {
      const value = node[key];
      if (key === 'library' && typeof value === 'string' && LIBRARY_REF.test(value)) {
        const m = LIBRARY_REF.exec(value);
        found.add(`${m[1]}-${m[2]}.${m[3]}`);
      }
      subContentLibraries(value, found);
    });
  }
  return found;
}

async function requirementsOf(zipPath) {
  const meta = JSON.parse(await readEntry(zipPath, 'h5p.json'));
  const found = new Set((meta.preloadedDependencies || []).map(d => `${d.machineName}-${d.majorVersion}.${d.minorVersion}`));
  subContentLibraries(JSON.parse(await readEntry(zipPath, 'content/content.json')), found);
  return found;
}

/** All file entries (not folders) of a zip whose name passes the filter, as [{name, data}]. */
function readEntries(zipPath, filter) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const result = [];
      zip.on('error', reject);
      zip.on('end', () => resolve(result));
      zip.on('entry', entry => {
        if (/\/$/.test(entry.fileName) || !filter(entry.fileName)) return zip.readEntry();
        zip.openReadStream(entry, (e, stream) => {
          if (e) return reject(e);
          const chunks = [];
          stream.on('data', c => chunks.push(c));
          stream.on('error', reject);
          stream.on('end', () => { result.push({ name: entry.fileName, data: Buffer.concat(chunks) }); zip.readEntry(); });
        });
      });
      zip.readEntry();
    });
  });
}

module.exports = { requirementsOf, subContentLibraries, readEntry, readEntries };

if (require.main === module) {
  (async () => {
    const dir = process.argv[2];
    const all = new Set();
    for (const file of fs.readdirSync(dir).filter(f => /\.h5p$/i.test(f))) {
      (await requirementsOf(path.join(dir, file))).forEach(r => all.add(r));
    }
    process.stdout.write(JSON.stringify([...all].sort(), null, 1) + '\n');
  })().catch(e => { console.error(e.message); process.exit(1); });
}
