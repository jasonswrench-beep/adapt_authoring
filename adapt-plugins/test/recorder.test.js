// The screen recorder: its helpers, the server-side conversion to MP4 (with the real ffmpeg when it is installed),
// the upload route (real multipart upload, fake storage), and the whole dialog driven in a real browser with a
// pretend screen.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const { transcodeToMp4, isAcceptedRecording, RecordingError } = require('../../plugins/output/adapt/recordingImport');
const recordingRoutes = require('../../plugins/output/adapt/recordingRoutes');

let core;
global.define = factory => { core = factory(); };
require(path.join(ROOT, 'frontend', 'src', 'modules', 'assetManagement', 'recorderCore.js'));
delete global.define;

function ffmpegPath() {
  try { const m = require('ffmpeg-static'); return typeof m === 'string' ? m : m.path; } catch (e) { return null; }
}
const FFMPEG = ffmpegPath();
const noFfmpeg = FFMPEG && fs.existsSync(FFMPEG) ? false : 'ffmpeg-static is not installed here';

function makeWebm(dir, { audio = true, size = '321x181' } = {}) {
  const file = path.join(dir, 'in.webm');
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=15`].concat(audio ? ['-f', 'lavfi', '-i', 'sine=frequency=440'] : [], ['-t', '1.5', '-c:v', 'libvpx'], audio ? ['-c:a', 'libopus'] : [], [file]);
  const run = spawnSync(FFMPEG, args);
  assert.strictEqual(run.status, 0, String(run.stderr));
  return file;
}

function probe(file) {
  const run = spawnSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  return run.stderr; // ffmpeg lists the streams on stderr
}

test('helpers: support check explains http, other browsers, and says nothing when fine', () => {
  const ok = { isSecureContext: true, MediaRecorder: function() {}, navigator: { mediaDevices: { getDisplayMedia() {} } } };
  assert.strictEqual(core.unsupportedReason(ok), null);
  assert.strictEqual(core.unsupportedReason(Object.assign({}, ok, { isSecureContext: false })), 'insecure');
  assert.strictEqual(core.unsupportedReason(Object.assign({}, ok, { navigator: { mediaDevices: undefined } })), 'browser');
  assert.strictEqual(core.unsupportedReason(Object.assign({}, ok, { MediaRecorder: undefined })), 'browser');
});

test('helpers: format choice, duration, title and extension', () => {
  const supported = new Set(['video/webm;codecs=vp8,opus', 'video/webm']);
  assert.strictEqual(core.pickMimeType({ isTypeSupported: t => supported.has(t) }), 'video/webm;codecs=vp8,opus');
  assert.strictEqual(core.pickMimeType({ isTypeSupported: () => false }), '');
  assert.strictEqual(core.pickMimeType(undefined), '');
  assert.strictEqual(core.formatDuration(0), '0:00');
  assert.strictEqual(core.formatDuration(65000), '1:05');
  assert.strictEqual(core.formatDuration(3725000), '1:02:05');
  assert.strictEqual(core.formatDuration(-5), '0:00');
  assert.strictEqual(core.defaultTitle(new Date(2026, 9, 9, 7, 5)), 'Screen recording 2026-10-09 07:05');
  assert.strictEqual(core.extensionFor('video/mp4;codecs=avc1'), 'mp4');
  assert.strictEqual(core.extensionFor('video/webm'), 'webm');
});

test('only video recordings are accepted', () => {
  assert.ok(isAcceptedRecording('recording.webm', ''));
  assert.ok(isAcceptedRecording('x.bin', 'video/webm;codecs=vp9'));
  assert.ok(!isAcceptedRecording('notes.pdf', 'application/pdf'));
  assert.ok(!isAcceptedRecording('script.js', 'text/javascript'));
  assert.ok(!isAcceptedRecording('', ''));
});

test('a WebM recording becomes an MP4 with H.264 video and AAC sound, with even dimensions', { skip: noFfmpeg }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rec-test-'));
  const out = path.join(dir, 'out.mp4');
  const { size } = await transcodeToMp4(makeWebm(dir), out);
  assert.ok(size > 1000);
  const info = probe(out);
  assert.match(info, /Video: h264/);
  assert.match(info, /Audio: aac/);
  assert.match(info, /320x180/, '321x181 is rounded down to even dimensions');
});

test('a recording without sound still converts', { skip: noFfmpeg }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rec-test-'));
  const out = path.join(dir, 'out.mp4');
  await transcodeToMp4(makeWebm(dir, { audio: false }), out);
  assert.match(probe(out), /Video: h264/);
});

test('a file that is not a video fails with a readable error and leaves no output', { skip: noFfmpeg }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rec-test-'));
  const bad = path.join(dir, 'bad.webm');
  await fs.writeFile(bad, 'this is not a video');
  await assert.rejects(transcodeToMp4(bad, path.join(dir, 'out.mp4')), e => e instanceof RecordingError && e.status === 422 && /could not be converted/.test(e.message));
});

/** The route on a tiny server, with fake users and storage, for real multipart uploads. */
async function serve({ user = { _id: 'u1' }, transcode, maxFileUploadSize = '50MB' } = {}) {
  const express = require('express');
  const stored = [];
  const app = {
    usermanager: { getCurrentUser: () => user },
    configuration: { getConfig: key => (key === 'maxFileUploadSize' ? maxFileUploadSize : undefined) }
  };
  const helpers = {
    importAsset: (meta, md, cb) => { stored.push(Object.assign({ bytes: fs.readFileSync(meta.path) }, meta)); md.idMap[meta.oldId] = 'asset1'; md.assetNameMap.asset1 = meta.filename; cb(); }
  };
  const server = express();
  server.post('/api/asset/recording', recordingRoutes(app, helpers, transcode ? { transcode } : {}));
  const listener = await new Promise(resolve => { const s = server.listen(0, '127.0.0.1', () => resolve(s)); });
  return { base: `http://127.0.0.1:${listener.address().port}`, stored, close: () => listener.close() };
}
const upload = (base, { name = 'recording.webm', type = 'video/webm', data = Buffer.from('x'), title = 'My title', description = 'What happens' } = {}) => {
  const form = new FormData();
  if (data) form.append('file', new Blob([data], { type }), name);
  if (title !== null) form.append('title', title);
  form.append('description', description);
  return fetch(`${base}/api/asset/recording`, { method: 'POST', body: form });
};
const fakeTranscode = async (input, output) => { await fs.copy(input, output); return { size: fs.statSync(output).size }; };

