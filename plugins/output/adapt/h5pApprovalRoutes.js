// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Request handlers for the H5P approval list, registered under /api/h5papproval in lib/outputmanager.js.
 *
 * Access control: only the Super Admin role is granted anything under /api/h5papproval/*, and the tool's
 * permission middleware checks every API request against the user's roles before a handler runs. The
 * handlers therefore do not repeat the check, but they do validate input.
 */
const { isHash } = require('./h5pApproval');

/**
 * @param {function(): object} getStore - returns the ApprovalStore
 * @param {function(): string} getUserName - who is making the request (recorded with each decision)
 */
function handlers(getStore, getUserName) {
  const fail = (res, status, message) => res.status(status).json({ success: false, message });
  const guard = (fn) => (req, res) => {
    if (req.params && 'hash' in req.params && !isHash(req.params.hash)) return fail(res, 400, 'Invalid file hash.');
    return Promise.resolve().then(() => fn(req, res)).catch(error => fail(res, 500, error.message));
  };
  const decide = (method) => guard(async (req, res) => {
    const known = await getStore()[method](req.params.hash, getUserName());
    return known ? res.json({ success: true }) : fail(res, 404, 'That file has not been seen by this server.');
  });

  return {
    list: guard(async (req, res) => res.json({ success: true, payload: await getStore().list() })),
    approve: decide('approve'),
    reject: decide('reject'),
    revoke: guard(async (req, res) => {
      const known = await getStore().revoke(req.params.hash);
      return known ? res.json({ success: true }) : fail(res, 404, 'There is no decision to withdraw for that file.');
    })
  };
}

module.exports = handlers;
