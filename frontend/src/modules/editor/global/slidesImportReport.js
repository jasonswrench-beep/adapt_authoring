// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Builds the HTML for the dialog shown after a PowerPoint has been imported into a Slides component.
 * Pure functions (no DOM, no Origin) so they can be unit tested. The alert dialog renders its text as HTML and the
 * warnings come from the uploaded file, so everything goes through `esc`.
 */
define(function() {
  function buildHtml(summary, t, esc) {
    var html = '<p>' + esc(t('app.importpptxdone', { slides: summary.slides, pictures: summary.pictures })) + '</p>';
    var notes = (summary.warnings || []).slice(0, 8);
    if (notes.length) {
      html += '<p>' + esc(t('app.importpptxattention')) + '</p><ul style="text-align:left">';
      notes.forEach(function(w) { html += '<li>' + esc(w) + '</li>'; });
      if ((summary.warnings || []).length > notes.length) html += '<li>' + esc(t('app.importpptxmore', { count: summary.warnings.length - notes.length })) + '</li>';
      html += '</ul>';
    }
    if ((summary.noAlt || []).length) html += '<p>' + esc(t('app.importpptxnoalt', { count: summary.noAlt.length })) + '</p>';
    return html;
  }

  return { buildHtml: buildHtml };
});
