// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Pure helpers for the screen recorder (no DOM, no Origin) so they can be unit tested.
 */
define(function() {
  var MIME_PREFERENCE = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/webm',
    'video/mp4'
  ];

  /**
   * Why this browser cannot record the screen, as a string key, or null when it can. Browsers only offer screen capture
   * on secure (https) addresses (and localhost), so a plain http server address gets its own explanation.
   * @param {{isSecureContext: boolean, MediaRecorder: *, navigator: {mediaDevices: *}}} env
   */
  function unsupportedReason(env) {
    if (!env.isSecureContext) return 'insecure';
    var devices = env.navigator && env.navigator.mediaDevices;
    if (!devices || typeof devices.getDisplayMedia !== 'function' || typeof env.MediaRecorder === 'undefined') return 'browser';
    return null;
  }

  /** First recording format the browser's MediaRecorder supports (empty string lets it choose). */
  function pickMimeType(MediaRecorder) {
    if (!MediaRecorder || typeof MediaRecorder.isTypeSupported !== 'function') return '';
    for (var i = 0; i < MIME_PREFERENCE.length; i++) {
      if (MediaRecorder.isTypeSupported(MIME_PREFERENCE[i])) return MIME_PREFERENCE[i];
    }
    return '';
  }

  /** 65000 -> "1:05"; 3725000 -> "1:02:05" */
  function formatDuration(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var two = function(n) { return (n < 10 ? '0' : '') + n; };
    return (h ? h + ':' + two(m) : m) + ':' + two(s);
  }

  /** "Screen recording 2026-10-09 17:30" */
  function defaultTitle(date, prefix) {
    var pad = function(n) { return (n < 10 ? '0' : '') + n; };
    return (prefix || 'Screen recording') + ' ' + date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  /** File extension for a recorded blob's type. */
  function extensionFor(type) {
    return /mp4/.test(type || '') ? 'mp4' : 'webm';
  }

  return { unsupportedReason: unsupportedReason, pickMimeType: pickMimeType, formatDuration: formatDuration, defaultTitle: defaultTitle, extensionFor: extensionFor };
});
