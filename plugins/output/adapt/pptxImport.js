// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Lets the editor's "Import source" accept a PowerPoint (.pptx): the file is converted into the same source zip the
 * import already understands (see scripts/pptx-import), as one Slides component with a step per slide.
 */
const fs = require('fs-extra');
const path = require('path');
const converter = require('../../../scripts/pptx-import/pptx-to-adapt');

const THEME = 'adapt-theme-modern';
const MENU = 'adapt-menu-lessons';

/** bower.json of an installed theme or menu, so the converted package can name the exact installed version. */
function installedPlugin(frameworkSrc, folder, name) {
  const file = path.join(frameworkSrc, folder, name, 'bower.json');
  if (!fs.existsSync(file)) throw new Error(`The ${folder} "${name}" is not installed on this server, so a PowerPoint cannot be imported.`);
  return fs.readJsonSync(file);
}

/** Where the framework's installed plugins live (the working copy the tool builds courses from). */
function defaultFrameworkSrc() {
  const configuration = require('../../../lib/configuration');
  const Constants = require('../../../lib/outputmanager').Constants;
  return path.join(configuration.tempDir, configuration.getConfig('masterTenantID'), Constants.Folders.Framework, Constants.Folders.Source);
}

const isPptx = file => Boolean(file && /\.pptx$/i.test(file.name || ''));

/**
 * @param {string} pptxPath uploaded file
 * @param {string} frameworkVersion installed framework version (the zip must share its major version)
 * @param {string} [frameworkSrc] folder holding the installed theme/ and menu/ plugins (default: the tool's working copy)
 * @returns {{zipPath: string, summary: object}} the converted zip, written next to the upload
 */
function convertToImportZip(pptxPath, frameworkVersion, frameworkSrc) {
  const src = frameworkSrc || defaultFrameworkSrc();
  const theme = installedPlugin(src, 'theme', THEME);
  const menu = installedPlugin(src, 'menu', MENU);
  const result = converter.convert(pptxPath, {
    layout: 'slides', lang: 'en', framework: frameworkVersion || '5.56.3', notes: false, includeHidden: false,
    theme: THEME, menu: MENU, plugins: { theme, menu }
  });
  const zipPath = `${pptxPath}.adapt.zip`;
  result.out.writeZip(zipPath);
  return {
    zipPath,
    summary: { title: result.courseTitle, stats: result.stats, warnings: result.warnings, noAlt: result.noAlt }
  };
}

module.exports = { isPptx, convertToImportZip };
