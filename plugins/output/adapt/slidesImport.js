// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Fills a Slides component (adapt-component-slides) from a PowerPoint (.pptx): one slide item per PowerPoint slide.
 * Pictures, video and audio are added to the asset library and linked to the course (publishing only copies linked assets).
 *
 * The app-specific work is passed in as `deps`, so this logic can be tested without a database:
 *   deps.importAsset({ file, data, alt }) -> Promise<{ assetId, filename }>   (identical pictures are reused)
 *   deps.clearAssetLinks(component)       -> Promise  (drops the picture links of the slides being replaced)
 *   deps.linkAsset(component, assetId, filename) -> Promise
 *   deps.saveItems(component, items)      -> Promise
 */
const crypto = require('crypto');
const path = require('path');
const converter = require('../../../scripts/pptx-import/pptx-to-adapt');

class SlidesImportError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 400;
  }
}

/** File names built from the picture's own bytes, so identical pictures share one asset and different ones never collide. */
const hashedName = (data, ext) => `${crypto.createHash('sha1').update(data).digest('hex').slice(0, 16)}${ext}`;

async function importDeckIntoComponent({ pptxPath, component, deps, lang = 'en' }) {
  if (!component || component._component !== 'slides') {
    throw new SlidesImportError('PowerPoint import only works on a Slides component.');
  }
  let extracted;
  try {
    extracted = converter.extract(pptxPath, { lang, notes: false, includeHidden: false, layout: 'slides' });
  } catch (e) {
    throw new SlidesImportError(e.message);
  }
  const { items, warnings } = converter.slidesItems(extracted.slides, lang);
  const byFile = new Map(extracted.assets.map(a => [a.file, a]));

  const mediaByFile = new Map((extracted.media || []).map(m => [m.file, m]));

  const stored = new Map(); // asset id -> stored filename
  const pictureFiles = new Set(); // distinct files, so a picture or clip reused on several slides counts once
  const clipFiles = new Set();
  const place = async (field, bytes, ext, alt, seen) => {
    const asset = await deps.importAsset({ file: hashedName(bytes, ext), data: bytes, alt });
    stored.set(asset.assetId, asset.filename);
    seen.add(asset.assetId);
    field.src = `course/assets/${asset.filename}`;
  };
  for (const item of items) {
    const image = item._graphic.src && byFile.get(path.basename(item._graphic.src));
    if (image) await place(item._graphic, image.data, path.extname(image.file).toLowerCase(), item._graphic.alt, pictureFiles); else item._graphic.src = '';
    for (const key of ['_video', '_audio']) {
      const clip = item[key].src && mediaByFile.get(path.basename(item[key].src));
      if (clip) await place(item[key], clip.data, path.extname(clip.file).toLowerCase(), '', clipFiles); else item[key].src = '';
    }
  }

  await deps.clearAssetLinks(component);
  for (const [assetId, filename] of stored) await deps.linkAsset(component, assetId, filename);
  await deps.saveItems(component, items);

  return {
    slides: items.length,
    pictures: pictureFiles.size,
    media: clipFiles.size,
    warnings: extracted.warnings.concat(warnings),
    noAlt: extracted.noAlt
  };
}

module.exports = { importDeckIntoComponent, SlidesImportError, hashedName };