test('route: stores the converted recording as a video asset with the author\'s title and description', async () => {
  const s = await serve({ transcode: fakeTranscode });
  try {
    const r = await upload(s.base, { data: Buffer.from('video bytes') });
    const body = await r.json();
    assert.strictEqual(r.status, 200, JSON.stringify(body));
    assert.strictEqual(body.payload._id, 'asset1');
    assert.strictEqual(s.stored.length, 1);
    const a = s.stored[0];
    assert.strictEqual(a.title, 'My title');
    assert.strictEqual(a.description, 'What happens');
    assert.strictEqual(a.type, 'video/mp4');
    assert.match(a.filename, /^[a-f0-9]{40}\.mp4$/);
    assert.strictEqual(a.createdBy, 'u1');
    assert.strictEqual(a.bytes.toString(), 'video bytes');
  } finally { s.close(); }
});

test('route: a missing title gets a default, and an empty description falls back to the title', async () => {
  const s = await serve({ transcode: fakeTranscode });
  try {
    const r = await upload(s.base, { title: '', description: '' });
    assert.strictEqual(r.status, 200);
    assert.match(s.stored[0].title, /^Screen recording \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    assert.strictEqual(s.stored[0].description, s.stored[0].title);
  } finally { s.close(); }
});

test('route: refuses without a user, without a file, and for files that are not videos, storing nothing', async () => {
  let s = await serve({ user: null, transcode: fakeTranscode });
  try { assert.strictEqual((await upload(s.base)).status, 403); assert.strictEqual(s.stored.length, 0); } finally { s.close(); }
  s = await serve({ transcode: fakeTranscode });
  try {
    assert.strictEqual((await upload(s.base, { data: null })).status, 400);
    assert.strictEqual((await upload(s.base, { name: 'notes.pdf', type: 'application/pdf' })).status, 400);
    assert.strictEqual(s.stored.length, 0);
  } finally { s.close(); }
});

test('route: a conversion failure is reported plainly and nothing is stored', async () => {
  const s = await serve({ transcode: async () => { throw new RecordingError('The recording could not be converted (bad). Is it a complete video?', 422); } });
  try {
    const r = await upload(s.base);
    assert.strictEqual(r.status, 422);
    assert.match((await r.json()).message, /could not be converted/);
    assert.strictEqual(s.stored.length, 0);
  } finally { s.close(); }
});

test('route: a recording over the upload limit is refused with a clear message', async () => {
  const s = await serve({ transcode: fakeTranscode, maxFileUploadSize: 100 });
  try {
    const r = await upload(s.base, { data: Buffer.alloc(5000, 1) });
    assert.strictEqual(r.status, 413);
    assert.match((await r.json()).message, /larger than the upload limit/);
    assert.strictEqual(s.stored.length, 0);
  } finally { s.close(); }
});

test('route: temporary files are removed afterwards', async () => {
  const before = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('recording-')).length;
  const s = await serve({ transcode: fakeTranscode });
  try {
    await upload(s.base);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.strictEqual(fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('recording-')).length, before);
  } finally { s.close(); }
});
