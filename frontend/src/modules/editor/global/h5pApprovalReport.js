// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Builds the HTML for the administrator's "H5P approvals" dialog.
 * Pure functions (no DOM, no Origin) so they can be unit tested. Everything that comes from an uploaded file
 * or a course (titles, library names, file names) is passed through `esc`, because the alert dialog renders
 * its text as HTML.
 */
define(function() {
  var HASH = /^[a-f0-9]{64}$/;
  var SECTIONS = [
    { key: 'pending', heading: 'app.h5ppending', actions: [['approve', 'app.h5papprove'], ['reject', 'app.h5preject']] },
    { key: 'approved', heading: 'app.h5papproved', actions: [['revoke', 'app.h5pwithdraw']] },
    { key: 'rejected', heading: 'app.h5prejected', actions: [['revoke', 'app.h5pforget']] }
  ];

  function formatSize(bytes) {
    if (typeof bytes !== 'number' || !isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function renderEntry(entry, section, t, esc) {
    // approved automatically because an administrator uploaded it: withdrawing would only re-approve it on the
    // next build, so the one useful action is "Do not approve" (a rejection sticks)
    var auto = section.key === 'approved' && entry.auto === true;
    var actions = auto ? [['reject', 'app.h5pnotapprove']] : section.actions;
    var html = '<li class="h5p-entry h5p-' + section.key + (auto ? ' h5p-auto' : '') + '">';
    html += '<strong>' + esc(entry.title || entry.fileName || t('app.h5punnamed')) + '</strong>';
    if (auto) html += ' <span class="h5p-badge">' + esc(t('app.h5pautobadge')) + '</span>';
    html += '<ul class="h5p-details">';
    html += '<li>' + esc(t('app.h5pfile')) + ' ' + esc(entry.fileName || '') + (entry.size ? ' (' + esc(formatSize(entry.size)) + ')' : '') + '</li>';
    if (entry.mainLibrary) html += '<li>' + esc(t('app.h5ptype')) + ' ' + esc(entry.mainLibrary) + '</li>';
    if (entry.libraries && entry.libraries.length) {
      html += '<li>' + esc(t('app.h5plibraries')) + ' ' + esc(entry.libraries.join(', ')) + '</li>';
    }
    if (entry.seenIn && entry.seenIn.length) {
      html += '<li>' + esc(t('app.h5pusedin')) + ' ' + esc(entry.seenIn.map(function(c) { return c.courseTitle || c.courseId; }).join(', ')) + '</li>';
    }
    if (entry.decidedBy) html += '<li>' + esc(t('app.h5pdecidedby', { who: entry.decidedBy })) + '</li>';
    html += '</ul>';
    // a decision button is only drawn for a well-formed hash, so the value placed in the page is always 64 hex characters
    if (HASH.test(entry.hash || '')) {
      html += '<div class="h5p-actions">';
      actions.forEach(function(action) {
        // the label names the activity, so a screen reader can tell the buttons apart
        var label = t(action[1]) + ': ' + (entry.title || entry.fileName || '');
        html += '<button type="button" class="js-h5p-action h5p-action-' + action[0] + '" data-action="' + action[0] +
          '" data-hash="' + esc(entry.hash) + '" aria-label="' + esc(label) + '">' + esc(t(action[1])) + '</button>';
      });
      html += '</div>';
    }
    return html + '</li>';
  }

  /** @param {{pending: Array, approved: Array, rejected: Array}} payload response from GET /api/h5papproval */
  function buildHtml(payload, t, esc) {
    var html = '<div class="h5p-approvals">';
    html += '<p class="h5p-warning">' + esc(t('app.h5pwarning')) + '</p>';
    var total = 0;
    SECTIONS.forEach(function(section) {
      var entries = (payload && payload[section.key]) || [];
      total += entries.length;
      if (!entries.length && section.key !== 'pending') return;
      html += '<h4>' + esc(t(section.heading)) + ' (' + entries.length + ')</h4>';
      if (!entries.length) {
        html += '<p class="h5p-empty">' + esc(t('app.h5pnonepending')) + '</p>';
        return;
      }
      html += '<ul class="h5p-list">';
      entries.forEach(function(entry) { html += renderEntry(entry, section, t, esc); });
      html += '</ul>';
    });
    if (!total) html += '<p class="h5p-empty">' + esc(t('app.h5pnoneseen')) + '</p>';
    return html + '</div>';
  }

  return { buildHtml: buildHtml, formatSize: formatSize };
});
