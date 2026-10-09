// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * The H5P activity library: a catalogue of ready-made activities an author can pick from, instead of uploading an
 * .h5p file. Choosing one fills an H5P Player component with a complete, pre-approved activity.
 *
 * The app-specific work is passed in as `deps`, so this can be tested without a database:
 *   deps.importAsset({ file, path, size, title, description }) -> Promise<{ assetId, filename }>
 *   deps.clearAssetLinks(component)            -> Promise
 *   deps.linkAsset(component, assetId, filename) -> Promise
 *   deps.saveComponent(component, changes)     -> Promise   (changes: { _setCompletionOn, _h5p })
 *   deps.approve(hash, info)                   -> Promise<boolean>   (false if an administrator rejected the file)
 */
const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');

const LIBRARY_ROOT = path.join(__dirname, '..', '..', '..', 'h5p-library');
const COMPONENT = 'h5pPlayer';
const ID = /^[a-z0-9-]+$/;

class LibraryError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 400;
  }
}

/** The catalogue, with `available` set from the libraries that are installed on this server. */
async function loadCatalogue({ libraryDir, root = LIBRARY_ROOT }) {
  const catalogue = await fs.readJson(path.join(root, 'catalogue.json'));
  let lock = {};
  try { lock = await fs.readJson(path.join(root, 'lock.json')); } catch (error) { /* no lock: nothing is available */ }
  const installed = new Set();
  try { (await fs.readdir(libraryDir)).forEach(name => installed.add(name)); } catch (error) { /* not installed yet */ }
  const hasLibraries = installed.size > 0 && Object.keys(lock).length > 0 && Object.keys(lock).every(k => installed.has(k));
  return catalogue.map(a => Object.assign({}, a, {
    available: hasLibraries,
    thumbnail: fs.pathExistsSync(path.join(root, 'thumbs', `${a.id}.jpg`))
  }));
}

/**
 * The complete .h5p for an activity. It is built once and kept (named after what went into it), so choosing the
 * same activity again gives the same bytes: one asset in the library and one approval, however many times it is used.
 */
async function packageFor(activity, { libraryDir, cacheDir, root = LIBRARY_ROOT, assemble = require('../../../h5p-library/assemble').assemble }) {
  const contentFile = path.join(root, 'content', activity.file);
  const lock = await fs.readJson(path.join(root, 'lock.json'));
  const content = await fs.readFile(contentFile);
  const recipe = crypto.createHash('sha256').update(content).update(JSON.stringify(lock)).digest('hex').slice(0, 10);
  const file = path.join(cacheDir, `library-${activity.id}-${recipe}.h5p`);
  if (!(await fs.pathExists(file))) {
    await fs.ensureDir(cacheDir);
    const temp = `${file}.${process.pid}.tmp`;
    await assemble({ contentFile, libraryDir, outFile: temp });
    await fs.move(temp, file, { overwrite: true });
  }
  return file;
}

async function sha256(file) {
  return require('./h5pApproval').hashFile(file);
}

/** The asset library names a stored file after the SHA-1 of its bytes, and reuses an asset whose name and size match. */
function sha1(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    fs.createReadStream(file).on('error', reject).on('data', c => hash.update(c)).on('end', () => resolve(hash.digest('hex')));
  });
}

async function addActivityToComponent({ activityId, component, deps, libraryDir, cacheDir, root = LIBRARY_ROOT, assemble }) {
  if (!component || component._component !== COMPONENT) throw new LibraryError('The activity library only works on an H5P Player component.');
  if (!ID.test(String(activityId))) throw new LibraryError('Unknown activity.', 404);
  const catalogue = await loadCatalogue({ libraryDir, root });
  const activity = catalogue.find(a => a.id === activityId);
  if (!activity) throw new LibraryError('Unknown activity.', 404);
  if (!activity.available) {
    throw new LibraryError('The H5P activity libraries are not installed on this server yet. An administrator needs to run the update routine (see the setup guide).', 503);
  }

  let file;
  try {
    file = await packageFor(activity, { libraryDir, cacheDir, root, assemble });
  } catch (error) {
    throw new LibraryError(`"${activity.title}" could not be prepared: ${error.message}`, 500);
  }
  const hash = await sha256(file);
  const stat = await fs.stat(file);
  const { readH5pInfo } = require('./h5pPackaging');
  const info = await readH5pInfo(file);

  const approved = await deps.approve(hash, Object.assign({ fileName: path.basename(file), size: stat.size }, info));
  if (!approved) throw new LibraryError(`An administrator has rejected "${activity.title}", so it cannot be added.`, 403);

  const asset = await deps.importAsset({ file: `${await sha1(file)}.h5p`, path: file, size: stat.size, title: `${activity.title} (H5P activity library)`, description: activity.summary });
  await deps.clearAssetLinks(component);
  await deps.linkAsset(component, asset.assetId, asset.filename);
  const previous = (component.properties && component.properties._h5p) || {};
  await deps.saveComponent(component, {
    _setCompletionOn: activity.completion === 'activity' ? 'completed' : 'inview',
    _h5p: Object.assign({}, previous, { _src: `course/assets/${asset.filename}` })
  });
  return { id: activity.id, title: activity.title, completion: activity.completion, notes: activity.notes || '' };
}

module.exports = { loadCatalogue, addActivityToComponent, packageFor, LibraryError, LIBRARY_ROOT };
