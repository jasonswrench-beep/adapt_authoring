// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Export step for the H5P Player component (adapt-component-h5p).
 *
 * The browser player needs each .h5p file unpacked into a folder, but authors upload the single .h5p file
 * to the asset library. After the course is built, every approved H5P component's file is unpacked into
 * <build>/h5p/<componentId>/ so previews, web exports and SCORM packages are self-contained.
 *
 * .h5p files come from users and contain JavaScript, so:
 *  - a file is only unpacked once an administrator has approved that exact file (see h5pApproval.js); an
 *    unapproved file stays packed and the activity shows a "waiting for approval" message instead;
 *  - extraction refuses unsafe paths and enforces size limits.
 *
 * Each activity folder gets a status.json ({status, sha256}) that the player reads before starting.
 */
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const yauzl = require('yauzl');
const { hashFile } = require('./h5pApproval');
const { safeDecode } = require('./h5pTrust');

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

/** Reads h5p.json out of a .h5p file without unpacking it. Rejects (readable message) if it is not an H5P file. */
function readH5pInfo(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zip) => {
      if (openError) return reject(new Error('it is not a valid H5P file (not a zip archive)'));
      let found = false;
      zip.on('error', () => reject(new Error('it is not a valid H5P file (damaged archive)')));
      zip.on('end', () => { if (!found) reject(new Error('it is not a valid H5P file (missing h5p.json)')); });
      zip.on('entry', entry => {
        if (entry.fileName !== 'h5p.json') return zip.readEntry();
        found = true;
        if (entry.uncompressedSize > 1024 * 1024) { zip.close(); return reject(new Error('it is not a valid H5P file (h5p.json is too large)')); }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) { zip.close(); return reject(streamError); }
          const chunks = [];
          stream.on('data', c => chunks.push(c));
          stream.on('error', reject);
          stream.on('end', () => {
            zip.close();
            try {
              const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              resolve({
                title: String(json.title || ''),
                mainLibrary: String(json.mainLibrary || ''),
                libraries: (json.preloadedDependencies || []).map(d => `${d.machineName}-${d.majorVersion}.${d.minorVersion}`)
              });
            } catch (e) {
              reject(new Error('it is not a valid H5P file (h5p.json is not valid JSON)'));
            }
          });
        });
      });
      zip.readEntry();
    });
  });
}

/**
 * Copies the file somewhere private. The approval is checked against the hash of this copy and the copy is what
 * gets unpacked, so the bytes that were approved are the bytes that run, even if the original changes meanwhile.
 */
async function snapshot(source) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p-snapshot-'));
  const file = path.join(dir, 'activity.h5p');
  await fs.copy(source, file);
  return { file, dispose: () => fs.remove(dir) };
}

const statusFile = dest => path.join(dest, 'status.json');

/** The status marker the player reads, or null if the activity has not been packaged. */
async function readStatus(dest) {
  try {
    return await fs.readJson(statusFile(dest));
  } catch (error) {
    return null;
  }
}

async function writeStatus(dest, status, sha256) {
  await fs.ensureDir(dest);
  await fs.writeJson(statusFile(dest), { status, sha256 });
}

/**
 * @param {object} options
 * @param {Array} options.components - the course's component JSON (settings already flattened)
 * @param {string} options.buildFolder - the built course folder (contains index.html and course/)
 * @param {object} options.approvals - an ApprovalStore (statusOf / recordPending). Required: nothing is
 *   unpacked without it, so a missing approval list can never let an unreviewed file through.
 * @param {{courseId: string, courseTitle: string}} [options.context] - recorded with pending files
 * @param {Map<string, string>} [options.trustedUploads] - asset filename -> uploader label for files uploaded by
 *   someone allowed to approve H5P files; those are approved automatically (never if already rejected)
 * @returns {Promise<{packaged: number, warnings: string[], pending: object[]}>}
 *   `pending` lists activities that are not approved (status 'pending' or 'rejected').
 *   Rejects with a readable Error if an archive is unusable.
 */
