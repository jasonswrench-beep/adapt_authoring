// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Builds the HTML shown by the editor's "Check accessibility" dialog.
 * Pure functions (no DOM, no Origin) so they can be unit tested. Every string that comes from course
 * content or the server is passed through `esc`, because the alert dialog renders its text as HTML.
 */
define(function() {
  var SEVERITIES = ['error', 'warning', 'info'];
  var HEADINGS = { error: 'app.a11ymustfix', warning: 'app.a11yshouldfix', info: 'app.a11ycheck' };
  var MAX_PLACES = 5;
  // axe-core help links are the only external links we render
  var SAFE_LINK = /^https:\/\/dequeuniversity\.com\//;

  function group(findings) {
    var map = {};
    var order = [];
    (findings || []).forEach(function(f) {
      var key = [f.rule, f.severity, f.message].join('|');
      if (!map[key]) {
        map[key] = { rule: f.rule, severity: f.severity, wcag: f.wcag, message: f.message, fix: f.fix, places: [] };
        order.push(key);
      }
      map[key].places.push(f.where || {});
    });
    return order.map(function(k) { return map[k]; });
  }

  function all(payload) {
    var deep = payload.deep && payload.deep.ran ? payload.deep.findings || [] : [];
    return (payload.findings || []).concat(deep);
  }

  function summarise(payload) {
    var findings = all(payload);
    var counts = { error: 0, warning: 0, info: 0 };
    findings.forEach(function(f) { if (counts[f.severity] !== undefined) counts[f.severity]++; });
    return { errors: counts.error, warnings: counts.warning, info: counts.info, total: findings.length };
  }

  function placeText(w, esc) {
    var text = esc(w.type || '');
    if (w.title) text += ' &ldquo;' + esc(w.title) + '&rdquo;';
    if (w.page && w.page !== w.title) text += ' &ndash; ' + esc(w.page);
    return text;
  }

  function renderGroup(g, t, esc) {
    var html = '<li class="a11y-group a11y-' + esc(g.severity) + '"><strong>' + esc(g.message) + '</strong>';
    if (g.wcag) html += ' <span class="a11y-wcag">WCAG ' + esc(g.wcag) + '</span>';
    html += '<ul class="a11y-places">';
    g.places.slice(0, MAX_PLACES).forEach(function(w) { html += '<li>' + placeText(w, esc) + '</li>'; });
    if (g.places.length > MAX_PLACES) {
      html += '<li>' + esc(t('app.a11ymore', { count: g.places.length - MAX_PLACES })) + '</li>';
    }
    html += '</ul>';
    if (g.fix) {
      html += '<p class="a11y-fix">';
      if (SAFE_LINK.test(g.fix)) {
        html += '<a href="' + esc(g.fix) + '" target="_blank" rel="noopener">' + esc(t('app.a11ylearnmore')) + '</a>';
      } else {
        html += '<strong>' + esc(t('app.a11yhowtofix')) + '</strong> ' + esc(g.fix);
      }
      html += '</p>';
    }
    return html + '</li>';
  }

  /** @param {object} payload response payload from /api/output/<plugin>/accessibility/<courseId> */
  function buildHtml(payload, t, esc) {
    var s = summarise(payload);
    var html = '<div class="a11y-report">';
    html += '<p class="a11y-summary">' + esc(t('app.a11ysummary', { errors: s.errors, warnings: s.warnings, info: s.info })) + '</p>';
    if (!s.total) html += '<p>' + esc(t('app.a11ynone')) + '</p>';

    var groups = group(all(payload));
    SEVERITIES.forEach(function(sev) {
      var inSev = groups.filter(function(g) { return g.severity === sev; });
      if (!inSev.length) return;
      html += '<h4>' + esc(t(HEADINGS[sev])) + ' (' + inSev.length + ')</h4><ul class="a11y-list">';
      inSev.forEach(function(g) { html += renderGroup(g, t, esc); });
      html += '</ul>';
    });

    var deep = payload.deep;
    if (deep && deep.ran) {
      html += '<p class="a11y-note">' + esc(t('app.a11yfullran', { count: deep.pagesChecked })) + '</p>';
      (deep.errors || []).forEach(function(e) {
        html += '<p class="a11y-note">' + esc(t('app.a11ycouldnotcheck')) + ' ' + esc(e) + '</p>';
      });
      var review = group(deep.review || []);
      if (review.length) {
        html += '<h4>' + esc(t('app.a11yreview')) + ' (' + review.length + ')</h4><ul class="a11y-list">';
        review.forEach(function(g) { html += '<li class="a11y-group a11y-info">' + esc(g.message) + '</li>'; });
        html += '</ul>';
      }
    } else if (deep) {
      html += '<p class="a11y-note">' + esc(t('app.a11yfullnotrun')) + ' ' + esc(deep.reason || '') + '</p>';
    }
    html += '<p class="a11y-note">' + esc(t('app.a11ylimits')) + '</p></div>';
    return html;
  }

  return { buildHtml: buildHtml, summarise: summarise, group: group };
});
