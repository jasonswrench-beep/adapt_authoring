// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * POST /api/asset/recording : stores a screen recording made in the editor's recorder as a video asset.
 * Multipart form: `file` (the WebM recording), `title`, `description`. The recording is converted to MP4 first, so it
 * plays in every browser, then added to the asset library like an uploaded file. It sits under /api/asset/ so the
 * existing role permissions apply (Course Creators may use it).
 */
const crypto = require('crypto');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { transcodeToMp4, isAcceptedRecording, RecordingError } = require('./recordingImport');

const clean = (value, max) => String(value === undefined || value === null ? '' : Array.isArray(value) ? value[0] : value).trim().slice(0, max);

/**
 * @param {object} app - the Origin app (usermanager, configuration)
 * @param {object} helpers - outputHelpers (importAsset)
 * @param {{transcode?: function}} [overrides] - tests replace the converter
 */
function handler(app, helpers, overrides = {}) {
  const IncomingForm = require('formidable').IncomingForm;
  const promisify = fn => new Promise((resolve, reject) => fn((error, result) => error ? reject(error) : resolve(result)));
  const transcode = overrides.transcode || transcodeToMp4;

  return async function postRecording(req, res) {
    const fail = (status, message) => res.status(status).json({ success: false, message });
    const temp = [];
    try {
      const user = app.usermanager.getCurrentUser();
      if (!user) return fail(403, 'Please sign in.');
      const form = new IncomingForm();
      form.maxFileSize = app.configuration.getConfig('maxFileUploadSize');
      const { fields, files } = await new Promise((resolve, reject) => form.parse(req, (error, f, u) => error ? reject(error) : resolve({ fields: f, files: u })));
      const upload = files && files.file;
      if (!upload) return fail(400, 'No recording was received.');
      temp.push(upload.path);
      if (!isAcceptedRecording(upload.name, upload.type)) return fail(400, 'That file is not a video recording.');

      const title = clean(fields.title, 200) || `Screen recording ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
      const description = clean(fields.description, 2000);
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'recording-'));
      temp.push(dir);
      const output = path.join(dir, 'recording.mp4');
      const { size } = await transcode(upload.path, output);

      const hash = crypto.createHash('sha1');
      await new Promise((resolve, reject) => fs.createReadStream(output).on('error', reject).on('data', c => hash.update(c)).on('end', resolve));
      const filename = `${hash.digest('hex')}.mp4`;
      const metadata = { idMap: {}, assetNameMap: {} };
      const meta = {
        oldId: filename, title, type: 'video/mp4', size, filename, description: description || title, path: output, tags: [],
        repository: app.configuration.getConfig('filestorage') || 'localfs', createdBy: user._id
      };
      await promisify(cb => helpers.importAsset(meta, metadata, cb));
      const assetId = metadata.idMap[filename];
      return res.json({ success: true, payload: { _id: assetId, title, filename: metadata.assetNameMap[assetId] || filename, size } });
    } catch (error) {
      const status = error instanceof RecordingError ? error.status : (error && /maxFileSize|exceeded/i.test(error.message) ? 413 : 500);
      return fail(status, status === 413 && !(error instanceof RecordingError) ? 'The recording is larger than the upload limit. Try a shorter recording.' : error.message);
    } finally {
      temp.forEach(f => fs.remove(f).catch(() => {}));
    }
  };
}

module.exports = handler;
