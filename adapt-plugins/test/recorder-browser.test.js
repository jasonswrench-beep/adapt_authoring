// The recorder dialog, driven in a real Chromium: open it, record a pretend screen (with the fake microphone mixed in),
// stop, watch it back, name it and save; the upload goes through the real route and real ffmpeg. Skipped when Chromium
// or ffmpeg is not available.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium';
let ffmpeg = null;
try { const m = require('ffmpeg-static'); ffmpeg = typeof m === 'string' ? m : m.path; } catch (e) { /* skipped below */ }
let playwright = null;
try { playwright = require(require.resolve('playwright-core', { paths: [path.join(ROOT, 'scripts', 'a11y-check')] })); } catch (e) { /* skipped below */ }
const skip = !fs.existsSync(CHROME) ? 'Chromium not found' : !ffmpeg || !fs.existsSync(ffmpeg) ? 'ffmpeg-static not installed' : !playwright ? 'playwright-core not installed' : false;

const FE = path.join(ROOT, 'frontend', 'src');
const lang = fs.readJsonSync(path.join(ROOT, 'routes', 'lang', 'en.json'));
const HARNESS = `<!doctype html><html><head><meta charset="utf-8"><title>harness</title></head><body>
<button id="open">Record your screen</button>
<script src="/libs/jquery.js"></script><script src="/libs/underscore.js"></script>
<script>
(async function () {
  var lang = await (await fetch('/lang.json')).json();
  window.__alerts = [];
  var origin = {
    l10n: { t: function (key, o) { var s = lang[key] || key; if (o) Object.keys(o).forEach(function (k) { s = s.replace('%{' + k + '}', o[k]); }); return s; } },
    Notify: { alert: function (o) { window.__alerts.push(o); } }
  };
  var modules = { jquery: window.jQuery, underscore: window._, 'core/origin': origin };
  async function load(url, name) {
    var code = await (await fetch(url)).text();
    var result;
    new Function('define', code)(function (factory) { result = factory(function (id) { if (!(id in modules)) throw new Error('unknown module ' + id); return modules[id]; }); });
    modules[name] = result;
  }
  await load('/recorderCore.js', '../recorderCore');
  await load('/recorder.js', 'recorder');
  document.getElementById('open').addEventListener('click', function (e) { modules.recorder.open(e.currentTarget); });
  window.__ready = true;
})();
</script></body></html>`;

/** A pretend screen: a moving canvas, plus a quiet tone as "computer sound". */
const PRETEND_SCREEN = `
navigator.mediaDevices.getDisplayMedia = async function () {
  var canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
  var ctx = canvas.getContext('2d'); var n = 0;
  setInterval(function () { ctx.fillStyle = 'hsl(' + (n * 7 % 360) + ',70%,50%)'; ctx.fillRect(0, 0, 640, 360); ctx.fillStyle = '#fff'; ctx.font = '40px sans-serif'; ctx.fillText('frame ' + n++, 40, 180); }, 50);
  var stream = canvas.captureStream(20);
  var audio = new AudioContext(); var osc = audio.createOscillator(); var dest = audio.createMediaStreamDestination(); osc.connect(dest); osc.start();
  dest.stream.getAudioTracks().forEach(function (t) { stream.addTrack(t); });
  return stream;
};`;

async function serve() {
  const express = require('express');
  const stored = [];
  const app = { usermanager: { getCurrentUser: () => ({ _id: 'u1' }) }, configuration: { getConfig: key => (key === 'maxFileUploadSize' ? '100MB' : undefined) } };
  const helpers = { importAsset: (meta, md, cb) => { const keep = path.join(os.tmpdir(), `kept-${meta.filename}`); fs.copySync(meta.path, keep); stored.push(Object.assign({}, meta, { kept: keep })); md.idMap[meta.oldId] = 'asset1'; md.assetNameMap.asset1 = meta.filename; cb(); } };
  const server = express();
  server.get('/', (req, res) => res.type('html').send(HARNESS));
  server.get('/lang.json', (req, res) => res.json(lang));
  server.get('/libs/jquery.js', (req, res) => res.sendFile(path.join(FE, 'libraries', 'jquery.js')));
  server.get('/libs/underscore.js', (req, res) => res.sendFile(path.join(FE, 'libraries', 'underscore.js')));
  server.get('/recorderCore.js', (req, res) => res.sendFile(path.join(FE, 'modules', 'assetManagement', 'recorderCore.js')));
  server.get('/recorder.js', (req, res) => res.sendFile(path.join(FE, 'modules', 'assetManagement', 'views', 'assetManagementRecorder.js')));
  server.post('/api/asset/recording', require('../../plugins/output/adapt/recordingRoutes')(app, helpers));
  const listener = await new Promise(resolve => { const s = server.listen(0, '127.0.0.1', () => resolve(s)); });
  return { url: `http://127.0.0.1:${listener.address().port}/`, stored, close: () => listener.close() };
}

