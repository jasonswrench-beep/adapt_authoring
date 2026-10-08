/**
 * Installs the plugins listed in conf/plugin-bundle.json directly from GitHub (or, for entries with
 * a `path`, from this repository), bypassing the Bower registry. Each plugin is registered through the same
 * BowerManager#importPackage code path the tool uses for registry installs.
 *
 * Usage (run from the repo root, with the server STOPPED and the framework installed):
 *   node scripts/install-plugin-bundle.js [--bundle conf/plugin-bundle.json] [--group "Interactions"]
 *
 * The 'name' field in the bundle is only a label; the real plugin name comes from bower.json.
 */
var async = require('async');
var { execFile } = require('child_process');
var fs = require('fs-extra');
var path = require('path');
var semver = require('semver');
var { argv } = require('optimist');

var logger = require('../lib/logger');
var origin = require('../lib/application');
var installHelpers = require('../lib/installHelpers');
var bowerOptions = require('../plugins/content/bower/defaults.json');

var app = origin();
var ROOT = path.join(__dirname, '..');
var CACHE = path.join(ROOT, 'temp', 'plugin-bundle-cache');
var MAX_TAGS_TO_TRY = 8;
var PLUGIN_TYPES = ['component', 'extension', 'menu', 'theme'];

var bundle = fs.readJSONSync(path.resolve(ROOT, argv.bundle || 'conf/plugin-bundle.json'));
var entries = bundle.plugins.filter(function(p) { return !argv.group || p.group === argv.group; });

logger.level('console', 'error');
app.run({ skipVersionCheck: true, skipStartLog: true });
app.on('serverStarted', function() {
  installHelpers.getInstalledFrameworkVersion(function(error, frameworkVersion) {
    if (error) return finish(error);
    console.log('Framework ' + frameworkVersion + ': installing ' + entries.length + ' plugins\n');
    var failures = [];
    async.eachSeries(entries, function(entry, next) {
      installEntry(entry, frameworkVersion, function(err, label) {
        if (err) {
          failures.push(entry.repo || entry.path);
          console.log('  FAIL  ' + (entry.repo || entry.path) + ' - ' + (err.message || err));
        } else {
          console.log('  ok    ' + label);
        }
        next();
      });
    }, function() {
      console.log('\n' + (entries.length - failures.length) + ' installed, ' + failures.length + ' failed');
      finish(null, failures.length ? 1 : 0);
    });
  });
});

function git(args, cwd, cb) {
  execFile('git', args, { cwd: cwd }, function(err, stdout, stderr) {
    cb(err ? new Error((stderr || err.message).trim()) : null, stdout);
  });
}

function releaseTags(repoUrl, cb) {
  git(['ls-remote', '--tags', '--refs', repoUrl], undefined, function(err, out) {
    if (err) return cb(err);
    var tags = out.split('\n').map(function(l) { return l.split('refs/tags/')[1]; })
      .filter(function(t) { return t && semver.valid(t) && !semver.prerelease(t); })
      .sort(function(a, b) { return semver.rcompare(a, b); });
    cb(tags.length ? null : new Error('no release tags'), tags);
  });
}

function checkout(repoUrl, ref, dir, cb) {
  fs.remove(dir, function() {
    git(['-c', 'advice.detachedHead=false', 'clone', '--quiet', '--depth', '1', '--branch', ref, repoUrl, dir], undefined, cb);
  });
}

/** A plugin that lives in this repository (entry.path) instead of on GitHub. */
function installLocalEntry(entry, frameworkVersion, cb) {
  var dir = path.resolve(ROOT, entry.path);
  var meta;
  try { meta = fs.readJSONSync(path.join(dir, 'bower.json')); } catch (e) { return cb(new Error('no readable bower.json in ' + entry.path)); }
  if (meta.framework && !semver.satisfies(semver.clean(frameworkVersion), meta.framework, { includePrerelease: true })) {
    return cb(new Error('requires framework ' + meta.framework));
  }
  register(dir, meta, function(err) { cb(err, meta.name + ' ' + meta.version + ' (local)'); });
}

function installEntry(entry, frameworkVersion, cb) {
  if (entry.path) return installLocalEntry(entry, frameworkVersion, cb);
  var repoUrl = 'https://github.com/' + entry.repo + '.git';
  var dir = path.join(CACHE, entry.repo.replace('/', '__'));
  var attempt = function(ref, done) {
    checkout(repoUrl, ref, dir, function(err) {
      if (err) return done(err);
      var meta;
      try { meta = fs.readJSONSync(path.join(dir, 'bower.json')); } catch (e) { return done(new Error('no readable bower.json at ' + ref)); }
      if (meta.framework && !semver.satisfies(semver.clean(frameworkVersion), meta.framework, { includePrerelease: true })) {
        return done(new Error('requires framework ' + meta.framework));
      }
      done(null, meta);
    });
  };
  var tryRefs = function(refs, lastErr) {
    var ref = refs.shift();
    if (!ref) return cb(lastErr || new Error('no compatible release'));
    attempt(ref, function(err, meta) {
      if (err) return tryRefs(refs, err);
      register(dir, meta, function(err) { cb(err, meta.name + ' ' + meta.version); });
    });
  };
  if (entry.ref) return tryRefs([entry.ref]);
  releaseTags(repoUrl, function(err, tags) {
    if (err) return cb(err);
    tryRefs(tags.slice(0, MAX_TAGS_TO_TRY));
  });
}

function register(dir, pkgMeta, cb) {
  var type = PLUGIN_TYPES.find(function(t) { return typeof pkgMeta[t] === 'string'; });
  if (!type) return cb(new Error('cannot identify plugin type'));
  app.contentmanager.getContentPlugin(type, function(err, plugin) {
    if (err) return cb(err);
    var options = Object.assign({}, bowerOptions, { strict: true });
    app.bowermanager.importPackage(plugin, { canonicalDir: dir, pkgMeta: pkgMeta }, options, function(err) {
      // an already-installed identical version is reported by importPackage as an error in strict mode
      cb(err && /already exists/.test(String(err)) ? null : err);
    });
  });
}

function finish(error, code) {
  if (error) console.error('ERROR:', error.message || error);
  process.exit(error ? 1 : code || 0);
}
