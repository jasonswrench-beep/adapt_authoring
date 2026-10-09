// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Lets the editor's "Import source" accept a PowerPoint (.pptx): the file is converted into the same source zip the
 * import already understands (see scripts/pptx-import), as one Slides component with a step per slide.
 */
const fs = require('fs-extra');
const path = require('path');
const converter = require('../../../scripts/pptx-import/pptx-to-adapt');

const isPptx = file => Boolean(file && /\.pptx$/i.test(file.name || ''));

/**
 * @param {string} pptxPath uploaded file
 * @param {string} frameworkVersion installed framework version (the zip must share its major version)
 * @returns {{zipPath: string, summary: object}} the converted zip, written next to the upload
 */
function convertToImportZip(pptxPath, frameworkVersion) {
  const result = converter.convert(pptxPath, {
    layout: 'slides', lang: 'en', framework: frameworkVersion || '5.56.3', notes: false, includeHidden: false,
    theme: 'adapt-theme-modern', menu: 'adapt-menu-lessons'
  });
  const zipPath = `${pptxPath}.adapt.zip`;
  result.out.writeZip(zipPath);
  return {
    zipPath,
    summary: { title: result.courseTitle, stats: result.stats, warnings: result.warnings, noAlt: result.noAlt }
  };
}

module.exports = { isPptx, convertToImportZip };
