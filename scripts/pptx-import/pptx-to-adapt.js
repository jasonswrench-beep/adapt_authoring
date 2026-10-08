#!/usr/bin/env node
/**
 * Convert a PowerPoint (.pptx) deck into an Adapt framework source zip that the
 * authoring tool's "Import source" feature accepts.
 *
 * Usage:
 *   node pptx-to-adapt.js deck.pptx [-o out.zip] [--layout single|pages] [--notes]
 *        [--include-hidden] [--title "Course title"] [--lang en] [--framework 5.56.3]
 *
 * Layouts:
 *   single (default)  one scrolling page; each slide becomes a section (Rise-like)
 *   pages             each slide becomes its own page, listed on the course menu
 *
 * Only the always-installed core components (text, graphic) are emitted, so the import
 * never depends on optional plugins. Google Slides decks work via File > Download > .pptx.
 */
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { DOMParser } = require('@xmldom/xmldom');

const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  dc: 'http://purl.org/dc/elements/1.1/'
};
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);
const SKIP_PLACEHOLDERS = new Set(['sldNum', 'ftr', 'dt', 'hdr']);
const TITLE_PLACEHOLDERS = new Set(['title', 'ctrTitle']);

// ---------- small XML helpers ----------
const parseXml = buf => new DOMParser({
  errorHandler: { warning() {}, error() {}, fatalError(e) { throw new Error(e); } }
}).parseFromString(buf.toString('utf8'), 'text/xml');
const elementChildren = n => Array.from(n.childNodes).filter(c => c.nodeType === 1);
const kids = (n, ns, local) => elementChildren(n).filter(c => c.namespaceURI === ns && c.localName === local);
const kid = (n, ns, local) => kids(n, ns, local)[0];
const desc = (n, ns, local) => Array.from(n.getElementsByTagNameNS(ns, local));
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const stripTags = s => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

/** Alt text that is really a filename or a stock label ("image.png", "Picture 3") is not useful to learners. */
const isPlaceholderAlt = alt => !alt || /\.(png|jpe?g|gif|svg|webp|bmp|emf|wmf)$/i.test(alt) ||
  /^(image|picture|img|photo|graphic|content placeholder)[\s_-]*\d*$/i.test(alt);

function safeUrl(url) {
  return url && /^(https?:|mailto:)/i.test(url.trim()) ? url.trim() : null;
}

// ---------- package helpers ----------
function readPart(zip, name) {
  const entry = zip.getEntry(name);
  return entry ? zip.readFile(entry) : null;
}

function readRels(zip, part) {
  const rels = {};
  const buf = readPart(zip, `${path.posix.dirname(part)}/_rels/${path.posix.basename(part)}.rels`);
  if (!buf) return rels;
  const dir = path.posix.dirname(part);
  Array.from(parseXml(buf).getElementsByTagName('Relationship')).forEach(rel => {
    const external = rel.getAttribute('TargetMode') === 'External';
    let target = rel.getAttribute('Target');
    if (!external) {
      target = target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(dir, target));
    }
    rels[rel.getAttribute('Id')] = { type: rel.getAttribute('Type'), target, external };
  });
  return rels;
}

function slideParts(zip) {
  const presPath = 'ppt/presentation.xml';
  const pres = parseXml(readPart(zip, presPath));
  const rels = readRels(zip, presPath);
  return desc(pres, NS.p, 'sldId').map(id => {
    const rel = rels[id.getAttributeNS(NS.r, 'id')];
    return rel && rel.target;
  }).filter(Boolean);
}

// ---------- text conversion ----------
function runsToHtml(p, rels) {
  let out = '';
  elementChildren(p).forEach(c => {
    if (c.namespaceURI !== NS.a) return;
    if (c.localName === 'br') { out += '<br>'; return; }
    if (c.localName !== 'r' && c.localName !== 'fld') return;
    const t = kid(c, NS.a, 't');
    if (!t || !t.textContent) return;
    let text = esc(t.textContent);
    const rPr = kid(c, NS.a, 'rPr');
    if (rPr) {
      if (rPr.getAttribute('b') === '1') text = `<strong>${text}</strong>`;
      if (rPr.getAttribute('i') === '1') text = `<em>${text}</em>`;
      const link = kid(rPr, NS.a, 'hlinkClick');
      const rel = link && rels[link.getAttributeNS(NS.r, 'id')];
      const url = rel && rel.external && safeUrl(rel.target);
      if (url) text = `<a href="${esc(url)}" target="_blank" rel="noopener">${text}</a>`;
    }
    out += text;
  });
  return out;
}

