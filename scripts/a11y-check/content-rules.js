/**
 * Adapt-aware accessibility rules. They run on the course JSON (the same data in a built course's
 * course/<lang>/*.json or a source course's src/course/<lang>/*.json) and catch what a generic
 * HTML scanner cannot: missing alt text in component settings, media without transcripts, etc.
 *
 * A finding is { rule, severity: 'error'|'warning'|'info', wcag, where, message, fix }.
 */
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp)(\?.*)?$/i;
const VAGUE_LINK = /^(click here|click|here|link|this link|this|link here)$/i;
const SOFT_VAGUE_LINK = /^(read more|more|learn more|more info|more information|details|see more|find out more)$/i;
const MEDIA_COMPONENTS = new Set(['media', 'youtube', 'vimeo']);

const stripTags = s => String(s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const isHtmlish = s => typeof s === 'string' && /<[a-z][\s\S]*>/i.test(s);

function checkContent(data) {
  const findings = [];
  const { config = {}, course = {}, contentObjects = [], articles = [], blocks = [], components = [] } = data;
  const byId = {};
  [course, ...contentObjects, ...articles, ...blocks, ...components].forEach(i => { if (i && i._id) byId[i._id] = i; });

  const pageOf = item => {
    let cur = item;
    for (let i = 0; i < 6 && cur; i++) {
      if (cur._type === 'page' || cur._type === 'menu') return cur;
      cur = byId[cur._parentId];
    }
    return null;
  };
  const whereOf = item => {
    const page = pageOf(item);
    return {
      type: item._component ? `${item._component} component` : item._type,
      id: item._id,
      title: item.displayTitle || item.title || item._id,
      page: page ? (page.displayTitle || page.title) : ''
    };
  };
  const add = (item, rule, severity, wcag, message, fix) =>
    findings.push({ rule, severity, wcag, where: whereOf(item), message, fix });

  /** Visit every string with its property path. */
  const eachString = (value, fn, trail = '') => {
    if (typeof value === 'string') return fn(value, trail);
    if (Array.isArray(value)) return value.forEach((v, i) => eachString(v, fn, `${trail}[${i}]`));
    if (value && typeof value === 'object') {
      Object.keys(value).forEach(k => eachString(value[k], fn, trail ? `${trail}.${k}` : k));
    }
  };
  /** Visit every object (with path) so image settings of any component type are found. */
  const eachObject = (value, fn, trail = '') => {
    if (Array.isArray(value)) return value.forEach((v, i) => eachObject(v, fn, `${trail}[${i}]`));
    if (value && typeof value === 'object') {
      fn(value, trail);
      Object.keys(value).forEach(k => eachObject(value[k], fn, trail ? `${trail}.${k}` : k));
    }
  };

  const allItems = [course, ...contentObjects, ...articles, ...blocks, ...components].filter(Boolean);

  // ---- images ----
  allItems.forEach(item => {
    const isComponent = item._type === 'component';
    eachObject(item, (o, trail) => {
      if (!('alt' in o)) return;
      const hasImage = ['src', 'large', 'small', 'url'].some(k => typeof o[k] === 'string' && IMAGE_EXT.test(o[k]));
      if (!hasImage) return;
      const alt = (o.alt || '').trim();
      const spot = trail ? ` (${trail})` : '';
      if (!alt) {
        add(item, 'image-alt-missing', isComponent ? 'error' : 'warning', '1.1.1',
          `Image has no alt text${spot}.`,
          'Describe what the image shows. Leave it empty only if the image is purely decorative.');
      } else if (/\.(png|jpe?g|gif|svg|webp)$/i.test(alt) || /^(image|picture|img|photo|graphic)[\s_-]*\d*$/i.test(alt)) {
        add(item, 'image-alt-filename', 'error', '1.1.1', `Alt text "${alt}" is a filename or generic label${spot}.`,
          'Replace it with a short description of the image content.');
      } else if (alt.length > 150) {
        add(item, 'image-alt-long', 'warning', '1.1.1', `Alt text is ${alt.length} characters${spot}.`,
          'Keep alt text under about 150 characters and put detail in the "long description" field.');
      } else if (/^(image|picture|photo|graphic) of\b/i.test(alt)) {
        add(item, 'image-alt-redundant', 'info', '1.1.1', `Alt text starts with "${alt.split(' ')[0]} of"${spot}.`,
          'Screen readers already announce images; start with the description itself.');
      }
    });
  });

  // ---- HTML in text fields ----
  allItems.forEach(item => {
    const headingLevels = [];
    eachString(item, (str, trail) => {
      if (!isHtmlish(str)) return;
      const spot = trail ? ` (${trail})` : '';
      let m;
      const linkRe = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
      while ((m = linkRe.exec(str))) {
        const text = stripTags(m[1]);
        const hasImgAlt = /<img\b[^>]*\balt=["'][^"']+["']/i.test(m[1]);
        const hasAria = /\baria-label=["'][^"']+["']/i.test(m[0].split('>')[0]);
        if (!text && !hasImgAlt && !hasAria) {
          add(item, 'link-empty', 'error', '2.4.4', `A link has no text${spot}.`, 'Give the link descriptive text.');
        } else if (VAGUE_LINK.test(text)) {
          add(item, 'link-vague', 'error', '2.4.4', `Link text "${text}" does not say where it goes${spot}.`,
            'Use text that makes sense out of context, e.g. "Download the study planner (PDF)".');
        } else if (SOFT_VAGUE_LINK.test(text)) {
          add(item, 'link-vague', 'warning', '2.4.4', `Link text "${text}" is vague${spot}.`,
            'Name the destination in the link text.');
        } else if (/^https?:\/\//i.test(text)) {
          add(item, 'link-url-text', 'warning', '2.4.4', `Link text is a raw web address${spot}.`,
            'Replace the address with a short description of the page.');
        }
      }
      const tableRe = /<table\b[\s\S]*?<\/table>/gi;
      while ((m = tableRe.exec(str))) {
        if (!/<th\b/i.test(m[0])) {
          add(item, 'table-no-header', 'error', '1.3.1', `A table has no header cells${spot}.`,
            'Make the first row (or column) header cells so screen readers can announce them.');
        } else if (!/<caption\b/i.test(m[0]) && !/aria-label|aria-labelledby/i.test(m[0])) {
          add(item, 'table-no-caption', 'info', '1.3.1', `A table has no caption or label${spot}.`,
            'Add a caption saying what the table shows.');
        }
      }
      const hRe = /<h([1-6])\b/gi;
      while ((m = hRe.exec(str))) headingLevels.push({ level: Number(m[1]), spot });
      if (/<iframe\b(?![^>]*\btitle=["'][^"']+["'])/i.test(str)) {
        add(item, 'iframe-title', 'error', '4.1.2', `An embedded frame has no title${spot}.`, 'Add a title attribute describing the embedded content.');
      }
      if (/<(font|blink|marquee)\b/i.test(str)) {
        add(item, 'obsolete-markup', 'error', '1.4.2', `Obsolete or flashing markup (font/blink/marquee)${spot}.`, 'Remove it and use normal formatting.');
      }
      const colorStyle = /style=["'](?:[^"']*[;\s])?(?:color|background(?:-color)?)\s*:/i.exec(str);
      if (colorStyle) {
        add(item, 'inline-colour', 'warning', '1.4.1', `Text uses a custom colour${spot}.`,
          'Check the colour contrast is at least 4.5:1, and do not use colour as the only way to show meaning.');
      }
      const smallText = /font-size\s*:\s*(\d+(?:\.\d+)?)px/i.exec(str);
      if (smallText && Number(smallText[1]) < 12) {
        add(item, 'small-text', 'warning', '1.4.4', `Text is set smaller than 12px${spot}.`, 'Use the default size, or at least 12px.');
      }
    });
    headingLevels.forEach((h, i) => {
      if (h.level <= 3) {
        add(item, 'heading-level', 'warning', '1.3.1',
          `Content uses a level ${h.level} heading${h.spot}.`,
          'Page, section and block titles already use heading levels 1 to 4. Use bold text, or a lower heading level, inside components.');
      } else if (i > 0 && h.level - headingLevels[i - 1].level > 1) {
        add(item, 'heading-skip', 'warning', '1.3.1', `Heading levels skip from ${headingLevels[i - 1].level} to ${h.level}${h.spot}.`,
          'Do not skip heading levels.');
      }
    });
  });

  // ---- media ----
  components.filter(c => MEDIA_COMPONENTS.has(c._component)).forEach(c => {
    const t = c._transcript || {};
    const hasTranscript = (t._inlineTranscript && stripTags(t.inlineTranscriptBody || '')) || (t._externalTranscript && t.transcriptLink);
    if (!hasTranscript) {
      add(c, 'media-transcript', 'error', '1.2.1',
        'Video or audio has no transcript.',
        'Turn on the inline or external transcript and add the text, so deaf and hard-of-hearing learners can follow the content.');
    }
    const media = c._media || {};
    if (c._component === 'media') {
      const isVideo = !!(media.mp4 || media.webm || media.ogv || media.source) || media.type === 'video/mp4';
      const hasCaptions = Array.isArray(media.cc) ? media.cc.some(x => x && x.src) : !!media.cc;
      if (isVideo && !hasCaptions) {
        add(c, 'media-captions', 'warning', '1.2.2', 'Video has no caption file.', 'Upload a captions file (.vtt) in the Subtitles/Captions setting.');
      }
    } else {
      add(c, 'media-captions-external', 'info', '1.2.2', `The ${c._component} video is hosted elsewhere.`,
        'Check that the video itself has accurate captions turned on at the source.');
    }
    if (media._autoplay === true || c._autoplay === true) {
      add(c, 'media-autoplay', 'error', '2.2.2', 'Media starts playing automatically.', 'Turn autoplay off so learners control playback.');
    }
  });
  components.filter(c => c._component === 'h5pPlayer').forEach(c => {
    if (!(c._h5p && c._h5p._src)) {
      add(c, 'h5p-missing-file', 'error', '4.1.2', 'H5P activity has no file selected.', 'Upload a .h5p file to the asset library and select it in the component settings.');
    }
    add(c, 'embed-review', 'info', '2.1.1',
      'Embedded H5P activity.', 'The accessibility of the activity depends on how it was built. Try it with a keyboard and a screen reader, and check any images, audio or video inside it have alternatives; this checker cannot look inside it.');
  });
  components.filter(c => c._component === 'iframe').forEach(c => {
    add(c, 'embed-review', 'info', '2.1.1',
      'Embedded web content (iframe).', 'Check the embedded page can be used with a keyboard and a screen reader; this checker cannot look inside it.');
  });

  // ---- structure ----
  const pages = contentObjects.filter(c => c._type === 'page' || c._type === 'menu');
  const seen = {};
  pages.forEach(p => {
    const title = stripTags(p.displayTitle || p.title || '');
    if (!title) {
      add(p, 'page-title-missing', 'error', '2.4.2', `A ${p._type} has no title.`, 'Give every page a descriptive title.');
    } else {
      (seen[title.toLowerCase()] = seen[title.toLowerCase()] || []).push(p);
    }
  });
  Object.keys(seen).filter(k => seen[k].length > 1).forEach(k => {
    seen[k].forEach(p => add(p, 'page-title-duplicate', 'warning', '2.4.2',
      `Another page has the same title ("${stripTags(p.displayTitle || p.title)}").`, 'Give each page a distinct title.'));
  });

  // ---- course settings ----
  const acc = config._accessibility;
  if (acc && acc._isEnabled === false) {
    add({ _id: 'config', _type: 'config', title: 'Course configuration' }, 'a11y-disabled', 'error', '4.1.2',
      'The framework accessibility features are switched off.', 'Turn "Accessibility" back on in the course configuration.');
  }
  if (acc && acc._isSkipNavigationEnabled === false) {
    add({ _id: 'config', _type: 'config', title: 'Course configuration' }, 'skip-nav-disabled', 'warning', '2.4.1',
      'The "skip navigation" link is switched off.', 'Turn it back on so keyboard users can jump to the content.');
  }
  if (!config._defaultLanguage) {
    add({ _id: 'config', _type: 'config', title: 'Course configuration' }, 'language-missing', 'error', '3.1.1',
      'The course language is not set.', 'Set the default language.');
  }
  return findings;
}

module.exports = { checkContent, stripTags };
