/**
 * The editor page. Based on the default page of h5p-nodejs-library (GPL-3.0) with one change: after the content is
 * saved, the page tells the course tool to take the finished activity (same-origin request, so the user's course tool
 * session authorises it) and then returns to the component. The page's address carries ?component=<id>&return=<path>.
 */
const esc = value => JSON.stringify(value).replace(/</g, '\\u003c');

export default function render(model, labels = {}) {
  const t = Object.assign({ save: 'Save to course', saving: 'Saving...', failed: 'The activity could not be saved: ', cancel: 'Cancel' }, labels);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>H5P editor</title>
<script> window.H5PIntegration = parent.H5PIntegration || ${JSON.stringify(model.integration, null, 2).replace(/</g, '\\u003c')}</script>
${model.styles.map(style => `<link rel="stylesheet" href="${style}">`).join('\n')}
${model.scripts.map(script => `<script src="${script}"></script>`).join('\n')}
<style>
  body { font-family: sans-serif; margin: 0; background: #f5f5f5; }
  .adapt-h5p-bar { position: sticky; top: 0; z-index: 10; background: #003e7e; color: #fff; padding: 10px 16px; display: flex; gap: 12px; align-items: center; }
  .adapt-h5p-bar button, .adapt-h5p-bar a { font-size: 16px; padding: 8px 16px; border-radius: 4px; border: 2px solid #fff; background: #fff; color: #003e7e; cursor: pointer; text-decoration: none; }
  .adapt-h5p-bar button[disabled] { opacity: .6; cursor: default; }
  #adapt-h5p-status { margin-left: auto; }
  #h5p-content-form { max-width: 1100px; margin: 16px auto; background: #fff; padding: 16px; }
</style>
</head>
<body>
<div class="adapt-h5p-bar">
  <button type="submit" form="h5p-content-form" id="adapt-h5p-save">${t.save}</button>
  <a href="#" id="adapt-h5p-cancel">${t.cancel}</a>
  <span id="adapt-h5p-status" role="status" aria-live="polite"></span>
</div>
<form method="post" enctype="multipart/form-data" id="h5p-content-form">
  <div id="post-body-content"><div class="h5p-create"><div class="h5p-editor"></div></div></div>
</form>
<script>
(function ($) {
  var ns = H5PEditor;
  var query = new URLSearchParams(window.location.search);
  var componentId = query.get('component') || '';
  var back = query.get('return') || '/';
  if (!/^\\/(?!\\/)/.test(back)) back = '/'; // only paths on this site
  var labels = ${esc({ saving: t.saving, failed: t.failed })};
  var status = document.getElementById('adapt-h5p-status');
  var saveButton = document.getElementById('adapt-h5p-save');
  document.getElementById('adapt-h5p-cancel').addEventListener('click', function (event) { event.preventDefault(); window.location.href = back; });

  H5PEditor.init = function () {
    H5PEditor.$ = H5P.jQuery;
    H5PEditor.basePath = H5PIntegration.editor.libraryUrl;
    H5PEditor.fileIcon = H5PIntegration.editor.fileIcon;
    H5PEditor.ajaxPath = H5PIntegration.editor.ajaxPath;
    H5PEditor.filesPath = H5PIntegration.editor.filesPath;
    H5PEditor.apiVersion = H5PIntegration.editor.apiVersion;
    H5PEditor.contentLanguage = H5PIntegration.editor.language;
    H5PEditor.copyrightSemantics = H5PIntegration.editor.copyrightSemantics;
    H5PEditor.metadataSemantics = H5PIntegration.editor.metadataSemantics;
    H5PEditor.assets = H5PIntegration.editor.assets;
    H5PEditor.baseUrl = '';
    if (H5PIntegration.editor.nodeVersionId !== undefined) H5PEditor.contentId = H5PIntegration.editor.nodeVersionId;

    var h5peditor;
    var $editor = $('.h5p-editor');
    var $create = $('.h5p-create').hide();
    if (H5PEditor.contentId) {
      $.ajax({
        error: function () { h5peditor = new ns.Editor(undefined, undefined, $editor[0]); $create.show(); },
        success: function (res) { h5peditor = new ns.Editor(res.library, JSON.stringify(res.params), $editor[0]); $create.show(); },
        type: 'GET',
        url: '${model.urlGenerator.parameters()}/' + H5PEditor.contentId + window.location.search
      });
    } else {
      h5peditor = new ns.Editor(undefined, undefined, $editor[0]);
      $create.show();
    }

    var submitting = false;
    $('#h5p-content-form').submit(function (event) {
      event.preventDefault();
      if (!h5peditor || submitting) return;
      var params = h5peditor.getParams();
      if (params.params === undefined) return; // the editor shows what needs fixing
      h5peditor.getContent(function (content) {
        submitting = true;
        saveButton.disabled = true;
        status.textContent = labels.saving;
        var fail = function (message) { submitting = false; saveButton.disabled = false; status.textContent = labels.failed + message; };
        $.ajax({
          data: JSON.stringify({ library: content.library, params: JSON.parse(content.params) }),
          headers: { 'Content-Type': 'application/json' },
          type: 'POST'
        }).then(function (result) {
          var saved = typeof result === 'string' ? JSON.parse(result) : result;
          if (!saved.contentId) return fail('no content id');
          return fetch('/api/content/component/' + encodeURIComponent(componentId) + '/h5peditor/finish', {
            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contentId: saved.contentId })
          }).then(function (response) { return response.json().then(function (body) { return { ok: response.ok && body.success, body: body }; }); })
            .then(function (outcome) { if (outcome.ok) window.location.href = back; else fail(outcome.body.message || 'the course tool refused it'); });
        }, function (xhr) { fail((xhr && xhr.responseText) || 'save failed'); });
      });
    });
  };

  H5PEditor.getAjaxUrl = function (action, parameters) {
    var url = H5PIntegration.editor.ajaxPath + action;
    if (parameters !== undefined) for (var property in parameters) if (parameters.hasOwnProperty(property)) url += '&' + property + '=' + parameters[property];
    url += window.location.search.replace(/\\?/g, '&');
    return url;
  };
  H5PEditor.enableContentHub = false;
  $(document).ready(H5PEditor.init);
})(H5P.jQuery);
</script>
</body>
</html>`;
}