function paragraphInfo(p, rels) {
  const pPr = kid(p, NS.a, 'pPr');
  let bullet = null;
  let explicit = false;
  if (pPr) {
    if (kid(pPr, NS.a, 'buChar')) { bullet = 'ul'; explicit = true; }
    else if (kid(pPr, NS.a, 'buAutoNum')) { bullet = 'ol'; explicit = true; }
    else if (kid(pPr, NS.a, 'buNone')) { explicit = true; }
  }
  return { html: runsToHtml(p, rels), level: pPr ? parseInt(pPr.getAttribute('lvl') || '0', 10) : 0, bullet, explicit };
}

/** Build HTML from paragraphs. defaultBullets: body placeholders inherit bullets from the slide master. */
function paragraphsToHtml(paras, defaultBullets) {
  const items = paras.filter(p => stripTags(p.html));
  const useDefault = defaultBullets && items.length > 1;
  let html = '';
  const stack = [];
  const closeTo = lvl => {
    while (stack.length && stack[stack.length - 1].lvl > lvl) html += `</li></${stack.pop().type}>`;
  };
  items.forEach(p => {
    const bullet = p.bullet || (!p.explicit && useDefault ? 'ul' : null);
    if (!bullet) { closeTo(-1); html += `<p>${p.html}</p>`; return; }
    closeTo(p.level);
    const top = stack[stack.length - 1];
    if (top && top.lvl === p.level && top.type === bullet) {
      html += `</li><li>${p.html}`;
    } else if (top && top.lvl === p.level) {
      html += `</li></${top.type}>`;
      stack.pop();
      html += `<${bullet}><li>${p.html}`;
      stack.push({ type: bullet, lvl: p.level });
    } else {
      html += `<${bullet}><li>${p.html}`;
      stack.push({ type: bullet, lvl: p.level });
    }
  });
  closeTo(-1);
  return html;
}

function tableToHtml(tbl, rels) {
  const hasHeader = (kid(tbl, NS.a, 'tblPr') || { getAttribute: () => '' }).getAttribute('firstRow') === '1';
  const cell = 'style="border:1px solid #999;padding:4px 8px;text-align:left"';
  let html = '<table style="border-collapse:collapse;width:100%">';
  kids(tbl, NS.a, 'tr').forEach((tr, rowIndex) => {
    html += '<tr>';
    kids(tr, NS.a, 'tc').forEach(tc => {
      if (tc.getAttribute('hMerge') === '1' || tc.getAttribute('vMerge') === '1') return;
      const tag = hasHeader && rowIndex === 0 ? 'th' : 'td';
      const body = kid(tc, NS.a, 'txBody');
      const text = body ? kids(body, NS.a, 'p').map(p => runsToHtml(p, rels)).filter(h => stripTags(h)).join('<br>') : '';
      const span = tc.getAttribute('gridSpan');
      const rowspan = tc.getAttribute('rowSpan');
      html += `<${tag} ${cell}${span ? ` colspan="${esc(span)}"` : ''}${rowspan ? ` rowspan="${esc(rowspan)}"` : ''}>${text}</${tag}>`;
    });
    html += '</tr>';
  });
  return `${html}</table>`;
}

// ---------- slide conversion ----------
/** Layout type of the slide ("title", "secHead", ...). Used to decide whether body text is bulleted. */
function layoutType(zip, rels) {
  const rel = Object.values(rels).find(r => /\/slideLayout$/.test(r.type));
  const buf = rel && readPart(zip, rel.target);
  return buf ? parseXml(buf).documentElement.getAttribute('type') || '' : '';
}

