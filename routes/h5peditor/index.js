// Forwards /h5p-editor/* to the H5P editor service (h5p-editor/) for users who have opened an editor session from an
// H5P Player component (POST /api/content/component/:id/h5peditor/start, which checks they may edit it).
const express = require('express');
const usermanager = require('../../lib/usermanager');
const { createProxy, hasEditorSession } = require('../../plugins/output/adapt/h5pEditorClient');

const server = module.exports = express();
const proxy = createProxy({ getUser: () => usermanager.getCurrentUser() });

server.all(/^\/h5p-editor(\/.*)?$/, (req, res) => {
  const user = usermanager.getCurrentUser();
  if (!user) return res.status(403).type('text/plain').send('Please sign in.');
  if (!hasEditorSession(user, req.session)) {
    return res.status(403).type('text/plain').send('Open the editor from an H5P Player component in the course editor.');
  }
  proxy(req, res);
});
