// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
const path = require('path');
const configuration = require('../../../lib/configuration');
const Constants = require('../../../lib/outputmanager').Constants;
const usermanager = require('../../../lib/usermanager');
const core = require('./accessibilityCore');

const COURSE_ID = /^[a-f0-9]{24}$/i;
// the full check starts a browser, so only one runs at a time
let isDeepCheckRunning = false;

/**
 * GET /api/output/adapt/accessibility/:courseid[?deep=true]
 * Quick check of the saved content; with deep=true also builds the preview and runs axe-core on it.
 */
function accessibilityCheck(courseId, request, response, next) {
  const self = this;
  if (!COURSE_ID.test(courseId)) {
    return next(new Error('Invalid course id.'));
  }
  const tenantId = usermanager.getCurrentUser().tenant._id;
  const wantsDeep = !!(request && request.query && request.query.deep === 'true');

  self.getCourseJSON(tenantId, courseId, function(error, data) {
    if (error) return next(error);
    let result;
    try {
      result = core.quickCheck(data);
    } catch (e) {
      return next(e);
    }
    if (!wantsDeep) return next(null, result);
    if (isDeepCheckRunning) {
      result.deep = { ran: false, reason: 'Another full check is running. Try again in a minute.' };
      return next(null, result);
    }
    isDeepCheckRunning = true;
    const finish = deep => {
      isDeepCheckRunning = false;
      result.deep = deep;
      next(null, result);
    };
    self.publish(courseId, Constants.Modes.Preview, request, response, function(publishError) {
      if (publishError) {
        return finish({ ran: false, reason: `The preview could not be built: ${publishError.message || publishError}` });
      }
      const buildFolder = path.join(configuration.tempDir, configuration.getConfig('masterTenantID'),
        Constants.Folders.Framework, Constants.Folders.AllCourses, tenantId, courseId, Constants.Folders.Build);
      core.runDeepCheck(buildFolder).then(finish, e => finish({ ran: false, reason: e.message }));
    });
  });
}

module.exports = accessibilityCheck;