function notesText(zip, rels) {
  const rel = Object.values(rels).find(r => /\/notesSlide$/.test(r.type));
  const buf = rel && readPart(zip, rel.target);
  if (!buf) return '';
  const doc = parseXml(buf);
  const body = desc(doc, NS.p, 'sp').find(sp => {
    const ph = desc(sp, NS.p, 'ph')[0];
    return ph && ph.getAttribute('type') === 'body';
  });
  if (!body) return '';
  const tx = kid(body, NS.p, 'txBody');
  return tx ? paragraphsToHtml(kids(tx, NS.a, 'p').map(p => paragraphInfo(p, {})), false) : '';
}

function convertSlide(zip, partName, number, ctx) {
  const doc = parseXml(readPart(zip, partName));
  const rels = readRels(zip, partName);
  const root = doc.documentElement;
  const warn = msg => ctx.warnings.push(`Slide ${number}: ${msg}`);
  const slide = { number, hidden: root.getAttribute('show') === '0', title: '', items: [], notes: '' };
  const isTitleLayout = ['title', 'secHead', 'titleOnly'].includes(layoutType(zip, rels));

  const spTree = desc(root, NS.p, 'spTree')[0];
  const addText = html => {
    if (!html) return;
    const last = slide.items[slide.items.length - 1];
    if (last && last.kind === 'text') last.html += html; else slide.items.push({ kind: 'text', html });
  };

  const handleShape = sp => {
    const ph = desc(sp, NS.p, 'ph')[0];
    const phType = ph ? ph.getAttribute('type') || 'body' : null;
    if (phType && SKIP_PLACEHOLDERS.has(phType)) return;
    const tx = kid(sp, NS.p, 'txBody');
    if (!tx) return;
    const paras = kids(tx, NS.a, 'p').map(p => paragraphInfo(p, rels));
    if (phType && TITLE_PLACEHOLDERS.has(phType) && !slide.title) {
      slide.title = paras.map(p => stripTags(p.html)).filter(Boolean).join(' ');
      return;
    }
    const bulletsByDefault = !!phType && ['body', 'obj'].includes(phType) && !isTitleLayout;
    addText(paragraphsToHtml(paras, bulletsByDefault));
  };

  const handlePicture = pic => {
    const media = desc(pic, NS.a, 'videoFile').concat(desc(pic, NS.a, 'audioFile'), desc(pic, NS.a, 'wavAudioFile'));
    if (media.length) {
      const rel = rels[media[0].getAttributeNS(NS.r, 'link')];
      const url = rel && rel.external && safeUrl(rel.target);
      warn(`embedded video/audio not converted${url ? ` (linked: ${url})` : ''}. Add it with a Media or YouTube component.`);
      if (url) addText(`<p><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></p>`);
      return;
    }
    const blip = desc(pic, NS.a, 'blip')[0];
    const rel = blip && rels[blip.getAttributeNS(NS.r, 'embed')];
    if (!rel) return;
    const ext = path.extname(rel.target).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) {
      warn(`image ${path.basename(rel.target)} (${ext || 'unknown type'}) is not a web format and was skipped.`);
      return;
    }
    const data = readPart(zip, rel.target);
    if (!data) { warn(`image ${rel.target} missing from the file.`); return; }
    const cNvPr = desc(pic, NS.p, 'cNvPr')[0];
    const rawAlt = cNvPr ? (cNvPr.getAttribute('descr') || '').trim() : '';
    const alt = isPlaceholderAlt(rawAlt) ? '' : rawAlt;
    const file = ctx.addAsset(rel.target, ext === '.jpeg' ? '.jpg' : ext, data, number);
    if (!alt) ctx.noAlt.push(`slide ${number} (${file})`);
    slide.items.push({ kind: 'image', file, alt });
  };

  const handleFrame = frame => {
    const tbl = desc(frame, NS.a, 'tbl')[0];
    if (tbl) { addText(tableToHtml(tbl, rels)); return; }
    warn('a chart, diagram or embedded object was not converted. Export it as an image and insert it in the editor.');
  };

  const walk = node => elementChildren(node).forEach(c => {
    if (c.namespaceURI !== NS.p) return;
    switch (c.localName) {
      case 'sp': handleShape(c); break;
      case 'pic': handlePicture(c); break;
      case 'graphicFrame': handleFrame(c); break;
      case 'grpSp': walk(c); break;
      default:
    }
  });
  if (spTree) walk(spTree);

  if (!slide.title) {
    warn('no title placeholder found; using a default title.');
    slide.title = `Slide ${number}`;
  }
  if (ctx.options.notes) slide.notes = notesText(zip, rels);
  return slide;
}