async function open(browser, url, { insecure = false, screen = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, permissions: ['microphone'] });
  if (insecure) await context.addInitScript('Object.defineProperty(window, "isSecureContext", { value: false });');
  if (screen) await context.addInitScript(PRETEND_SCREEN);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction('window.__ready === true');
  return { page, errors, context };
}

test('record, stop, review, save: the recording reaches the asset library as an MP4 with picture and sound', { skip, timeout: 120000 }, async () => {
  const s = await serve();
  const browser = await playwright.chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const { page, errors } = await open(browser, s.url);
    await page.click('#open');
    await page.waitForSelector('.recorder .recorder-start');
    assert.strictEqual(await page.isChecked('#recorder-mic'), true, 'the microphone is on by default');
    assert.strictEqual(await page.evaluate(() => document.activeElement && document.activeElement.className), 'action-primary recorder-start', 'focus starts on the main button');

    await page.click('.recorder-start');
    await page.waitForSelector('.recorder-stop');
    assert.match(await page.textContent('.recorder-status'), /Recording/);
    await page.waitForTimeout(1500);
    await page.click('.recorder-pause');
    assert.match(await page.textContent('.recorder-status'), /Paused/);
    await page.click('.recorder-pause');
    await page.waitForTimeout(1500);
    // Escape while recording asks first; saying no keeps the recording
    page.once('dialog', d => d.dismiss());
    await page.keyboard.press('Escape');
    assert.ok(await page.$('.recorder-stop'), 'still recording after declining to discard');
    assert.notStrictEqual(await page.textContent('.recorder-time'), '0:00', 'the clock moves');
    await page.click('.recorder-stop');

    await page.waitForSelector('video.recorder-preview', { timeout: 20000 });
    assert.ok((await page.getAttribute('video.recorder-preview', 'src')).startsWith('blob:'));
    assert.match(await page.inputValue('#recorder-name'), /^Screen recording \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    await page.fill('#recorder-name', 'Using the course tool');
    await page.fill('#recorder-description', 'The author opens the asset library and records a demo.');
    await page.click('.recorder-save');
    await page.waitForFunction('window.__alerts.length === 1', null, { timeout: 60000 });
    assert.strictEqual(await page.evaluate(() => window.__alerts[0].type), 'success');
    assert.strictEqual(await page.$('.recorder'), null, 'the dialog closes after saving');

    assert.strictEqual(s.stored.length, 1);
    const a = s.stored[0];
    assert.strictEqual(a.title, 'Using the course tool');
    assert.strictEqual(a.description, 'The author opens the asset library and records a demo.');
    assert.strictEqual(a.type, 'video/mp4');
    const info = spawnSync(ffmpeg, ['-hide_banner', '-i', a.kept], { encoding: 'utf8' }).stderr;
    assert.match(info, /Video: h264/);
    assert.match(info, /Audio: aac/);
    assert.match(info, /Duration: 00:00:0[2-9]/, 'about three seconds were recorded');
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); s.close(); }
});

test('the recorder says why it cannot work on a plain http address, and offers no Start button', { skip, timeout: 60000 }, async () => {
  const s = await serve();
  const browser = await playwright.chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { page } = await open(browser, s.url, { insecure: true });
    await page.click('#open');
    await page.waitForSelector('.recorder-unsupported');
    assert.match(await page.textContent('.recorder-unsupported'), /secure \(https\) address/);
    assert.strictEqual(await page.$('.recorder-start'), null);
    assert.match(await page.textContent('.recorder-polish'), /Recordly/);
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.$('.recorder'), null, 'Escape closes it when nothing is being recorded');
  } finally { await browser.close(); s.close(); }
});

test('declining the browser\'s screen picker leaves the recorder ready to try again', { skip, timeout: 60000 }, async () => {
  const s = await serve();
  const browser = await playwright.chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { page } = await open(browser, s.url, { screen: false });
    await page.evaluate(() => { navigator.mediaDevices.getDisplayMedia = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })); });
    await page.click('#open');
    await page.click('.recorder-start');
    await page.waitForFunction(() => /nothing was recorded/.test(document.querySelector('.recorder-status').textContent));
    assert.strictEqual(await page.isEnabled('.recorder-start'), true);
  } finally { await browser.close(); s.close(); }
});
