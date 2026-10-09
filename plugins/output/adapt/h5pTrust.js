// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Trusted-uploader shortcut for the H5P approval gate.
 *
 * A file uploaded by someone who is allowed to approve H5P files anyway (an administrator) does not need a
 * second click: it is approved automatically, and recorded as such. Files uploaded by anyone else still wait.
 * Kept free of app dependencies so it can be unit tested.
 */

/** decodeURIComponent that returns the input unchanged if it is not valid percent-encoding. */
function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}

/**
 * Works out which asset filenames in a course were uploaded only by trusted users.
 *
 * Assets are matched to components by filename, so a filename that more than one asset uses is only trusted if
 * every asset with that name was uploaded by a trusted user (a student cannot ride on an admin's filename).
 *
 * @param {Array<{filename: string, createdBy: *}>} assets
 * @param {function(string): Promise<boolean>} isTrustedUser - given a user id
 * @param {function(string): Promise<string>} labelFor - given a user id, a short name for the audit trail
 * @returns {Promise<Map<string, string>>} filename -> uploader label, trusted names only
 */
async function computeTrustedUploads(assets, isTrustedUser, labelFor) {
  const trustCache = new Map();
  const trusted = userId => {
    if (!trustCache.has(userId)) trustCache.set(userId, Promise.resolve(isTrustedUser(userId)).then(Boolean, () => false));
    return trustCache.get(userId);
  };
  const byName = new Map(); // filename -> { ok, label }
  for (const asset of assets || []) {
    if (!asset || !asset.filename) continue;
    const userId = asset.createdBy && String(asset.createdBy);
    const ok = Boolean(userId) && await trusted(userId);
    const known = byName.get(asset.filename);
    if (known) {
      known.ok = known.ok && ok;
    } else {
      byName.set(asset.filename, { ok, label: ok ? await Promise.resolve(labelFor(userId)).catch(() => userId) : null });
    }
  }
  const result = new Map();
  byName.forEach((entry, name) => { if (entry.ok) result.set(name, entry.label || 'administrator'); });
  return result;
}

module.exports = { computeTrustedUploads, safeDecode };
