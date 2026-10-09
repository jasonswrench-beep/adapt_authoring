// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * What the H5P routes (activity library, H5P editor) share: checking that the current user may change an H5P Player
 * component, and the storage operations needed to attach an .h5p file to one (see attachPackageToComponent in
 * h5pLibrary.js).
 */
const isObjectId = id => /^[a-f0-9]{24}$/i.test(String(id));

module.exports = function componentAccess(app, helpers) {
  const promisify = fn => new Promise((resolve, reject) => fn((error, result) => error ? reject(error) : resolve(result)));
  const plugin = type => promisify(cb => app.contentmanager.getContentPlugin(type, cb));
  const db = () => promisify(cb => app.db ? cb(null, app.db) : require('../../../lib/database').getDatabase(cb));

  /**
   * The component and the things needed to change it, once the current user is allowed to change it. Otherwise it
   * answers the request and returns null. Nothing is changed before this succeeds.
   */
  async function authorise(req, res) {
    const id = req.params.id;
    if (!isObjectId(id)) { res.status(400).json({ success: false, message: 'Invalid component id.' }); return null; }
    const user = app.usermanager.getCurrentUser();
    if (!user) { res.status(403).json({ success: false, message: 'Please sign in.' }); return null; }
    const database = await db();
    const [component] = await promisify(cb => database.retrieve('component', { _id: id }, { jsonOnly: true }, cb));
    if (!component) { res.status(404).json({ success: false, message: 'Component not found.' }); return null; }
    const componentPlugin = await plugin('component');
    // the permission check works out the course from _courseId, so pass it as the editor's own saves do
    const allowed = await promisify(cb => componentPlugin.hasPermission('update', user._id, user.tenant._id, { _id: id, _courseId: component._courseId }, cb));
    if (!allowed) { res.status(403).json({ success: false, message: 'You do not have permission to change this component.' }); return null; }
    return { user, database, component, componentPlugin };
  }

  /** Storage operations for attachPackageToComponent. */
  function makeDeps({ user, database, componentPlugin, approve }) {
    return {
      approve,
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
  }

  return { promisify, plugin, db, authorise, makeDeps };
};
