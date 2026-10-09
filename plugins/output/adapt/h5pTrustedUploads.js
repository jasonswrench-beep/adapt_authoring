// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Finds the H5P-capable uploads in a course that were uploaded by someone who is allowed to approve H5P files.
 * "Allowed" is asked of the permissions system (the same check the approval routes use), so no role names are
 * hardcoded. Turn the shortcut off with `h5pTrustAdminUploads: false` in conf/config.json.
 */
const assetmanager = require('../../../lib/assetmanager');
const configuration = require('../../../lib/configuration');
const database = require('../../../lib/database');
const permissions = require('../../../lib/permissions');
const usermanager = require('../../../lib/usermanager');
const { computeTrustedUploads } = require('./h5pTrust');

const promisify = fn => new Promise((resolve, reject) => fn((error, result) => error ? reject(error) : resolve(result)));

/** @returns {Promise<Map<string, string>>} asset filename -> uploader label (empty when the shortcut is off) */
async function trustedUploadsFor({ courseId, tenantId }) {
  if (configuration.getConfig('h5pTrustAdminUploads') === false) return new Map();
  const db = await promisify(cb => database.getDatabase(cb));
  const assetIds = await promisify(cb => db.retrieve('courseasset', { _courseId: courseId, _contentType: { $ne: 'theme' } }, { operators: { distinct: '_assetId' } }, cb));
  if (!assetIds || !assetIds.length) return new Map();
  const assets = await promisify(cb => assetmanager.retrieveAsset({ _id: { $in: assetIds } }, cb));
  const resource = permissions.buildResourceString(tenantId, '/api/h5papproval/' + '0'.repeat(64) + '/approve');
  return computeTrustedUploads(
    assets,
    userId => promisify(cb => permissions.hasPermission(userId, 'create', resource, cb)),
    userId => promisify(cb => usermanager.retrieveUser({ _id: userId }, cb)).then(u => u.email || String(userId), () => String(userId))
  );
}

module.exports = { trustedUploadsFor };
