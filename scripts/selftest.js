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
  let tenantId, courseId, textType, slidesType, h5pType, blockId;

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
    slidesType = r.json.find(c => c.name === 'adapt-component-slides');
    h5pType = r.json.find(c => c.name === 'adapt-component-h5p');
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
    blockId = block;
    await make('component', {
      _type: 'component', _parentId: block, _componentType: textType._id, _component: textType.component || 'text',
      _layout: 'full', title: 'Hello', displayTitle: 'Hello', body: '<p>Self-test body text.</p>', version: textType.version
    });
  })) return finish();

  // Import a PowerPoint into a Slides component (what the component's "Import PowerPoint" button calls)
  let slidesComponentId;
  await step('import a PowerPoint into a Slides component', async () => {
    const sample = ['/app/scripts/pptx-import/test/sample.pptx', path.join(__dirname, 'pptx-import', 'test', 'sample.pptx')].find(f => fs.existsSync(f));
    must(sample, 'sample.pptx not found: run the update routine so the server has the latest files');
    must(slidesType, 'Slides component is not installed');
    const made = await call('POST', '/api/content/component', {
      _courseId: courseId, _parentId: blockId, _type: 'component', _componentType: slidesType._id, _component: slidesType.component || 'slides',
      _layout: 'full', title: 'Deck', displayTitle: 'Deck', version: slidesType.version
    });
    must(made.status === 200 && made.json && made.json._id, `create Slides component returned ${made.status}: ${made.text.slice(0, 160)}`);
    slidesComponentId = made.json._id;
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(sample)]), 'Study skills deck.pptx');
    const res = await fetch(`${BASE}/api/content/component/${slidesComponentId}/pptx`, { method: 'POST', headers: { cookie }, body: form });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch (e) { /* reported below */ }
    must(res.status === 200 && json && json.success, `import returned ${res.status}: ${text.slice(0, 240)}`);
    must(json.payload.slides >= 3, 'fewer slides than expected: ' + json.payload.slides);
    return `${json.payload.slides} slides, ${json.payload.pictures} picture(s)`;
  });
  if (slidesComponentId) {
    await step('the imported slides are saved on the component', async () => {
      const r = await call('GET', `/api/content/component/${slidesComponentId}`);
      must(r.status === 200 && r.json, 'could not read the component back');
      const items = (r.json.properties && r.json.properties._items) || r.json._items;
      must(Array.isArray(items) && items.length >= 3, 'the component has no imported slides');
    });
  }

  // A deck with embedded video and audio, into a second Slides component
  let mediaComponentId;
  if (slidesComponentId) {
    await step('import a PowerPoint with video and audio into a Slides component', async () => {
      const sample = ['/app/scripts/pptx-import/test/sample-video.pptx', path.join(__dirname, 'pptx-import', 'test', 'sample-video.pptx')].find(f => fs.existsSync(f));
      must(sample, 'sample-video.pptx not found: run the update routine so the server has the latest files');
      const made = await call('POST', '/api/content/component', {
        _courseId: courseId, _parentId: blockId, _type: 'component', _componentType: slidesType._id, _component: slidesType.component || 'slides',
        _layout: 'full', title: 'Media deck', displayTitle: 'Media deck', version: slidesType.version
      });
      must(made.status === 200 && made.json && made.json._id, `create Slides component returned ${made.status}`);
      mediaComponentId = made.json._id;
      const form = new FormData();
      form.append('file', new Blob([fs.readFileSync(sample)]), 'Media deck.pptx');
      const res = await fetch(`${BASE}/api/content/component/${mediaComponentId}/pptx`, { method: 'POST', headers: { cookie }, body: form });
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch (e) { /* reported below */ }
      must(res.status === 200 && json && json.success, `import returned ${res.status}: ${text.slice(0, 240)}`);
      must(json.payload.media >= 2, `expected a video and an audio clip, got ${json.payload.media}`);
      return `${json.payload.slides} slides, ${json.payload.media} clip(s)`;
    });
  }

  const preview = async force => {
    const r = await call('GET', `/api/output/adapt/preview/${courseId}?force=${force}`);
    must(r.json && r.json.success, 'preview failed: ' + ((r.json && r.json.message) || r.text.slice(0, 200)));
  };
  // The preview server only serves a course's other files once index.html has been loaded in the same session, and
  // the session may not be saved yet when the next request arrives, so a 404 is retried briefly before it is believed.
  const previewGet = async (course, file) => {
    let r;
    for (let attempt = 0; attempt < 8; attempt++) {
      r = await fetch(`${BASE}/preview/${tenantId}/${course}/${file}`, { headers: { cookie } });
      if (r.status !== 404 || file === 'index.html') break;
      await r.arrayBuffer();
      await new Promise(resolve => setTimeout(resolve, 600));
    }
    return r;
  };
  const fetchPreview = async file => {
    const r = await previewGet(courseId, file);
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
    if (slidesComponentId) {
      await step('imported pictures are published with the course', async () => {
        const c = await fetchPreview('course/en/components.json');
        const comps = JSON.parse(c.text);
        const deck = comps.find(x => x._component === 'slides');
        must(deck && Array.isArray(deck._items) && deck._items.length >= 3, 'the Slides component has no slides in the build');
        const pictured = deck._items.filter(i => i._graphic && i._graphic.src);
        must(pictured.length >= 1, 'no slide kept its picture');
        for (const item of pictured) {
          const rel = item._graphic.src.replace(/^course\/assets\//, 'course/en/assets/');
          const img = await previewGet(courseId, rel);
          must(img.status === 200, `picture ${item._graphic.src} is not in the build (status ${img.status})`);
        }
        return `${pictured.length} picture(s) found`;
      });
    }
    if (mediaComponentId) {
      await step('imported video and audio are published and can be fetched', async () => {
        const c = await fetchPreview('course/en/components.json');
        const decks = JSON.parse(c.text).filter(x => x._component === 'slides');
        const items = decks.flatMap(d => d._items || []);
        const video = items.find(i => i._video && i._video.src);
        const audio = items.find(i => i._audio && i._audio.src);
        must(video, 'no slide kept its video');
        must(audio, 'no slide kept its audio');
        for (const src of [video._video.src, audio._audio.src]) {
          const rel = src.replace(/^course\/assets\//, 'course/en/assets/');
          const r = await previewGet(courseId, rel);
          must(r.status === 200, `${src} is not in the build (status ${r.status})`);
          must(Number(r.headers.get('content-length') || 1) > 0, `${src} is empty`);
        }
        return 'video and audio files found';
      });
    }
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
    if (slidesComponentId) {
      await step('replacing a deck shows the new deck in the very next preview', async () => {
        const sample = ['/app/scripts/pptx-import/test/sample-video.pptx', path.join(__dirname, 'pptx-import', 'test', 'sample-video.pptx')].find(f => fs.existsSync(f));
        must(sample, 'sample-video.pptx not found');
        const before = JSON.parse((await fetchPreview('course/en/components.json')).text).find(c => c._id === slidesComponentId);
        must(before && before._items.length === 6, 'expected the first deck (6 slides) in the preview before replacing it');
        const form = new FormData();
        form.append('file', new Blob([fs.readFileSync(sample)]), 'Second deck.pptx');
        const res = await fetch(`${BASE}/api/content/component/${slidesComponentId}/pptx`, { method: 'POST', headers: { cookie }, body: form });
        must(res.status === 200, `replacing the deck returned ${res.status}`);
        await preview(false); // an ordinary preview, no force
        const after = JSON.parse((await fetchPreview('course/en/components.json')).text).find(c => c._id === slidesComponentId);
        must(after && after._items.length === 4, `the preview still shows ${after ? after._items.length : 'no'} slides, expected the new deck's 4`);
        const config = JSON.parse((await fetchPreview('course/config.json')).text);
        must(config.screenSize, 'config.json lost its screenSize on that preview');
        return 'old deck replaced (6 slides -> 4)';
      });
    }
    await step('accessibility check, including the browser pass', async () => {
      const q = await call('GET', `/api/output/adapt/accessibility/${courseId}?deep=true`);
      must(q.json && q.json.success, 'accessibility route failed: ' + ((q.json && q.json.message) || q.text.slice(0, 200)));
      const deep = q.json.payload.deep;
      must(deep && deep.ran, 'browser pass did not run: ' + (deep && deep.reason));
      must(deep.pagesChecked >= 1, 'browser checked no pages');
      return `${deep.pagesChecked} page(s) checked, ${q.json.payload.findings.length} content finding(s)`;
    });
  }

  // H5P activity library: pick a ready-made activity for an H5P Player component (what the gallery's button calls)
  let h5pComponentId;
  await step('H5P activity library lists the activities and the libraries are installed', async () => {
    must(h5pType, 'H5P Player component is not installed');
    const made = await call('POST', '/api/content/component', {
      _courseId: courseId, _parentId: blockId, _type: 'component', _componentType: h5pType._id, _component: h5pType.component || 'h5pPlayer',
      _layout: 'full', title: 'Library activity', displayTitle: 'Library activity', version: h5pType.version
    });
    must(made.status === 200 && made.json && made.json._id, `create H5P component returned ${made.status}: ${made.text.slice(0, 160)}`);
    h5pComponentId = made.json._id;
    const list = await call('GET', `/api/content/component/${h5pComponentId}/h5plibrary`);
    must(list.status === 200 && list.json && list.json.success, `catalogue returned ${list.status}: ${list.text.slice(0, 160)}`);
    const all = list.json.payload;
    const available = all.filter(a => a.available);
    must(all.length >= 30, `only ${all.length} activities in the catalogue`);
    must(available.length === all.length, 'the H5P libraries are not installed on this server: run the update routine (docker compose exec adapt update.sh)');
    const thumb = await fetch(`${BASE}/api/content/component/${h5pComponentId}/h5plibrary/thumb/multiple-choice`, { headers: { cookie } });
    must(thumb.status === 200 && /image\/jpeg/.test(thumb.headers.get('content-type') || ''), `thumbnail returned ${thumb.status}`);
    return `${all.length} activities, all available`;
  });
  if (h5pComponentId) {
    await step('choosing "Multiple Choice" fills the component and approves it', async () => {
      const post = await call('POST', `/api/content/component/${h5pComponentId}/h5plibrary`, { activity: 'multiple-choice' });
      must(post.status === 200 && post.json && post.json.success, `add returned ${post.status}: ${post.text.slice(0, 240)}`);
      const r = await call('GET', `/api/content/component/${h5pComponentId}`);
      const props = (r.json && r.json.properties) || {};
      must(props._h5p && /^course\/assets\/.+\.h5p$/.test(props._h5p._src), 'the component has no H5P file: ' + JSON.stringify(props._h5p));
      must(props._setCompletionOn === 'completed', 'completion mode was not set to "completed"');
      await preview(true);
      const status = await fetchPreview(`h5p/${h5pComponentId}/status.json`);
      must(status.status === 200 && JSON.parse(status.text).status === 'approved', `activity is not approved in the build: ${status.status} ${status.text.slice(0, 80)}`);
      const lib = await fetchPreview(`h5p/${h5pComponentId}/H5P.MultiChoice-1.16/library.json`);
      must(lib.status === 200, 'the Multiple Choice library is missing from the build (status ' + lib.status + ')');
      const again = await call('POST', `/api/content/component/${h5pComponentId}/h5plibrary`, { activity: 'multiple-choice' });
      must(again.status === 200 && again.json.success, 'choosing the same activity twice failed: ' + again.text.slice(0, 160));
      return 'unpacked and approved';
    });
    // The H5P editor service: open the chosen activity in the editor, then take the (unchanged) activity back
    let editorUrl;
    await step('H5P editor: opens the chosen activity and serves the editor page', async () => {
      const start = await call('POST', `/api/content/component/${h5pComponentId}/h5peditor/start`, { mode: 'edit', returnTo: '/' });
      must(start.status !== 503, 'the H5P editor service is not running or not set up: ' + ((start.json && start.json.message) || start.text.slice(0, 160)) + ' (run: docker compose up -d --build)');
      must(start.status === 200 && start.json && start.json.success, `start returned ${start.status}: ${start.text.slice(0, 200)}`);
      editorUrl = start.json.payload.url;
      must(/^\/h5p-editor\/edit\//.test(editorUrl), 'unexpected editor address ' + editorUrl);
      const page = await call('GET', editorUrl);
      must(page.status === 200 && /H5PIntegration/.test(page.text) && /adapt-h5p-save/.test(page.text), `editor page returned ${page.status}: ${page.text.slice(0, 160)}`);
      const types = await call('GET', '/h5p-editor/ajax?action=content-type-cache');
      must(types.status === 200 && types.json && Array.isArray(types.json.libraries), `editor content type list returned ${types.status}: ${types.text.slice(0, 160)}`);
      must(types.json.libraries.length >= 30, `the editor lists only ${types.json.libraries.length} content types: its libraries may still be installing (docker compose logs h5p-editor)`);
      return `editor page served; ${types.json.libraries.length} content types to create from`;
    });
    if (editorUrl) {
      await step('H5P editor: the editor is closed to anyone without an editor session', async () => {
        const anon = await fetch(`${BASE}${editorUrl}`, { redirect: 'manual' });
        must(anon.status === 403, 'expected 403 without a login, got ' + anon.status);
      });
      await step('H5P editor: finishing hands the activity back to the component', async () => {
        const contentId = (editorUrl.match(/\/edit\/([\w-]+)/) || [])[1];
        const before = await call('GET', `/api/content/component/${h5pComponentId}`);
        const srcBefore = before.json.properties._h5p._src;
        const done = await call('POST', `/api/content/component/${h5pComponentId}/h5peditor/finish`, { contentId });
        must(done.status === 200 && done.json && done.json.success, `finish returned ${done.status}: ${done.text.slice(0, 240)}`);
        const after = await call('GET', `/api/content/component/${h5pComponentId}`);
        must(/^course\/assets\/.+\.h5p$/.test(after.json.properties._h5p._src), 'the component lost its activity');
        await preview(true);
        const status = await fetchPreview(`h5p/${h5pComponentId}/status.json`);
        must(status.status === 200 && JSON.parse(status.text).status === 'approved', `the edited activity is not approved in the build: ${status.status} ${status.text.slice(0, 80)}`);
        return srcBefore === after.json.properties._h5p._src ? 'same file (nothing was changed)' : 'new file attached and approved';
      });
    }
    await step('a made-up activity name is refused', async () => {
      const r = await call('POST', `/api/content/component/${h5pComponentId}/h5plibrary`, { activity: '../../etc/passwd' });
      must(r.status === 404, 'expected 404, got ' + r.status);
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
      const c = await previewGet(importedId, 'course/en/components.json');
      const body = await c.text();
      let comps;
      try { comps = JSON.parse(body); } catch (e) {
        let disk = '';
        try { disk = require('child_process').execSync('df -k /app 2>/dev/null | tail -1', { encoding: 'utf8' }).trim(); } catch (e2) { /* not available */ }
        const dirs = await previewGet(importedId, 'course/config.json');
        throw new Error(`components.json came back unreadable: status ${c.status}, type ${c.headers.get('content-type')}, ${body.length} bytes, starts "${body.slice(0, 80)}"; config.json status ${dirs.status}; disk: ${disk || 'unknown'}`);
      }
      const slides = comps.find(x => x._component === 'slides');
      must(slides && slides._items && slides._items.length >= 2, 'no Slides component with slides in the imported course');
      return `${slides._items.length} slides`;
    });
    await step('remove the imported course', async () => {
      const r = await call('DELETE', `/api/content/course/${importedId}`);
      must(r.status === 200 || r.status === 204, 'delete returned ' + r.status);
    });
  }

  // The screen recorder's upload route: a small generated video goes in as WebM and must come out as an MP4 asset
  await step('screen recorder: a WebM recording is converted to MP4 and added to the asset library', async () => {
    const ffmpegBinary = (() => { for (const base of ['/app/node_modules', path.join(__dirname, '..', 'node_modules')]) { try { const m = require(path.join(base, 'ffmpeg-static')); return typeof m === 'string' ? m : m.path; } catch (e) { /* try the next place */ } } return null; })();
    must(ffmpegBinary, 'ffmpeg is not installed with the authoring tool');
    const file = path.join(os.tmpdir(), 'selftest-recording.webm');
    const made = require('child_process').spawnSync(ffmpegBinary, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '1', '-c:v', 'libvpx', '-c:a', 'libopus', file]);
    must(made.status === 0, 'could not make a test video: ' + String(made.stderr).slice(0, 160));
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(file)], { type: 'video/webm' }), 'recording.webm');
    form.append('title', 'Selftest recording');
    form.append('description', 'Made by the self-test');
    const res = await fetch(`${BASE}/api/asset/recording`, { method: 'POST', headers: { cookie }, body: form });
    const text = await res.text();
    fs.unlinkSync(file);
    let json; try { json = JSON.parse(text); } catch (e) { /* reported below */ }
    must(res.status === 200 && json && json.success, `recording upload returned ${res.status}: ${text.slice(0, 240)}`);
    must(/\.mp4$/.test(json.payload.filename), 'the stored file is not an MP4: ' + json.payload.filename);
    const served = await fetch(`${BASE}/api/asset/serve/${json.payload._id}`, { headers: { cookie } });
    must(served.status === 200 && /video\/mp4/.test(served.headers.get('content-type') || ''), `the asset is served as ${served.headers.get('content-type')} (status ${served.status})`);
    await call('PUT', `/api/asset/trash/${json.payload._id}`); // tidy up; the file stays in the trash like any deleted asset
    return `stored as ${json.payload.filename}`;
  });

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
