// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Export step for the H5P Player component (adapt-component-h5p).
 *
 * The browser player needs each .h5p file unpacked into a folder, but authors upload the single .h5p file
 * to the asset library. After the course is built, every H5P component's file is unpacked into
 * <build>/h5p/<componentId>/ so previews, web exports and SCORM packages are self-contained.
 *
 * .h5p files come from users, so extraction refuses unsafe paths and enforces size limits.
 */
const fs = require('fs-extra');
const path = require('path');
const yauzl = require('yauzl');

const COMPONENT = 'h5pPlayer';
const LIMITS = { maxFiles: 5000, maxEntryBytes: 100 * 1024 * 1024, maxTotalBytes: 250 * 1024 * 1024 };

/** Folder name for a component id; must match contentFolderFor() in the component's h5pEvents.js. */
const folderName = id => String(id).replace(/[^\w-]/g, '_');

/**
 * Unpacks a zip into destDir. Rejects absolute paths, '..' segments, too many files and oversized entries.
 * Symbolic links in the archive are written as plain files, never as links.
 */
function extractZipSafely(zipPath, destDir, limits) {
  const max = Object.assign({}, LIMITS, limits);
  const root = path.resolve(destDir);
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, validateEntrySizes: true }, (openError, zip) => {
      if (openError) return reject(openError);
      let files = 0;
      let total = 0;
      const fail = error => { zip.close(); reject(error); };
      zip.on('error', fail);
      zip.on('end', resolve);
      zip.on('entry', entry => {
        const target = path.resolve(root, entry.fileName);
        if (target !== root && !target.startsWith(root + path.sep)) {
          return fail(new Error(`Unsafe path in archive: ${entry.fileName}`));
        }
        if (/\/$/.test(entry.fileName)) {
          return fs.ensureDir(target).then(() => zip.readEntry(), fail);
        }
        files++;
        total += entry.uncompressedSize;
        if (files > max.maxFiles) return fail(new Error(`Archive has more than ${max.maxFiles} files`));
        if (entry.uncompressedSize > max.maxEntryBytes) return fail(new Error(`${entry.fileName} is larger than ${max.maxEntryBytes} bytes`));
        if (total > max.maxTotalBytes) return fail(new Error(`Archive is larger than ${max.maxTotalBytes} bytes when unpacked`));
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return fail(streamError);
          fs.ensureDir(path.dirname(target)).then(() => {
            const out = fs.createWriteStream(target);
            stream.on('error', fail);
            out.on('error', fail);
            out.on('finish', () => zip.readEntry());
            stream.pipe(out);
          }, fail);
        });
      });
      zip.readEntry();
    });
  });
}

/**
 * @param {object} options
 * @param {Array} options.components - the course's component JSON (settings already flattened)
 * @param {string} options.buildFolder - the built course folder (contains index.html and course/)
 * @returns {Promise<{packaged: number, warnings: string[]}>} rejects with a readable Error if an archive is unusable
 */
async function packageH5P({ components, buildFolder, limits }) {
  const result = { packaged: 0, warnings: [] };
  const players = (components || []).filter(c => c && c._component === COMPONENT && c._h5p && c._h5p._src);
  if (!players.length) return result;
  const build = path.resolve(buildFolder);
  const unpackedSources = new Set(); // several components may use the same file, so remove sources at the end

  for (const component of players) {
    const label = component.displayTitle || component.title || component._id;
    const source = path.resolve(build, component._h5p._src);
    const dest = path.join(build, 'h5p', folderName(component._id));
    if (!source.startsWith(build + path.sep)) {
      throw new Error(`H5P activity "${label}": the file path is outside the course.`);
    }
    if (!(await fs.pathExists(source))) {
      // a previous export already unpacked and removed the file
      if (!(await fs.pathExists(dest))) result.warnings.push(`H5P activity "${label}": file not found (${component._h5p._src}).`);
      continue;
    }
    await fs.emptyDir(dest);
    try {
      await extractZipSafely(source, dest, limits);
      const missing = ['h5p.json', path.join('content', 'content.json')].filter(f => !fs.existsSync(path.join(dest, f)));
      if (missing.length) throw new Error(`it is not a valid H5P file (missing ${missing.join(', ')})`);
    } catch (error) {
      await fs.remove(dest);
      throw new Error(`H5P activity "${label}" could not be unpacked: ${error.message}`);
    }
    unpackedSources.add(source);
    result.packaged++;
  }
  // the unpacked copies are what the player uses
  for (const source of unpackedSources) await fs.remove(source);
  return result;
}

module.exports = { packageH5P, extractZipSafely, folderName, COMPONENT, LIMITS };
