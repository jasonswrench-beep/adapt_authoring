// Checks a generated zip against the constraints enforced by the authoring tool's importer
// (plugins/output/adapt/importsourcecheck.js and importsource.js). Usage: node validate.js out.zip
const AdmZip = require('adm-zip');
const zip = new AdmZip(process.argv[2]);
const errors = [];
const fail = m => errors.push(m);
const json = name => { const e = zip.getEntry(name); if (!e) { fail(`missing ${name}`); return null; } return JSON.parse(zip.readAsText(e)); };

const pkg = json('package.json');
if (!pkg || !/^\d+\.\d+\.\d+/.test(pkg.version)) fail('package.json needs a semver "version"');
json('src/course/config.json');
const langDirs = [...new Set(zip.getEntries().map(e => e.entryName.match(/^src\/course\/([^/]+)\//)).filter(Boolean).map(m => m[1]))];
if (langDirs.length !== 1 || !/^\w\w$/.test(langDirs[0])) fail(`language folder must be one 2-letter dir, got ${langDirs}`);
const L = langDirs[0];
const course = json(`src/course/${L}/course.json`);
const cos = json(`src/course/${L}/contentObjects.json`) || [];
const arts = json(`src/course/${L}/articles.json`) || [];
const blocks = json(`src/course/${L}/blocks.json`) || [];
const comps = json(`src/course/${L}/components.json`) || [];

const ids = new Set(['course']);
[...cos, ...arts, ...blocks, ...comps].forEach(i => { if (ids.has(i._id)) fail(`duplicate _id ${i._id}`); ids.add(i._id); });
const parentOk = (items, type, parents) => items.forEach(i => {
  if (i._type !== type) fail(`${i._id} has _type ${i._type}, expected ${type}`);
  if (!parents.has(i._parentId)) fail(`${i._id} has unknown _parentId ${i._parentId}`);
});
parentOk(cos, 'page', new Set(['course']));
parentOk(arts, 'article', new Set(cos.map(i => i._id)));
parentOk(blocks, 'block', new Set(arts.map(i => i._id)));
parentOk(comps, 'component', new Set(blocks.map(i => i._id)));
if (course._id !== 'course' || course._type !== 'course' || !course.title) fail('course.json needs _id/_type "course" and a title');

// the authoring tool (validateCourse) and the framework build both reject parents with no children
[[cos, arts, 'page'], [arts, blocks, 'article'], [blocks, comps, 'block']].forEach(([parents, children, type]) => {
  parents.forEach(pr => { if (!children.some(c => c._parentId === pr._id)) fail(`${type} ${pr._id} ("${pr.title}") has no children`); });
});
cos.forEach(pg => { if (!arts.some(a => a._parentId === pg._id)) fail(`page ${pg._id} has no articles`); });

const files = new Set(zip.getEntries().map(e => e.entryName));
comps.forEach(c => {
  // text and graphic are core; slides is this repository's Slides component (in the plugin bundle)
  if (!['text', 'graphic', 'slides'].includes(c._component)) fail(`${c._id} uses unexpected component ${c._component}`);
  if (!['full', 'left', 'right'].includes(c._layout)) fail(`${c._id} bad _layout ${c._layout}`);
  if (c._component === 'graphic') {
    ['large', 'small'].forEach(k => {
      const p = c._graphic[k];
      if (!files.has(`src/${p}`)) fail(`${c._id} references missing asset ${p}`);
      // the importer's asset regexp only matches names made of word characters + one extension
      if (!/^course\/\w\w\/images\/\w+\.[a-z0-9]+$/i.test(p)) fail(`${c._id} asset path not importer-safe: ${p}`);
    });
  }
});
zip.getEntries().filter(e => /\/images\//.test(e.entryName) && !e.isDirectory).forEach(e => {
  if (!/^\w+\.[a-z0-9]+$/i.test(e.entryName.split('/').pop())) fail(`unsafe asset filename ${e.entryName}`);
});

console.log(`pages ${cos.length}, articles ${arts.length}, blocks ${blocks.length}, components ${comps.length}`);
if (errors.length) { console.error(errors.map(e => ' - ' + e).join('\n')); process.exit(1); }
console.log('OK: output satisfies the importer constraints checked here');