async function packageH5P({ components, buildFolder, approvals, context, limits, trustedUploads }) {
  const result = { packaged: 0, warnings: [], pending: [] };
  const players = (components || []).filter(c => c && c._component === COMPONENT && c._h5p && c._h5p._src);
  if (!players.length) return result;
  if (!approvals) throw new Error('H5P activities cannot be packaged: the approval list is not available.');
  const build = path.resolve(buildFolder);
  const unpackedSources = new Set(); // several components may use the same file, so remove sources at the end

  for (const component of players) {
    const label = component.displayTitle || component.title || component._id;
    const srcPath = safeDecode(component._h5p._src); // the path in the JSON is URL-encoded; the file on disk is not
    const source = path.resolve(build, srcPath);
    const dest = path.join(build, 'h5p', folderName(component._id));
    if (!source.startsWith(build + path.sep)) {
      throw new Error(`H5P activity "${label}": the file path is outside the course.`);
    }
    const notApproved = (status, sha256, extra) => result.pending.push(Object.assign({
      componentId: component._id, title: label, hash: sha256, fileName: path.basename(srcPath), status
    }, extra));

    if (!(await fs.pathExists(source))) {
      // an earlier build already unpacked (and removed) the file: check the approval still stands
      const earlier = await readStatus(dest);
      if (!earlier) { result.warnings.push(`H5P activity "${label}": file not found (${srcPath}).`); continue; }
      const now = await approvals.statusOf(earlier.sha256);
      if (earlier.status === 'approved' && now === 'approved') continue;
      if (now === 'approved') {
        result.warnings.push(`H5P activity "${label}" is now approved; rebuild the course (Force rebuild) to unpack it.`);
        notApproved('pending', earlier.sha256, { needsRebuild: true });
        continue;
      }
      // approval was withdrawn: take the unpacked copy down
      const status = now === 'rejected' ? 'rejected' : 'pending';
      await fs.emptyDir(dest);
      await writeStatus(dest, status, earlier.sha256);
      notApproved(status, earlier.sha256, { needsRebuild: true });
      continue;
    }

    const copy = await snapshot(source);
    try {
      let info;
      try {
        info = await readH5pInfo(copy.file);
      } catch (error) {
        throw new Error(`H5P activity "${label}" could not be unpacked: ${error.message}`);
      }
      const sha256 = await hashFile(copy.file);
      let decision = await approvals.statusOf(sha256);
      if (decision === 'unknown' || decision === 'pending') {
        const stat = await fs.stat(copy.file);
        const details = Object.assign({ fileName: path.basename(srcPath), size: stat.size }, info);
        const uploader = trustedUploads && trustedUploads.get(path.basename(srcPath));
        if (uploader && approvals.autoApprove) {
          if (await approvals.autoApprove(sha256, Object.assign({ seenIn: context ? [context] : [] }, details), uploader)) decision = 'approved';
        } else if (decision === 'unknown') {
          await approvals.recordPending(sha256, details, context);
          decision = 'pending';
        }
      }
      if (decision !== 'approved') {
        // keep the file in the build so approving it later does not need a rebuild; downloads are blocked by the caller
        await fs.emptyDir(dest);
        await writeStatus(dest, decision, sha256);
        notApproved(decision, sha256);
        continue;
      }

      await fs.emptyDir(dest);
      try {
        await extractZipSafely(copy.file, dest, limits);
        const missing = ['h5p.json', path.join('content', 'content.json')].filter(f => !fs.existsSync(path.join(dest, f)));
        if (missing.length) throw new Error(`it is not a valid H5P file (missing ${missing.join(', ')})`);
      } catch (error) {
        await fs.remove(dest);
        throw new Error(`H5P activity "${label}" could not be unpacked: ${error.message}`);
      }
      await writeStatus(dest, 'approved', sha256);
    } finally {
      await copy.dispose();
    }
    unpackedSources.add(source);
    result.packaged++;
  }
  // the unpacked copies are what the player uses
  for (const source of unpackedSources) await fs.remove(source);
  return result;
}

module.exports = { packageH5P, extractZipSafely, readH5pInfo, readStatus, folderName, COMPONENT, LIMITS };
