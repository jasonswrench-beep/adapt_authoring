// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Routes for the H5P activity library (see h5pLibrary.js). They sit under /api/content/component/:id/ so the
 * existing role permissions apply (Course Creators may use them):
 *   GET  /content/component/:id/h5plibrary                  the catalogue
 *   GET  /content/component/:id/h5plibrary/thumb/:activity  a picture of the activity
 *   POST /content/component/:id/h5plibrary   {activity}     fills the component with that activity
 * Changing the component is checked against the course by the component's own permission check first.
 */
const fs = require('fs-extra');
const path = require('path');
const { loadCatalogue, addActivityToComponent, LibraryError, LIBRARY_ROOT } = require('./h5pLibrary');

const isObjectId = id => /^[a-f0-9]{24}$/i.test(String(id));

function handler(app, helpers, approvalStore) {
  const promisify = fn => new Promise((resolve, reject) => fn((error, result) => error ? reject(error) : resolve(result)));
  const plugin = type => promisify(cb => app.contentmanager.getContentPlugin(type, cb));
  const db = () => promisify(cb => app.db ? cb(null, app.db) : require('../../../lib/database').getDatabase(cb));
  const dataRoot = () => path.join(app.configuration.serverRoot, app.configuration.getConfig('dataRoot') || 'data');
  const libraryDir = () => path.join(dataRoot(), 'h5p-libraries');
  const cacheDir = () => path.join(dataRoot(), 'h5p-library-cache');

  /** The component, once the current user is allowed to change it. Responds and returns null otherwise. */
  async function authorise(req, res) {
    const id = req.params.id;
    if (!isObjectId(id)) { res.status(400).json({ success: false, message: 'Invalid component id.' }); return null; }
    const user = app.usermanager.getCurrentUser();
    const database = await db();
    const [component] = await promisify(cb => database.retrieve('component', { _id: id }, { jsonOnly: true }, cb));
    if (!component) { res.status(404).json({ success: false, message: 'Component not found.' }); return null; }
    const componentPlugin = await plugin('component');
    const allowed = await promisify(cb => componentPlugin.hasPermission('update', user._id, user.tenant._id, { _id: id, _courseId: component._courseId }, cb));
    if (!allowed) { res.status(403).json({ success: false, message: 'You do not have permission to change this component.' }); return null; }
    return { user, database, component, componentPlugin };
  }

  const wrap = fn => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      const status = error instanceof LibraryError ? error.status : 500;
      res.status(status).json({ success: false, message: error.message });
    }
  };

  return {
    list: wrap(async (req, res) => {
      if (!(await authorise(req, res))) return;
      const catalogue = await loadCatalogue({ libraryDir: libraryDir() });
      res.json({ success: true, payload: catalogue });
    }),

    thumb: wrap(async (req, res) => {
      if (!(await authorise(req, res))) return;
      const name = String(req.params.activity || '').replace(/\.jpg$/i, '');
      if (!/^[a-z0-9-]+$/.test(name)) return res.status(404).end();
      const file = path.join(LIBRARY_ROOT, 'thumbs', `${name}.jpg`);
      if (!(await fs.pathExists(file))) return res.status(404).end();
      res.set('Cache-Control', 'private, max-age=86400');
      res.type('image/jpeg');
      fs.createReadStream(file).pipe(res);
    }),

    add: wrap(async (req, res) => {
      const ctx = await authorise(req, res);
      if (!ctx) return;
      const { user, database, component, componentPlugin } = ctx;
      const activityId = req.body && req.body.activity;
      const deps = {
        approve: (hash, info) => approvalStore().autoApprove(hash, Object.assign({ seenIn: [{ courseId: String(component._courseId), courseTitle: '' }] }, info), 'the H5P activity library'),
        async importAsset({ file, path: filePath, size, title, description }) {
          const metadata = { idMap: {}, assetNameMap: {} };
          const meta = {
            oldId: file, title, type: 'application/zip', size, filename: file, description, path: filePath, tags: [],
            repository: app.configuration.getConfig('filestorage') || 'localfs', createdBy: user._id
          };
          await promisify(cb => helpers.importAsset(meta, metadata, cb));
          const assetId = metadata.idMap[file];
          return { assetId, filename: metadata.assetNameMap[assetId] };
        },
        clearAssetLinks: c => promisify(cb => database.destroy('courseasset', { _courseId: c._courseId, _contentType: 'component', _contentTypeId: c._id }, cb)),
        async linkAsset(c, assetId, filename) {
          const courseAsset = await plugin('courseasset');
          return promisify(cb => courseAsset.create({
            _courseId: c._courseId, _contentType: 'component', _contentTypeId: c._id, _contentTypeParentId: c._parentId,
            _assetId: assetId, _fieldName: filename, createdBy: user._id
          }, cb));
        },
        saveComponent(c, changes) {
          const properties = Object.assign({}, c.properties, changes);
          return promisify(cb => componentPlugin.update({ _id: c._id }, { _courseId: c._courseId, properties }, cb));
        }
      };
      const summary = await addActivityToComponent({ activityId, component, deps, libraryDir: libraryDir(), cacheDir: cacheDir() });
      res.json({ success: true, payload: summary });
    })
  };
}

module.exports = handler;
