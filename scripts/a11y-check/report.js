const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ORDER = { error: 0, warning: 1, info: 2 };
const LABEL = { error: 'Must fix', warning: 'Should fix', info: 'Check' };

/** Merge identical (rule, message) findings so a repeated problem is one line with a list of places. */
function group(findings) {
  const map = new Map();
  findings.forEach(f => {
    const key = `${f.rule}|${f.severity}|${f.message}`;
    if (!map.has(key)) map.set(key, Object.assign({}, f, { places: [], nodes: f.nodes || [] }));
    const g = map.get(key);
    g.places.push(f.where);
    if (f.nodes && g !== map.get(key)) g.nodes = g.nodes.concat(f.nodes);
  });
  return Array.from(map.values()).sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.rule.localeCompare(b.rule));
}

const placeText = w => `${w.type}${w.title ? ` "${w.title}"` : ''}${w.page && w.page !== w.title ? ` on page "${w.page}"` : ''}${w.id && w.type !== 'rendered page' ? ` [${w.id}]` : ''}`;

function renderConsole(report) {
  const out = [];
  const c = report.counts;
  out.push(`Accessibility check: ${c.error} to fix, ${c.warning} to improve, ${c.info} to check`);
  if (report.browser.ran) out.push(`  Rendered ${report.browser.pagesChecked} page(s) in a browser with axe-core.`);
  else out.push(`  Browser check not run: ${report.browser.reason || 'disabled'}`);
  (report.browser.errors || []).forEach(e => out.push(`  ! could not check ${e}`));
  group(report.findings).forEach(g => {
    out.push('', `[${LABEL[g.severity]}] ${g.message}${g.wcag ? `  (WCAG ${g.wcag})` : ''}`);
    g.places.slice(0, 6).forEach(w => out.push(`    - ${placeText(w)}`));
    if (g.places.length > 6) out.push(`    ... and ${g.places.length - 6} more`);
    (g.nodes || []).slice(0, 3).forEach(n => out.push(`      element: ${n.target}`));
    if (g.fix) out.push(`    How to fix: ${g.fix}`);
  });
  if (report.review.length) out.push('', `${group(report.review).length} item(s) need a manual look (see the HTML report).`);
  return out.join('\n');
}

function renderHtml(report) {
  const sections = ['error', 'warning', 'info'].map(sev => {
    const groups = group(report.findings).filter(g => g.severity === sev);
    if (!groups.length) return '';
    return `<section><h2>${LABEL[sev]} <span class="count">${groups.length}</span></h2>${groups.map(g => `
      <article class="finding ${sev}">
        <h3>${esc(g.message)} ${g.wcag ? `<small>WCAG ${esc(g.wcag)}</small>` : ''}</h3>
        <ul>${g.places.map(w => `<li>${esc(placeText(w))}</li>`).join('')}</ul>
        ${g.fix ? `<p class="fix"><strong>How to fix:</strong> ${/^https?:/.test(g.fix) ? `<a href="${esc(g.fix)}">${esc(g.fix)}</a>` : esc(g.fix)}</p>` : ''}
        ${g.nodes && g.nodes.length ? `<details><summary>Technical detail</summary>${g.nodes.slice(0, 5).map(n => `<pre>${esc(n.target)}\n${esc(n.html)}\n${esc(n.summary)}</pre>`).join('')}</details>` : ''}
      </article>`).join('')}</section>`;
  }).join('');
  const review = group(report.review);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Accessibility report</title>
<style>
:root{--bg:#fff;--fg:#1b1b1b;--muted:#555;--card:#f6f6f6;--err:#b00020;--warn:#8a5a00;--info:#1d5f9e}
@media (prefers-color-scheme:dark){:root{--bg:#161616;--fg:#eee;--muted:#aaa;--card:#232323;--err:#ff8a8a;--warn:#ffd27a;--info:#8fc4ff}}
body{font:16px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg);max-width:60rem;margin:0 auto;padding:1rem}
.count{color:var(--muted);font-weight:400}.finding{background:var(--card);border-left:6px solid;padding:.5rem 1rem;margin:.75rem 0;border-radius:4px}
.error{border-color:var(--err)}.warning{border-color:var(--warn)}.info{border-color:var(--info)}
h3{font-size:1rem;margin:.25rem 0}small{color:var(--muted);font-weight:400}pre{overflow:auto;white-space:pre-wrap;font-size:.8rem}
</style></head><body>
<h1>Accessibility report</h1>
<p>${esc(report.counts.error)} to fix, ${esc(report.counts.warning)} to improve, ${esc(report.counts.info)} to check.
${report.browser.ran ? `Rendered ${esc(report.browser.pagesChecked)} page(s) with axe-core.` : `Browser check not run: ${esc(report.browser.reason || 'disabled')}.`}
Automated checks find only part of the problems; they do not replace testing with a keyboard and a screen reader.</p>
${sections || '<p>No problems found by the automated checks.</p>'}
${review.length ? `<section><h2>Needs a manual look <span class="count">${review.length}</span></h2><ul>${review.map(g => `<li>${esc(g.message)} - ${esc(g.places.slice(0, 4).map(placeText).join('; '))}</li>`).join('')}</ul></section>` : ''}
</body></html>`;
}

module.exports = { renderConsole, renderHtml };