// ---------- Adapt content ----------
function buildContent(slides, courseTitle, options) {
  const lang = options.lang;
  const course = JSON.parse(fs.readFileSync(path.join(__dirname, 'template', 'course.json'), 'utf8'));
  Object.assign(course, { title: courseTitle, displayTitle: courseTitle, description: '', body: '' });

  const contentObjects = [];
  const articles = [];
  const blocks = [];
  const components = [];
  let n = 0;
  const id = prefix => `${prefix}-${String(++n).padStart(3, '0')}`;

  let singlePageId = null;
  if (options.layout === 'single') {
    singlePageId = id('co');
    contentObjects.push({
      _id: singlePageId, _parentId: 'course', _type: 'page', _classes: '', title: courseTitle,
      displayTitle: courseTitle, body: '', pageBody: '', instruction: ''
    });
  }

  slides.forEach(slide => {
    let pageId = singlePageId;
    if (options.layout === 'pages') {
      pageId = id('co');
      contentObjects.push({
        _id: pageId, _parentId: 'course', _type: 'page', _classes: '', title: slide.title,
        displayTitle: slide.title, body: '', pageBody: '', instruction: ''
      });
    }
    const articleId = id('a');
    articles.push({
      _id: articleId, _parentId: pageId, _type: 'article', _classes: '', title: slide.title,
      displayTitle: options.layout === 'single' ? slide.title : '', body: '', instruction: ''
    });

    const comps = slide.items.slice();
    if (slide.notes) comps.push({ kind: 'text', html: `<p><strong>Notes</strong></p>${slide.notes}` });
    if (!comps.length) return; // title-only slide: the article heading is the content

    const blockId = id('b');
    blocks.push({
      _id: blockId, _parentId: articleId, _type: 'block', _classes: '', title: slide.title,
      displayTitle: '', body: '', instruction: ''
    });
    const sideBySide = comps.length === 2 && comps.some(c => c.kind === 'text') && comps.some(c => c.kind === 'image');
    comps.forEach((c, i) => {
      const layout = sideBySide ? (i === 0 ? 'left' : 'right') : 'full';
      const base = { _id: id('c'), _parentId: blockId, _type: 'component', _classes: '', _layout: layout };
      if (c.kind === 'text') {
        components.push(Object.assign(base, {
          _component: 'text', title: slide.title, displayTitle: '', body: c.html, instruction: ''
        }));
      } else {
        const src = `course/${lang}/images/${c.file}`;
        components.push(Object.assign(base, {
          _component: 'graphic', title: c.alt || slide.title, displayTitle: '', body: '', instruction: '',
          _graphic: { alt: c.alt, longdescription: '', large: src, small: src, attribution: '', _url: '', _target: '' },
          _isScrollable: false, _defaultScrollPercent: 0, _isOptional: false
        }));
      }
    });
  });

  return { course, contentObjects, articles, blocks, components };
}

function buildZip(content, assets, options) {
  const zip = new AdmZip();
  const put = (name, data) => zip.addFile(name, Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data, null, 2)));
  const base = `src/course/${options.lang}`;
  put('package.json', { name: 'adapt_framework', version: options.framework });
  put('src/course/config.json', {
    _type: 'config', _defaultLanguage: options.lang, _defaultDirection: 'ltr', _questionWeight: 1,
    _theme: 'adapt-contrib-vanilla', _menu: 'adapt-contrib-boxMenu'
  });
  put(`${base}/course.json`, content.course);
  put(`${base}/contentObjects.json`, content.contentObjects);
  put(`${base}/articles.json`, content.articles);
  put(`${base}/blocks.json`, content.blocks);
  put(`${base}/components.json`, content.components);
  assets.forEach(a => put(`${base}/images/${a.file}`, a.data));
  return zip;
}

