// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * The screen recorder: a dialog in which an author records their screen (and optionally microphone) with the browser's
 * own screen capture, reviews the recording, and saves it to the asset library. The server converts it to MP4.
 * All text from the user is escaped before it is put on the page.
 */
define(function(require) {
  var $ = require('jquery');
  var _ = require('underscore');
  var Origin = require('core/origin');
  var Core = require('../recorderCore');

  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function t(key, options) { return Origin.l10n.t(key, options); }

  function open(trigger) {
    var reason = Core.unsupportedReason({ isSecureContext: window.isSecureContext, MediaRecorder: window.MediaRecorder, navigator: window.navigator });
    var state = { phase: 'idle', stream: null, parts: [], recorder: null, started: 0, elapsed: 0, timer: null, blob: null, previewUrl: null, audioContext: null, extraStreams: [] };

    var $overlay = $('<div class="recorder-overlay"></div>');
    var $dialog = $(
      '<div class="recorder" role="dialog" aria-modal="true" aria-labelledby="recorder-title">' +
        '<div class="recorder-header"><h2 id="recorder-title">' + _.escape(t('app.recordertitle')) + '</h2>' +
        '<button type="button" class="recorder-close" aria-label="' + _.escape(t('app.recorderclose')) + '">&times;</button></div>' +
        '<p class="recorder-status" role="status" aria-live="polite"></p>' +
        '<div class="recorder-body"></div>' +
      '</div>'
    );
    $overlay.append($dialog);
    $('body').append($overlay);

    function setStatus(text) { $dialog.find('.recorder-status').text(text || ''); }

    function stopTracks() {
      if (state.stream) state.stream.getTracks().forEach(function(track) { track.onended = null; track.stop(); });
      state.extraStreams.forEach(function(s) { s.getTracks().forEach(function(track) { track.stop(); }); });
      state.extraStreams = [];
      if (state.audioContext) { try { state.audioContext.close(); } catch (e) { /* already closed */ } state.audioContext = null; }
      state.stream = null;
    }

    function cleanup() {
      window.clearInterval(state.timer);
      stopTracks();
      if (state.recorder && state.recorder.state !== 'inactive') { try { state.recorder.stop(); } catch (e) { /* already stopped */ } }
      if (state.previewUrl) { URL.revokeObjectURL(state.previewUrl); state.previewUrl = null; }
    }

    function close(force) {
      if (!force && (state.phase === 'recording' || state.phase === 'paused' || state.phase === 'review')) {
        if (!window.confirm(t('app.recorderdiscardconfirm'))) return;
      }
      $(document).off('keydown.recorder');
      cleanup();
      $overlay.remove();
      if (trigger) $(trigger).trigger('focus');
    }

    function render() {
      var $body = $dialog.find('.recorder-body').empty();
      if (reason) {
        $body.append($('<p class="recorder-unsupported"></p>').text(t(reason === 'insecure' ? 'app.recorderinsecure' : 'app.recorderbrowser')));
        $body.append(helpHtml());
        return;
      }
      if (state.phase === 'idle') {
        $body.append(
          '<p>' + _.escape(t('app.recorderintro')) + '</p>' +
          '<p class="recorder-privacy">' + _.escape(t('app.recorderprivacy')) + '</p>' +
          '<label class="recorder-mic"><input type="checkbox" id="recorder-mic" checked> ' + _.escape(t('app.recordermic')) + '</label>' +
          '<div class="recorder-actions"><button type="button" class="action-primary recorder-start">' + _.escape(t('app.recorderstart')) + '</button></div>'
        );
        $body.append(helpHtml());
      } else if (state.phase === 'recording' || state.phase === 'paused') {
        $body.append(
          '<p class="recorder-clock" aria-hidden="true"><span class="recorder-dot"></span> <span class="recorder-time">0:00</span></p>' +
          '<div class="recorder-actions">' +
            '<button type="button" class="action-secondary recorder-pause"></button> ' +
            '<button type="button" class="action-primary recorder-stop">' + _.escape(t('app.recorderstop')) + '</button>' +
          '</div>'
        );
        updateRecordingUi();
      } else if (state.phase === 'review' || state.phase === 'saving') {
        var $video = $('<video class="recorder-preview" controls playsinline></video>').attr('src', state.previewUrl).attr('aria-label', t('app.recorderpreview'));
        $body.append($video);
        $body.append(
          '<div class="recorder-field"><label for="recorder-name">' + _.escape(t('app.recordername')) + '</label>' +
          '<input type="text" id="recorder-name" maxlength="200"></div>' +
          '<div class="recorder-field"><label for="recorder-description">' + _.escape(t('app.recorderdescription')) + '</label>' +
          '<textarea id="recorder-description" rows="4" maxlength="2000"></textarea>' +
          '<p class="recorder-hint">' + _.escape(t('app.recorderdescriptionhelp')) + '</p></div>' +
          '<div class="recorder-actions">' +
            '<button type="button" class="action-primary recorder-save">' + _.escape(t('app.recordersave')) + '</button> ' +
            '<button type="button" class="action-secondary recorder-again">' + _.escape(t('app.recorderagain')) + '</button> ' +
            '<button type="button" class="action-secondary recorder-discard">' + _.escape(t('app.recorderdiscard')) + '</button>' +
          '</div>'
        );
        $body.find('#recorder-name').val(Core.defaultTitle(new Date(), t('app.recorderdefaulttitle')));
        $body.find('.recorder-save, .recorder-again, .recorder-discard, #recorder-name, #recorder-description').prop('disabled', state.phase === 'saving');
      }
    }

    function helpHtml() {
      return $('<p class="recorder-polish"></p>').html(
        _.escape(t('app.recorderpolish')) + ' <a href="https://www.recordly.dev" target="_blank" rel="noopener noreferrer">' + _.escape(t('app.recorderpolishlink')) + '</a>'
      );
    }

    function updateRecordingUi() {
      var paused = state.phase === 'paused';
      $dialog.find('.recorder-pause').text(t(paused ? 'app.recorderresume' : 'app.recorderpause'));
      $dialog.find('.recorder-clock').toggleClass('is-paused', paused);
    }

    function tick() {
      var ms = state.elapsed + (state.phase === 'recording' ? Date.now() - state.started : 0);
      $dialog.find('.recorder-time').text(Core.formatDuration(ms));
    }

    function start() {
      var wantMic = $dialog.find('#recorder-mic').is(':checked');
      $dialog.find('.recorder-start').prop('disabled', true);
      navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true }).then(function(display) {
        var micPromise = wantMic ? navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } }).catch(function() { return null; }) : Promise.resolve(null);
        return micPromise.then(function(mic) { return { display: display, mic: mic }; });
      }).then(function(streams) {
        var display = streams.display;
        var tracks = display.getVideoTracks().slice();
        var displayAudio = display.getAudioTracks();
        if (streams.mic) state.extraStreams.push(streams.mic);
        var micTracks = streams.mic ? streams.mic.getAudioTracks() : [];
        if (displayAudio.length && micTracks.length && window.AudioContext) {
          // one soundtrack from the computer's sound and the microphone together
          state.audioContext = new window.AudioContext();
          var destination = state.audioContext.createMediaStreamDestination();
          state.audioContext.createMediaStreamSource(new MediaStream(displayAudio)).connect(destination);
          state.audioContext.createMediaStreamSource(new MediaStream(micTracks)).connect(destination);
          tracks = tracks.concat(destination.stream.getAudioTracks());
        } else {
          tracks = tracks.concat(displayAudio.length ? displayAudio : micTracks);
        }
        state.displayStream = display;
        state.stream = new MediaStream(tracks);
        state.parts = [];
        var mimeType = Core.pickMimeType(window.MediaRecorder);
        state.recorder = new window.MediaRecorder(state.stream, mimeType ? { mimeType: mimeType, videoBitsPerSecond: 2500000 } : undefined);
        state.recorder.ondataavailable = function(event) { if (event.data && event.data.size) state.parts.push(event.data); };
        state.recorder.onstop = finishRecording;
        // "Stop sharing" in the browser's own bar ends the recording
        display.getVideoTracks()[0].onended = function() { if (state.phase === 'recording' || state.phase === 'paused') stop(); };
        state.recorder.start(1000);
        state.phase = 'recording';
        state.started = Date.now();
        state.elapsed = 0;
        window.clearInterval(state.timer);
        state.timer = window.setInterval(tick, 500);
        render();
        setStatus(t('app.recorderrecording'));
        $dialog.find('.recorder-stop').trigger('focus');
      }).catch(function(error) {
        stopTracks();
        render();
        setStatus(error && error.name === 'NotAllowedError' ? t('app.recordercancelled') : t('app.recorderfailedstart', { message: (error && error.message) || '' }));
      });
    }

    function stop() {
      if (state.phase !== 'recording' && state.phase !== 'paused') return;
      window.clearInterval(state.timer);
      state.phase = 'processing';
      if (state.recorder.state !== 'inactive') state.recorder.stop();
    }

    function finishRecording() {
      var type = (state.recorder && state.recorder.mimeType) || 'video/webm';
      stopTracks();
      if (!state.parts.length) { state.phase = 'idle'; render(); setStatus(t('app.recorderempty')); return; }
      state.blob = new Blob(state.parts, { type: type });
      state.previewUrl = URL.createObjectURL(state.blob);
      state.phase = 'review';
      render();
      setStatus(t('app.recorderdone'));
      $dialog.find('#recorder-name').trigger('focus');
    }

    function pauseOrResume() {
      if (state.phase === 'recording') {
        state.recorder.pause();
        state.elapsed += Date.now() - state.started;
        state.phase = 'paused';
        setStatus(t('app.recorderpaused'));
      } else if (state.phase === 'paused') {
        state.recorder.resume();
        state.started = Date.now();
        state.phase = 'recording';
        setStatus(t('app.recorderrecording'));
      }
      updateRecordingUi();
      tick();
    }

    function save() {
      var form = new FormData();
      form.append('title', $dialog.find('#recorder-name').val());
      form.append('description', $dialog.find('#recorder-description').val());
      form.append('file', state.blob, 'recording.' + Core.extensionFor(state.blob.type));
      state.phase = 'saving';
      render();
      setStatus(t('app.recordersaving'));
      $.ajax({
        url: 'api/asset/recording',
        type: 'POST',
        data: form,
        processData: false,
        contentType: false,
        xhr: function() {
          var xhr = $.ajaxSettings.xhr();
          if (xhr.upload) xhr.upload.addEventListener('progress', function(e) { if (e.lengthComputable) setStatus(t('app.recorderuploading', { percent: Math.round(e.loaded / e.total * 100) })); });
          return xhr;
        }
      }).done(function() {
        close(true);
        Origin.Notify.alert({ type: 'success', title: t('app.recordertitle'), text: _.escape(t('app.recordersaved')), callback: function() { window.location.reload(); } });
      }).fail(function(jqXHR) {
        state.phase = 'review';
        render();
        setStatus((jqXHR.responseJSON && jqXHR.responseJSON.message) || t('app.errorgeneric'));
      });
    }

    $dialog.on('click', '.recorder-close', function() { close(false); });
    $dialog.on('click', '.recorder-start', start);
    $dialog.on('click', '.recorder-stop', stop);
    $dialog.on('click', '.recorder-pause', pauseOrResume);
    $dialog.on('click', '.recorder-save', save);
    $dialog.on('click', '.recorder-discard', function() { close(false); });
    $dialog.on('click', '.recorder-again', function() {
      if (!window.confirm(t('app.recorderdiscardconfirm'))) return;
      if (state.previewUrl) { URL.revokeObjectURL(state.previewUrl); state.previewUrl = null; }
      state.blob = null; state.phase = 'idle';
      render(); setStatus('');
    });
    $(document).on('keydown.recorder', function(event) {
      if (event.key === 'Escape') { event.preventDefault(); return close(false); }
      if (event.key !== 'Tab') return;
      var $items = $dialog.find(FOCUSABLE).filter(':visible');
      if (!$items.length) return;
      var first = $items[0];
      var last = $items[$items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !$dialog[0].contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });

    render();
    // focus the main button (or Close, when recording is not possible here)
    ($dialog.find('.recorder-start').length ? $dialog.find('.recorder-start') : $dialog.find('.recorder-close')).first().trigger('focus');
  }

  return { open: open };
});
