// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Routes that connect an H5P Player component to the H5P editor service. Under /api/content/component/:id/ so the
 * existing role permissions apply (Course Creators may use them):
 *   POST /content/component/:id/h5peditor/start  {mode: 'edit' | 'new', returnTo}  -> {url} to open the editor
 *   POST /content/component/:id/h5peditor/finish {contentId}                        takes the finished activity
 * Both check that the user may change the component before anything happens. `start` also opens the user's editor
 * session (the /h5p-editor/* proxy refuses anyone without it).
 */
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { attachPackageToComponent, LibraryError } = require('./h5pLibrary');
const { settings, createClient, EditorError, BASE } = require('./h5pEditorClient');
const { readH5pInfo } = require('./h5pPackaging');

/** Main libraries whose editing widgets could not be installed (h5p-library/not-editable.json). */
function notEditable() {
  try { return fs.readJsonSync(path.join(__dirname, '..', '..', '..', 'h5p-library', 'not-editable.json')); } catch (error) { return []; }
}

const SESSION_HOURS = 4;

/** Only paths on this site are accepted as the place to return to. */
const safeReturn = value => (typeof value === 'string' && /^\/(?!\/)[^\s\\]*$/.test(value) ? value : '/');

function handler(app, helpers, approvalStore, env = process.env, overrides = {}) {
  const { authorise, makeDeps, promisify } = require('./h5pComponentAccess')(app, helpers);

  let config = settings(env);
  const wrap = fn => async (req, res) => {
    try {
      config = settings(env);
      if (!config.enabled) return res.status(503).json({ success: false, message: 'The H5P editor is not set up on this server yet. An administrator needs to start it (see the setup guide).' });
      await fn(req, res);
    } catch (error) {
      const status = error instanceof LibraryError || error instanceof EditorError ? error.status : 500;
      res.status(status).json({ success: false, message: error.message });
    }
  };

  /** The component's current .h5p copied to a temporary file, or null when it has none. */
  async function currentPackage(component, user, dir) {
    const src = component.properties && component.properties._h5p && component.properties._h5p._src;
    if (!src) return null;
    const filename = decodeURIComponent(path.basename(String(src)));
    const assets = await promisify(cb => app.assetmanager.retrieveAsset({ filename }, cb));
    if (!assets || !assets.length) return null;
    const asset = assets[0];
    const storage = await promisify(cb => require('../../../lib/filestorage').getStorage(asset.repository, cb));
    const target = path.join(dir, 'current.h5p');
    await new Promise((resolve, reject) => {
      storage.createReadStream(asset.path, stream => {
        if (!stream) return reject(new Error('The activity file could not be read.'));
        const out = fs.createWriteStream(target);
        stream.on('error', reject);
        out.on('error', reject).on('finish', resolve);
        stream.pipe(out);
      });
    });
    return target;
  }

  return {
    start: wrap(async (req, res) => {
      const ctx = await authorise(req, res);
      if (!ctx) return;
      const mode = req.body && req.body.mode === 'new' ? 'new' : 'edit';
      if (ctx.component._component !== 'h5pPlayer') throw new LibraryError('The H5P editor only works on an H5P Player component.');
      const client = createClient({ url: config.url, secret: config.secret });
      const query = `component=${encodeURIComponent(ctx.component._id)}&return=${encodeURIComponent(safeReturn(req.body && req.body.returnTo))}`;
      let target = `${BASE}/new?${query}`;
      if (mode === 'edit') {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p-edit-'));
        try {
          const file = await (overrides.currentPackage || currentPackage)(ctx.component, ctx.user, dir);
          if (!file) throw new LibraryError('This component has no activity yet. Choose one from the activity library first, or use "Create a new activity".', 400);
          const { mainLibrary } = await readH5pInfo(file).catch(() => ({}));
          if (mainLibrary && (overrides.notEditable || notEditable)().includes(mainLibrary)) {
            throw new LibraryError('This kind of activity can be used in a course but not edited in this tool. Edit it in the free Lumi desktop editor and upload the file with "Select an Asset", or choose a different activity.', 400);
          }
          // packages made before library folders were trimmed hold files H5P's importer refuses, so tidy the copy first
          const tidy = path.join(dir, 'tidy.h5p');
          await require('../../../h5p-library/assemble').cleanPackage({ file, outFile: tidy });
          const contentId = await client.importPackage(ctx.user, tidy);
          target = `${BASE}/edit/${encodeURIComponent(contentId)}?${query}`;
        } finally {
          fs.remove(dir).catch(() => {});
        }
      }
      req.session.h5pEditorUntil = Date.now() + SESSION_HOURS * 3600 * 1000;
      res.json({ success: true, payload: { url: target } });
    }),

    finish: wrap(async (req, res) => {
      const ctx = await authorise(req, res);
      if (!ctx) return;
      const contentId = req.body && req.body.contentId;
      if (!/^[\w-]+$/.test(String(contentId || ''))) throw new LibraryError('Missing content id.', 400);
      const client = createClient({ url: config.url, secret: config.secret });
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p-finish-'));
      try {
        const file = path.join(dir, 'activity.h5p');
        await client.exportPackage(ctx.user, contentId, file);
        const deps = makeDeps({
          user: ctx.user, database: ctx.database, componentPlugin: ctx.componentPlugin,
          approve: (hash, info, label) => approvalStore().autoApprove(hash, Object.assign({ seenIn: [{ courseId: String(ctx.component._courseId), courseTitle: '' }] }, info), label)
        });
        const attached = await attachPackageToComponent({
          file, component: ctx.component, deps, title: 'Activity made in the H5P editor', description: 'Created or edited in the H5P editor',
          approvedBy: `${ctx.user.email || ctx.user._id} using the H5P editor`
        });
        await client.deleteContent(ctx.user, contentId);
        res.json({ success: true, payload: attached });
      } finally {
        fs.remove(dir).catch(() => {});
      }
    })
  };
}

module.exports = handler;
module.exports.safeReturn = safeReturn;