// ---------- main ----------
function convert(inputPath, options) {
  if (!fs.existsSync(inputPath)) throw new Error(`File not found: ${inputPath}`);
  let zip;
  try { zip = new AdmZip(inputPath); } catch (e) {
    throw new Error(`${path.basename(inputPath)} is not a valid .pptx file (older .ppt files must be re-saved as .pptx).`);
  }
  if (!zip.getEntry('ppt/presentation.xml')) throw new Error('Not a .pptx file (ppt/presentation.xml not found).');

  const assets = [];
  const byPart = new Map();
  const ctx = {
    options, warnings: [], noAlt: [],
    addAsset(part, ext, data, slideNumber) {
      if (byPart.has(part)) return byPart.get(part);
      const file = `slide${String(slideNumber).padStart(2, '0')}_img${assets.length + 1}${ext}`;
      assets.push({ file, data });
      byPart.set(part, file);
      return file;
    }
  };

  const parts = slideParts(zip);
  if (!parts.length) throw new Error('No slides found in the presentation.');
  const all = parts.map((part, i) => convertSlide(zip, part, i + 1, ctx));
  const hidden = all.filter(s => s.hidden);
  const slides = options.includeHidden ? all : all.filter(s => !s.hidden);
  hidden.forEach(s => ctx.warnings.push(`Slide ${s.number}: hidden slide ${options.includeHidden ? 'included' : 'skipped (use --include-hidden to keep it)'}.`));

  let courseTitle = options.title;
  if (!courseTitle) {
    const core = readPart(zip, 'docProps/core.xml');
    const t = core && desc(parseXml(core), NS.dc, 'title')[0];
    courseTitle = (t && t.textContent.trim()) || (slides[0] && slides[0].title) || path.basename(inputPath, '.pptx');
  }

  const content = buildContent(slides, courseTitle, options);
  const out = buildZip(content, assets, options);
  return {
    out, courseTitle, warnings: ctx.warnings, noAlt: ctx.noAlt,
    stats: {
      slides: slides.length, hidden: hidden.length, pages: content.contentObjects.length, images: assets.length,
      textComponents: content.components.filter(c => c._component === 'text').length
    }
  };
}

function parseArgs(argv) {
  const opts = { layout: 'single', lang: 'en', framework: '5.56.3', notes: false, includeHidden: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') opts.outPath = argv[++i];
    else if (a === '--layout') opts.layout = argv[++i];
    else if (a === '--title') opts.title = argv[++i];
    else if (a === '--lang') opts.lang = argv[++i];
    else if (a === '--framework') opts.framework = argv[++i];
    else if (a === '--notes') opts.notes = true;
    else if (a === '--include-hidden') opts.includeHidden = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else rest.push(a);
  }
  opts.input = rest[0];
  return opts;
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.input) {
    console.log('Usage: node pptx-to-adapt.js deck.pptx [-o out.zip] [--layout single|pages] [--notes] [--include-hidden] [--title "..."] [--lang en] [--framework 5.56.3]');
    process.exit(opts.help ? 0 : 1);
  }
  if (!['single', 'pages'].includes(opts.layout)) { console.error('--layout must be "single" or "pages"'); process.exit(1); }
  if (!/^[a-z]{2}$/i.test(opts.lang)) { console.error('--lang must be a two-letter code, e.g. "en"'); process.exit(1); }
  try {
    const outPath = opts.outPath || path.join(path.dirname(opts.input), `${path.basename(opts.input, '.pptx')}-adapt.zip`);
    const result = convert(opts.input, opts);
    result.out.writeZip(outPath);
    const s = result.stats;
    console.log(`Created ${outPath}`);
    console.log(`  "${result.courseTitle}": ${s.slides} slides (${s.hidden} hidden), ${s.pages} page(s), ${s.textComponents} text blocks, ${s.images} images`);
    if (result.noAlt.length) console.log(`\nImages with no alt text (add it in the editor): ${result.noAlt.join(', ')}`);
    if (result.warnings.length) console.log(`\nNeeds attention:\n${result.warnings.map(w => `  - ${w}`).join('\n')}`);
    console.log('\nNext: in the authoring tool choose "Import source" and upload the zip.');
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

module.exports = { convert, paragraphsToHtml };
