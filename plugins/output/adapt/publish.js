// external
const archiver = require('archiver');
const async = require('async');
const exec = require('child_process').exec;
const fs = require('fs-extra');
const path = require('path');
const semver = require('semver');
// internal
const configuration = require('../../../lib/configuration');
const Constants = require('../../../lib/outputmanager').Constants;
const helpers = require('../../../lib/helpers');
const installHelpers = require('../../../lib/installHelpers');
const logger = require('../../../lib/logger');
const origin = require('../../../');
const h5pApprovalStore = require('./h5pApprovalStore');
const h5pPackaging = require('./h5pPackaging');
const { trustedUploadsFor } = require('./h5pTrustedUploads');
const outputHelpers = require('./outputHelpers');
const usermanager = require('../../../lib/usermanager');

function publishCourse(courseId, mode, request, response, next) {
  let app = origin();
  let self = this;
  let user = usermanager.getCurrentUser();
  let tenantId = user.tenant._id;
  let outputJson = {};
  let isRebuildRequired = false;
  let themeName;
  let menuName;
  let frameworkVersion;
  let isForceRebuild;
  let exportFormat;

  let resultObject = {};

  // shorthand directories
  const FRAMEWORK_ROOT_FOLDER = path.join(configuration.tempDir, configuration.getConfig('masterTenantID'), Constants.Folders.Framework);
  const SRC_FOLDER = path.join(FRAMEWORK_ROOT_FOLDER, Constants.Folders.Source);
  const COURSES_FOLDER = path.join(FRAMEWORK_ROOT_FOLDER, Constants.Folders.AllCourses);
  const COURSE_FOLDER = path.join(COURSES_FOLDER, tenantId, courseId);
  const BUILD_FOLDER = path.join(COURSE_FOLDER, Constants.Folders.Build);

  let customPluginName = user._id;

  const getGruntFatalError = stdout => {
    const indexStart = stdout.indexOf('\nFatal error: ');

    if (indexStart === -1) return;

    const indexEnd = stdout.indexOf('\n\nExecution Time');

    return stdout.substring(indexStart, indexEnd !== -1 ? indexEnd : stdout.length);
  }

  async.waterfall([
    // get an object with all the course data
    function(callback) {
      self.getCourseJSON(tenantId, courseId, function(err, data) {
        if (err) {
          return callback(err);
        }
        // Store off the retrieved collections
        outputJson = data;
        callback(null);
      });
    },
    // validate the course data
    function(callback) {
      outputHelpers.validateCourse(outputJson, function(error, isValid) {
        if (error || !isValid) {
          return callback({ message: error });
        }

        callback(null);
      });
    },
    //
    function(callback) {
      var temporaryThemeFolder = path.join(SRC_FOLDER, Constants.Folders.Theme, customPluginName);
      self.applyTheme(tenantId, courseId, outputJson, temporaryThemeFolder, function(err, appliedThemeName) {
        if (err) {
          return callback(err);
        }

        self.writeCustomStyle(tenantId, courseId, temporaryThemeFolder, function(err) {
          if (err) {
            return callback(err);
          }
          // Replace the theme in outputJson with the applied theme name.
          themeName = appliedThemeName;
          outputJson['config'][0]._theme = themeName;
          callback(null);
        });
      });
    },
    function(callback) {
      self.sanitizeCourseJSON(mode, outputJson, function(err, data) {
        if (err) {
          return callback(err);
        }
        // Update the JSON object
        outputJson = data;
        callback(null);
      });
    },
    // SCORM vs Web: only meaningful for downloads. 'scorm' requires the Spoor extension on the course.
    function(callback) {
      const format = request && request.query && request.query.format;
      if (mode !== Constants.Modes.Publish || !format) {
        return callback(null);
      }
      if (format !== 'scorm' && format !== 'web') {
        return callback({ message: 'Unknown export format: ' + format });
      }
      const spoor = outputJson.config._spoor;
      if (format === 'scorm' && !spoor) {
        return callback({ message: 'SCORM export needs the Spoor extension. Add it under Extensions, then try again.' });
      }
      if (spoor) {
        spoor._isEnabled = format === 'scorm';
        // default to SCORM 1.2 (widest LMS support) unless the course picked a version
        if (format === 'scorm') {
          spoor._advancedSettings = spoor._advancedSettings || {};
          spoor._advancedSettings._scormVersion = spoor._advancedSettings._scormVersion || '1.2';
        }
      }
      exportFormat = format;
      callback(null);
    },
    function(callback) {
      self.buildFlagExists(path.join(BUILD_FOLDER, Constants.Filenames.Rebuild), function(err, buildFlagExists) {
        if (err) {
          return callback(err);
        }
        isForceRebuild = request && request.query.force === 'true';

        if (!fs.existsSync(path.normalize(BUILD_FOLDER + '/index.html'))) {
          buildFlagExists = true;
        }

        if (mode === Constants.Modes.Export || mode === Constants.Modes.Publish || buildFlagExists || isForceRebuild) {
          isRebuildRequired = true;
        }
        callback(null);
      });
    },
    function(callback) {
      if (mode === Constants.Modes.Export || mode === Constants.Modes.Publish || isForceRebuild) {
        fs.emptyDirSync(BUILD_FOLDER);
      }
      callback(null);
    },
    function(callback) {
      var temporaryMenuFolder = path.join(SRC_FOLDER, Constants.Folders.Menu, customPluginName);
      self.applyMenu(tenantId, courseId, outputJson, temporaryMenuFolder, function(err, appliedMenuName) {
        if (err) {
          return callback(err);
        }
        menuName = appliedMenuName;
        callback(null);
      });
    },
    function(callback) {
      var assetsJsonFolder = path.join(BUILD_FOLDER, Constants.Folders.Course, outputJson['config']._defaultLanguage);
      var assetsFolder = path.join(assetsJsonFolder, Constants.Folders.Assets);

      self.writeCourseAssets(tenantId, courseId, assetsJsonFolder, assetsFolder, outputJson, function(err, modifiedJson) {
        if (err) {
          return callback(err);
        }
        // Store the JSON with the new paths to assets
        outputJson = modifiedJson;
        callback(null);
      });
    },
    function(callback) {
      // The framework build adds defaults to two of the course files: screenSize in config.json and the _globals
      // defaults in course.json. When no rebuild is needed those built files are current, and overwriting them with
      // the raw saved copy would strip the defaults and leave the course stuck on "Loading..." (a second Preview of an
      // unchanged course used to do exactly that). Changes to either file flag a rebuild, so they are safe to keep.
      // The pages, articles, blocks and components come out of the build unchanged, so they are always written: a
      // component edited or replaced (a new PowerPoint deck, a new H5P activity) does not flag a rebuild, and
      // skipping them left the preview showing the old content.
      var options = isRebuildRequired ? undefined : { skip: ['config', 'course'] };
      self.writeCourseJSON(outputJson, path.join(BUILD_FOLDER, Constants.Folders.Course), function(err) {
        if (err) {
          return callback(err);
        }
        callback(null);
      }, options);
    },
    function(callback) {
      installHelpers.getInstalledFrameworkVersion(function(error, version) {
        frameworkVersion = version;
        callback(error);
      });
    },
    function(callback) {
      if (!isRebuildRequired) {
        return callback();
      }
      logger.log('info', 'Attempting to update browserslist');
      exec('npx browserslist --update-db', { cwd: FRAMEWORK_ROOT_FOLDER }, e => callback(e));
    },
    function(callback) {
      if (!isRebuildRequired) {
        resultObject.success = true;
        return callback(null, 'Framework already built, nothing to do');
      }

      logger.log('info', '3.1. Ensuring framework build exists');

      var args = [];
      var outputFolder = COURSE_FOLDER.replace(FRAMEWORK_ROOT_FOLDER + path.sep,'');

      // Append the 'build' folder to later versions of the framework
      if (semver.gte(semver.clean(frameworkVersion), semver.clean('2.0.0'))) {
        outputFolder = path.join(outputFolder, Constants.Folders.Build);
      }

      args.push('--outputdir=' + outputFolder);
      args.push('--theme=' + themeName);
      args.push('--menu=' + menuName);

      logger.log('info', '3.2. Using theme: ' + themeName);
      logger.log('info', '3.3. Using menu: ' + menuName);

      var generateSourcemap = outputJson.config._generateSourcemap;
      var buildMode = generateSourcemap === true ? 'dev' : 'prod';

      logger.log('info', 'npx grunt server-build:' + buildMode + ' ' + args.join(' '));

      child = exec('npx grunt server-build:' + buildMode + ' ' + args.join(' '), {cwd: path.join(FRAMEWORK_ROOT_FOLDER)}, function(error, stdout, stderr) {
        if (error !== null) {
          logger.log('error', 'exec error: ' + error);
          logger.log('error', 'stdout error: ' + stdout);
          error.message += getGruntFatalError(stdout) || '';
          resultObject.success = true;
          return callback(error, 'Error building framework');
        }

        if (stdout.length != 0) {
          logger.log('info', 'stdout: ' + stdout);
          resultObject.success = true;

          // Indicate that the course has built successfully
          app.emit('previewCreated', tenantId, courseId, outputFolder);

          return callback(null, 'Framework built OK');
        }

        if (stderr.length != 0) {
          logger.log('error', 'stderr: ' + stderr);
          resultObject.success = false;
          return callback(stderr, 'Error (stderr) building framework!');
        }

        resultObject.success = true;
        return callback(null, 'Framework built');
      });
    },
    function(err, callback) {
      self.clearBuildFlag(path.join(BUILD_FOLDER, Constants.Filenames.Rebuild), function(err) {
        callback(null);
      });
    },
    function(callback) {
      // Unpack approved .h5p files for the H5P Player component (no-op when the course has none).
      // Files that are not approved are never unpacked: a preview shows a "waiting for approval" notice,
      // but a download or publish is refused until an administrator has approved them.
      const hasH5P = (outputJson.component || []).some(c => c && c._component === h5pPackaging.COMPONENT);
      // uploads by someone who may approve H5P files anyway are approved automatically (see h5pTrustedUploads.js)
      (hasH5P ? trustedUploadsFor({ courseId, tenantId }).catch(error => {
        logger.log('warn', 'Could not check H5P uploaders; approvals stay manual: ' + error.message);
        return new Map();
      }) : Promise.resolve(new Map())).then(trustedUploads => h5pPackaging.packageH5P({
        components: outputJson.component,
        buildFolder: BUILD_FOLDER,
        approvals: h5pApprovalStore(),
        trustedUploads,
        context: { courseId: String(courseId), courseTitle: outputJson.course.title }
      })).then(summary => {
        summary.warnings.forEach(warning => logger.log('warn', warning));
        if (summary.pending.length && mode !== Constants.Modes.Preview) {
          const list = summary.pending.map(p => `"${p.title}" (${p.fileName}, ${p.status})`).join(', ');
          return callback(new Error(
            `${summary.pending.length} H5P ${summary.pending.length === 1 ? 'activity needs' : 'activities need'} approval by an administrator before this course can be published or downloaded: ${list}.`
          ));
        }
        callback(null);
      }, error => callback(error));
    },
    function(callback) {
      // A Web package must not carry the SCORM launch files: with Spoor in the course the build always includes them,
      // and an LMS that finds imsmanifest.xml would treat the zip as a SCORM package.
      if (exportFormat !== 'web') return callback(null);
      const scormOnly = ['imsmanifest.xml', 'adlcp_rootv1p2.xsd', 'ims_xml.xsd', 'imscp_rootv1p1p2.xsd', 'imsmd_rootv1p2p1.xsd',
        'index_lms.html', 'log_output.html', 'scorm_test_harness.html', 'connection.txt'];
      async.each(scormOnly, (file, done) => fs.remove(path.join(BUILD_FOLDER, file), done), error => callback(error));
    },
    function(callback) {
      const configPath = path.join(BUILD_FOLDER, Constants.Folders.Course, Constants.CourseCollections.config.filename);
      self.removeBuildIncludes(configPath, err => callback(err));
    },
    function(callback) {
      if (mode === Constants.Modes.Preview) { // No download required -- skip this step
        return callback();
      }
      // Now zip the build package
      var filename = path.join(COURSE_FOLDER, Constants.Filenames.Download);
      var zipName = helpers.slugify(outputJson['course'].title) + (exportFormat ? '-' + exportFormat : '');
      var output = fs.createWriteStream(filename);
      var archive = archiver('zip');

      output.on('close', function() {
        resultObject.filename = filename;
        resultObject.zipName = zipName;
        // Indicate that the zip file is ready for download
        app.emit('zipCreated', tenantId, courseId, filename, zipName);
        callback();
      });
      archive.on('error', function(err) {
        logger.log('error', err);
        callback(err);
      });
      archive.pipe(output);
      archive.glob('**/*', { cwd: path.join(BUILD_FOLDER) });
      archive.finalize();
    }
  ], function(err) {
    if (err) {
      logger.log('error', err);
      return next(err);
    }
    next(null, resultObject);
  });
}

module.exports = publishCourse;
