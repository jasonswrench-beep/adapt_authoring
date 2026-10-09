// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * POST /api/content/component/:id/pptx : fills a Slides component from an uploaded PowerPoint.
 * It sits under /api/content/ so the existing role permissions apply (Course Creators may use it), and the update
 * itself is checked against the course by the component's own permission check before anything is changed.
 */
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { importDeckIntoComponent, SlidesImportError } = require('./slidesImport');

const isObjectId = id => /^[a-f0-9]{24}$/i.test(String(id));
const pptxName = file => Boolean(file && /\.pptx$/i.test(file.name || ''));

/**
 * @param {object} app - the Origin app (database, contentmanager, usermanager, configuration, assetmanager)
 * @param {object} helpers - outputHelpers (importAsset)
 */
function handler(app, helpers) {
  const IncomingForm = require('formidable').IncomingForm;
  const promisify = fn => new Promise((resolve, reject) => fn((error, result) => error ? reject(error) : resolve(result)));
  const plugin = type => promisify(cb => app.contentmanager.getContentPlugin(type, cb));
  const db = () => promisify(cb => app.db ? cb(null, app.db) : require('../../../lib/database').getDatabase(cb));

  return async function importPptx(req, res) {
    const fail = (status, message) => res.status(status).json({ success: false, message });
    const tmpFiles = [];
    try {
      const id = req.params.id;
      if (!isObjectId(id)) return fail(400, 'Invalid component id.');
      const user = app.usermanager.getCurrentUser();
      const database = await db();
      const [component] = await promisify(cb => database.retrieve('component', { _id: id }, { jsonOnly: true }, cb));
      if (!component) return fail(404, 'Component not found.');
      // The permission check works out the course from _courseId (without it the tool mistakes the component's own id
      // for a course id), so pass the course along exactly as the editor's own saves do. Nothing is changed before this.
      const componentPlugin = await plugin('component');
      const allowed = await promisify(cb => componentPlugin.hasPermission('update', user._id, user.tenant._id, { _id: id, _courseId: component._courseId }, cb));
      if (!allowed) return fail(403, 'You do not have permission to change this component.');

      const files = await new Promise((resolve, reject) => {
        const form = new IncomingForm();
        form.maxFileSize = app.configuration.getConfig('maxFileUploadSize');
        form.parse(req, (error, fields, uploaded) => error ? reject(error) : resolve(uploaded));
      });
      if (!files.file) return fail(400, 'Choose a .pptx file.');
      tmpFiles.push(files.file.path);
      if (!pptxName(files.file)) return fail(400, 'That file is not a PowerPoint (.pptx). Save older .ppt files as .pptx first.');

      const deps = {
        async importAsset({ file, data, alt }) {
          const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'slides-pic-'));
          tmpFiles.push(dir);
          const picture = path.join(dir, file);
          await fs.writeFile(picture, data);
          const metadata = { idMap: {}, assetNameMap: {} };
          const meta = {
            oldId: file, title: file, type: require('mime').getType(file), size: data.length, filename: file,
            description: alt || file, path: picture, tags: [],
            repository: app.configuration.getConfig('filestorage') || 'localfs', createdBy: user._id
          };
          await promisify(cb => helpers.importAsset(meta, metadata, cb));
          const assetId = metadata.idMap[file];
          return { assetId, filename: metadata.assetNameMap[assetId] };
        },
        clearAssetLinks: async c => promisify(cb => database.destroy('courseasset', { _courseId: c._courseId, _contentType: 'component', _contentTypeId: c._id }, cb)),
        async linkAsset(c, assetId, filename) {
          const courseAsset = await plugin('courseasset');
          return promisify(cb => courseAsset.create({
            _courseId: c._courseId, _contentType: 'component', _contentTypeId: c._id, _contentTypeParentId: c._parentId,
            _assetId: assetId, _fieldName: filename, createdBy: user._id
          }, cb));
        },
        async saveItems(c, items) {
          const properties = Object.assign({}, c.properties, { _items: items });
          return promisify(cb => componentPlugin.update({ _id: c._id }, { _courseId: c._courseId, properties }, cb));
        }
      };

      const summary = await importDeckIntoComponent({ pptxPath: files.file.path, component, deps });
      return res.json({ success: true, payload: summary });
    } catch (error) {
      const status = error instanceof SlidesImportError ? error.status : 500;
      return fail(status, error.message);
    } finally {
      tmpFiles.forEach(f => fs.remove(f).catch(() => {}));
    }
  };
}

module.exports = handler;
