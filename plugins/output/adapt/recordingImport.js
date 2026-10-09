// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Screen recordings made in the browser (the editor's recorder) arrive as WebM, which Safari and iPhones cannot play.
 * This converts them to MP4 (H.264 video, AAC audio) so a course plays everywhere, using the ffmpeg that ships with
 * the authoring tool. Kept free of app dependencies so it can be unit tested.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ACCEPTED_EXTENSIONS = new Set(['.webm', '.mp4', '.mkv', '.mov']);
const ACCEPTED_TYPES = /^video\/(webm|mp4|x-matroska|quicktime)(;|$)/i;

class RecordingError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 400;
  }
}

/** True when an uploaded file looks like a video recording (by file name or declared type). */
function isAcceptedRecording(name, type) {
  return ACCEPTED_EXTENSIONS.has(path.extname(String(name || '')).toLowerCase()) || ACCEPTED_TYPES.test(String(type || ''));
}

/** ffmpeg arguments: even dimensions (H.264 needs them), at most 1080 lines tall, fast start for streaming. */
function ffmpegArgs(input, output) {
  return [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    '-vf', 'scale=min(iw\\,1920):min(ih\\,1080):force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-movflags', '+faststart', output
  ];
}

/**
 * @param {string} input - the recording (WebM or similar)
 * @param {string} output - where the MP4 is written
 * @param {{ffmpegPath?: string, timeoutMs?: number}} [options]
 * @returns {Promise<{size: number}>}
 */
function transcodeToMp4(input, output, options = {}) {
  const bundled = options.ffmpegPath ? null : require('ffmpeg-static'); // older releases export an object with .path, newer ones the path
  const ffmpegPath = options.ffmpegPath || (typeof bundled === 'string' ? bundled : bundled.path);
  const timeoutMs = options.timeoutMs || 10 * 60 * 1000;
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ffmpegArgs(input, output), { stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = '';
    child.stderr.on('data', chunk => { if (errors.length < 4000) errors += chunk; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new RecordingError('Converting the recording took too long. Try a shorter recording.', 413)); }, timeoutMs);
    child.on('error', error => { clearTimeout(timer); reject(new RecordingError(`The video converter could not start: ${error.message}`, 500)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new RecordingError(`The recording could not be converted (${errors.trim().split('\n').slice(-1)[0] || 'unknown error'}). Is it a complete video?`, 422));
      let size = 0;
      try { size = fs.statSync(output).size; } catch (e) { /* reported below */ }
      if (!size) return reject(new RecordingError('The recording was empty.', 422));
      resolve({ size });
    });
  });
}

module.exports = { transcodeToMp4, isAcceptedRecording, ffmpegArgs, RecordingError };
