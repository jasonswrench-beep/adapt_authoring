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

function handler(app, helpers, approvalStore) {
  const access = require('./h5pComponentAccess')(app, helpers);
  const { authorise, makeDeps } = access;
  const dataRoot = () => path.join(app.configuration.serverRoot, app.configuration.getConfig('dataRoot') || 'data');
  const libraryDir = () => path.join(dataRoot(), 'h5p-libraries');
  const cacheDir = () => path.join(dataRoot(), 'h5p-library-cache');

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
      const deps = makeDeps({
        user, database, componentPlugin,
        approve: (hash, info, label) => approvalStore().autoApprove(hash, Object.assign({ seenIn: [{ courseId: String(component._courseId), courseTitle: '' }] }, info), label)
      });
      const summary = await addActivityToComponent({ activityId, component, deps, libraryDir: libraryDir(), cacheDir: cacheDir() });
      res.json({ success: true, payload: summary });
    })
  };
}

module.exports = handler;
