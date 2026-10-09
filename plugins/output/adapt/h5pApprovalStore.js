// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
const path = require('path');
const configuration = require('../../../lib/configuration');
const { storeFor } = require('./h5pApproval');

/** The shared approval list, kept in the data folder (so it is in the Docker volume and survives restarts). */
module.exports = function approvalStore() {
  return storeFor(path.join(configuration.serverRoot, configuration.getConfig('dataRoot') || 'data', 'h5p-approvals.json'));
};
