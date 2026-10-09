/**
 * Server self-test: goes through the server-side parts of docs/SMOKE-TEST.md on its own, using the tool's own REST API
 * and a throwaway course (deleted at the end). Run on the server with:  sh scripts/selftest.sh
 * It logs in as the super user from .env, so nothing needs typing. Prints one PASS/FAIL line per check.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.SELFTEST_URL || 'http://127.0.0.1:5000';
const EMAIL = process.env.ADAPT_SU_EMAIL;
const PASSWORD = process.env.ADAPT_SU_PASSWORD;
let cookie = '';
let failures = 0;

const say = (ok, name, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
  if (!ok) failures++;
};
async function step(name, fn) {
  try {
    const detail = await fn();
    say(true, name, typeof detail === 'string' ? detail : '');
    return true;
  } catch (e) {
    say(false, name, String(e && e.message || e).slice(0, 400));
    return false;
  }
}
function must(cond, message) { if (!cond) throw new Error(message); }

async function call(method, url, body, opts = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: Object.assign({ cookie }, body ? { 'content-type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual'
  });
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (set.length) cookie = set.map(c => c.split(';')[0]).join('; ');
  if (opts.raw) return res;
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { json = undefined; }
  return { status: res.status, json, text };
}

async function main() {
  console.log(`Self-test against ${BASE}\n`);
  let tenantId, courseId, textType;

  if (!await step('server answers', async () => {
    for (let i = 0; i < 20; i++) {
      try { const r = await fetch(BASE + '/api/authcheck'); if (r.status === 200) return; } catch (e) { /* not up yet */ }
      await new Promise(r => setTimeout(r, 3000));
    }
    throw new Error('no answer from the server after a minute');
  })) return finish();

  if (!await step('log in as the super user', async () => {
    must(EMAIL && PASSWORD, 'ADAPT_SU_EMAIL / ADAPT_SU_PASSWORD are not set in the container');
    const r = await call('POST', '/api/login', { email: EMAIL, password: PASSWORD });
    must(r.status === 200, `login returned ${r.status}: ${r.text.slice(0, 120)}`);
    const a = await call('GET', '/api/authcheck');
    must(a.json && a.json.isAuthenticated, 'not authenticated after login');
    tenantId = a.json.tenantId;
  })) return finish();

  await step('plugin list has the new plugins', async () => {
    const r = await call('GET', '/api/componenttype');
    must(r.status === 200 && Array.isArray(r.json), 'could not read component types');
    const names = r.json.map(c => c.name);
    textType = r.json.find(c => c.name === 'adapt-contrib-text');
    must(textType, 'Text component not installed');
    const want = ['adapt-component-h5p', 'adapt-component-slides'];
    const missing = want.filter(n => !names.includes(n));
    must(!missing.length, 'missing component(s): ' + missing.join(', '));
    const e = await call('GET', '/api/extensiontype');
    must(e.status === 200 && e.json.some(x => x.name === 'adapt-extension-rules'), 'Rules extension not installed');
    return `${names.length} components`;
  });

  if (!await step('create a throwaway course (page, article, block, text)', async () => {
    const c = await call('POST', '/api/content/course', { title: 'Selftest ' + new Date().toISOString() });
    must(c.status === 200 && c.json && c.json._id, `create course returned ${c.status}: ${c.text.slice(0, 160)}`);
    courseId = c.json._id;
    const make = async (type, body) => {
      const r = await call('POST', '/api/content/' + type, Object.assign({ _courseId: courseId }, body));
      must(r.status === 200 && r.json && r.json._id, `create ${type} returned ${r.status}: ${r.text.slice(0, 160)}`);
      return r.json._id;
    };
    const page = await make('contentobject', { _type: 'page', _parentId: courseId, title: 'Page 1' });
    const article = await make('article', { _type: 'article', _parentId: page, title: 'Article' });
    const block = await make('block', { _type: 'block', _parentId: article, title: 'Block' });
    await make('component', {
      _type: 'component', _parentId: block, _componentType: textType._id, _component: textType.component || 'text',
      _layout: 'full', title: 'Hello', displayTitle: 'Hello', body: '<p>Self-test body text.</p>', version: textType.version
    });
  })) return finish();

  const preview = async force => {
    const r = await call('GET', `/api/output/adapt/preview/${courseId}?force=${force}`);
    must(r.json && r.json.success, 'preview failed: ' + ((r.json && r.json.message) || r.text.slice(0, 200)));
  };
  const fetchPreview = async file => {
    const r = await fetch(`${BASE}/preview/${tenantId}/${courseId}/${file}`, { headers: { cookie } });
    return { status: r.status, text: await r.text() };
  };

  if (await step('preview builds (first time)', () => preview(true))) {
    await step('preview page and course settings load', async () => {
      const i = await fetchPreview('index.html');
      must(i.status === 200 && /adapt\.css/.test(i.text), 'index.html missing or has no stylesheet link');
      const c = await fetchPreview('course/config.json');
      must(c.status === 200, 'config.json status ' + c.status);
      const cfg = JSON.parse(c.text);
      must(cfg.screenSize && cfg.screenSize.large, 'config.json has no screenSize (framework defaults missing)');
    });
    await step('stylesheet is the Modern theme (navy)', async () => {
      const css = await fetchPreview('adapt.css');
      must(css.status === 200 && css.text.length > 20000, `adapt.css status ${css.status}, ${css.text.length} bytes`);
      must(/003e7e/i.test(css.text), 'brand navy #003E7E not found: the Modern theme is not applied');
      return `${Math.round(css.text.length / 1024)} KB`;
    });
    await step('second preview of an unchanged course still works', async () => {
      await preview(false);
      const c = await fetchPreview('course/config.json');
      must(JSON.parse(c.text).screenSize, 'config.json lost its screenSize on the second preview');
    });
    await step('accessibility check, including the browser pass', async () => {
      const q = await call('GET', `/api/output/adapt/accessibility/${courseId}?deep=true`);
      must(q.json && q.json.success, 'accessibility route failed: ' + ((q.json && q.json.message) || q.text.slice(0, 200)));
      const deep = q.json.payload.deep;
      must(deep && deep.ran, 'browser pass did not run: ' + (deep && deep.reason));
      must(deep.pagesChecked >= 1, 'browser checked no pages');
      return `${deep.pagesChecked} page(s) checked, ${q.json.payload.findings.length} content finding(s)`;
    });
  }

  const yauzl = require(fs.existsSync('/app/node_modules/yauzl') ? '/app/node_modules/yauzl' : 'yauzl');
  const listZip = file => new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true }, (err, zip) => {
    if (err) return reject(err);
    const names = [];
    zip.on('entry', e => { names.push(e.fileName); zip.readEntry(); });
    zip.on('end', () => resolve(names));
    zip.on('error', reject);
    zip.readEntry();
  }));
  for (const format of ['scorm', 'web']) {
    await step(`download ${format === 'scorm' ? 'SCORM' : 'Web'} package`, async () => {
      const r = await call('GET', `/api/output/adapt/publish/${courseId}?format=${format}`);
      must(r.json && r.json.success, 'publish failed: ' + ((r.json && r.json.message) || r.text.slice(0, 200)));
      const { zipName } = r.json.payload;
      must(zipName, 'no zip name returned');
      const d = await call('GET', `/download/${tenantId}/${courseId}/${zipName}/download.zip`, null, { raw: true });
      must(d.status === 200, 'download status ' + d.status);
      const file = path.join(os.tmpdir(), `selftest-${format}.zip`);
      fs.writeFileSync(file, Buffer.from(await d.arrayBuffer()));
      const names = await listZip(file);
      fs.unlinkSync(file);
      const hasManifest = names.includes('imsmanifest.xml');
      must(names.includes('index.html'), 'zip has no index.html');
      must(format === 'scorm' ? hasManifest : !hasManifest, format === 'scorm' ? 'SCORM zip has no imsmanifest.xml' : 'Web zip unexpectedly contains imsmanifest.xml');
      return `${zipName}.zip, ${names.length} files`;
    });
  }

  // PowerPoint import through the same web addresses the editor's "Import source" page uses
  let importedId;
  await step('import a PowerPoint (.pptx) as a Slides course', async () => {
    const sample = ['/app/scripts/pptx-import/test/sample.pptx', path.join(__dirname, 'pptx-import', 'test', 'sample.pptx')].find(f => fs.existsSync(f));
    must(sample, 'sample.pptx not found: run the update routine so the server has the latest files');
    const post = async (url, withFile) => {
      const form = new FormData();
      if (withFile) form.append('file', new Blob([fs.readFileSync(sample)]), 'Study skills deck.pptx');
      form.append('tags', '');
      form.append('formAssetFolders', '');
      const res = await fetch(BASE + url, { method: 'POST', headers: { cookie }, body: form });
      return { status: res.status, text: await res.text() };
    };
    const check = await post('/importsourcecheck', true);
    must(check.status === 200, `import check returned ${check.status}: ${check.text.slice(0, 200)}`);
    const done = await post('/importsource', false);
    must(done.status === 200, `import returned ${done.status}: ${done.text.slice(0, 200)}`);
    const list = await call('GET', '/api/content/course');
    must(list.status === 200 && Array.isArray(list.json), 'could not list courses');
    const imported = list.json.filter(c => c.title === 'Intro to Study Skills').pop();
    must(imported, 'the imported course is not in the course list');
    importedId = imported._id;
    return 'course "Intro to Study Skills" created';
  });
  if (importedId) {
    await step('the imported course previews, with its Slides component', async () => {
      const r = await call('GET', `/api/output/adapt/preview/${importedId}?force=true`);
      must(r.json && r.json.success, 'preview failed: ' + ((r.json && r.json.message) || r.text.slice(0, 200)));
      const i = await fetch(`${BASE}/preview/${tenantId}/${importedId}/index.html`, { headers: { cookie } });
      must(i.status === 200, 'preview index status ' + i.status);
      const c = await fetch(`${BASE}/preview/${tenantId}/${importedId}/course/en/components.json`, { headers: { cookie } });
      const comps = JSON.parse(await c.text());
      const slides = comps.find(x => x._component === 'slides');
      must(slides && slides._items && slides._items.length >= 2, 'no Slides component with slides in the imported course');
      return `${slides._items.length} slides`;
    });
    await step('remove the imported course', async () => {
      const r = await call('DELETE', `/api/content/course/${importedId}`);
      must(r.status === 200 || r.status === 204, 'delete returned ' + r.status);
    });
  }

  await step('H5P approvals list is available to the administrator', async () => {
    const r = await call('GET', '/api/h5papproval');
    const lists = r.json && (r.json.payload || r.json);
    must(r.status === 200 && lists && Array.isArray(lists.pending), `status ${r.status}: ${r.text.slice(0, 120)}`);
    return `${lists.pending.length} pending, ${lists.approved.length} approved`;
  });

  await step('clean up the throwaway course', async () => {
    const r = await call('DELETE', `/api/content/course/${courseId}`);
    must(r.status === 200 || r.status === 204, 'delete returned ' + r.status);
  });
  finish();
}

function finish() {
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch(e => { console.log('FAIL  unexpected error  -> ' + (e && e.stack || e)); process.exit(1); });
