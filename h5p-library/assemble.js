// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Turns a content-only .h5p file (just h5p.json and content/) into a complete one by adding the code of every
 * library it needs, taken from the library folder that install.js fills. The result is an ordinary .h5p package,
 * so it goes through the same approval and packaging steps as an uploaded file.
 *
 * Every library that the content uses is included, together with the libraries those need in turn (their
 * preloadedDependencies), listed dependencies-first as H5P requires. Libraries that are only used by the H5P
 * editor are not included.
 */
const archiver = require('archiver');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { subContentLibraries, readEntries } = require('./requirements');

const keyOf = d => `${d.machineName}-${d.majorVersion}.${d.minorVersion}`;
const SAFE_NAME = /^[\w.]+-\d+\.\d+$/;

/** Dependencies-first list of library keys needed to run the given libraries. */
function closure(roots, readLibrary) {
  const order = [];
  const state = new Map(); // key -> 'visiting' | 'done'
  const visit = (dep, via) => {
    const key = keyOf(dep);
    if (!SAFE_NAME.test(key)) throw new Error(`Unexpected library name "${key}"`);
    if (state.get(key) === 'done' || state.get(key) === 'visiting') return; // cycles are tolerated
    state.set(key, 'visiting');
    let lib;
    try {
      lib = readLibrary(key);
    } catch (error) {
      throw new Error(`The library ${key} is not installed${via ? ` (needed by ${via})` : ''}. Run the update routine to install the H5P libraries.`);
    }
    (lib.preloadedDependencies || []).forEach(d => visit(d, key));
    state.set(key, 'done');
    order.push(key);
  };
  roots.forEach(r => visit(r));
  return order;
}

/**
 * @param {object} options
 * @param {string} options.contentFile - content-only .h5p
 * @param {string} options.libraryDir - folder holding <machineName>-<major>.<minor> sub-folders
 * @param {string} options.outFile - where the complete .h5p is written
 * @returns {Promise<{libraries: string[]}>}
 */
async function assemble({ contentFile, libraryDir, outFile }) {
  const safe = name => !/(^|\/)\.\.(\/|$)/.test(name) && !path.isAbsolute(name);
  const entries = await readEntries(contentFile, name => (name === 'h5p.json' || /^content\//.test(name)) && safe(name));
  const metaEntry = entries.find(e => e.name === 'h5p.json');
  const contentEntry = entries.find(e => e.name === 'content/content.json');
  if (!metaEntry || !contentEntry) throw new Error('The activity file is not a valid H5P content file.');
  const meta = JSON.parse(metaEntry.data.toString('utf8'));

  const roots = (meta.preloadedDependencies || []).slice();
  subContentLibraries(JSON.parse(contentEntry.data.toString('utf8'))).forEach(key => {
    const m = /^(.+)-(\d+)\.(\d+)$/.exec(key);
    roots.push({ machineName: m[1], majorVersion: +m[2], minorVersion: +m[3] });
  });
  const readLibrary = key => JSON.parse(fs.readFileSync(path.join(libraryDir, key, 'library.json'), 'utf8'));
  const libraries = closure(roots, readLibrary);

  meta.preloadedDependencies = libraries.map(key => {
    const m = /^(.+)-(\d+)\.(\d+)$/.exec(key);
    return { machineName: m[1], majorVersion: m[2], minorVersion: m[3] };
  });

  await fs.promises.mkdir(path.dirname(outFile), { recursive: true });
  // Buffers are staged as real files: archiver 3 on Node 22 writes wrong sizes and checksums for appended
  // buffers, but zips files read from disk correctly.
  const staging = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'h5p-assemble-'));
  try {
    await fs.promises.writeFile(path.join(staging, 'h5p.json'), JSON.stringify(meta, null, 2));
    for (const e of entries.filter(x => x !== metaEntry)) {
      const target = path.join(staging, e.name);
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, e.data);
    }
    await writeArchive(staging, libraries, libraryDir, outFile);
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true });
  }
  return { libraries };
}

function writeArchive(staging, libraries, libraryDir, outFile) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(outFile);
    const archive = archiver('zip', { zlib: { level: 6 } });
    out.on('close', resolve);
    out.on('error', reject);
    archive.on('error', reject);
    archive.pipe(out);
    archive.glob('**/*', { cwd: staging, dot: true });
    libraries.forEach(key => archive.glob('**/*', { cwd: path.join(libraryDir, key), ignore: ['.locked-commit'], dot: true }, { prefix: key }));
    archive.finalize();
  });
}

/**
 * Copies a complete .h5p without the files H5P's importer refuses inside library folders (a LICENSE, lint settings,
 * translation settings...). Packages made before install.js started leaving those out need this before they can be
 * opened in the H5P editor. Content, h5p.json and every file of an allowed type are kept untouched.
 * @returns {Promise<{removed: number}>}
 */
async function cleanPackage({ file, outFile }) {
  const { isAllowedFile } = require('./install');
  const safe = name => !/(^|\/)\.\.(\/|$)/.test(name) && !path.isAbsolute(name);
  const entries = await readEntries(file, safe);
  const keep = entries.filter(e => e.name === 'h5p.json' || e.name.startsWith('content/') || isAllowedFile(e.name));
  const staging = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'h5p-clean-'));
  try {
    for (const e of keep) {
      const target = path.join(staging, e.name);
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, e.data);
    }
    await fs.promises.mkdir(path.dirname(outFile), { recursive: true });
    await writeArchive(staging, [], null, outFile);
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true });
  }
  return { removed: entries.length - keep.length };
}

module.exports = { assemble, closure, cleanPackage };
