// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * New courses prefer the Modern theme and Lessons menu, but only when those plugins are installed.
 * Kept free of app dependencies so it can be unit tested with a fake database.
 */
var PREFERRED_LOOK = [
  { attribute: '_theme', model: 'themetype', name: 'adapt-theme-modern' },
  { attribute: '_menu', model: 'menutype', name: 'adapt-menu-lessons' }
];

/**
 * Sets configObj._theme / _menu to the preferred plugins when they exist in the database.
 * Never fails: any lookup problem leaves the defaults untouched.
 *
 * @param {object} db - anything with retrieve(model, query, callback)
 * @param {object} configObj - the config about to be created
 * @param {function} cb - called with no arguments when done
 */
function preferInstalledLook (db, configObj, cb) {
  var remaining = PREFERRED_LOOK.slice();
  (function next () {
    var item = remaining.shift();
    if (!item) return cb();
    try {
      db.retrieve(item.model, { name: item.name }, function (error, results) {
        if (!error && results && results.length > 0) {
          configObj[item.attribute] = item.name;
        }
        next();
      });
    } catch (e) {
      next();
    }
  })();
}

module.exports = preferInstalledLook;
module.exports.PREFERRED_LOOK = PREFERRED_LOOK;
