const test = require('node:test');
const assert = require('node:assert');
const { checkContent } = require('../content-rules');

// minimal course: one page > article > block, with the supplied components
function course(components, extra = {}) {
  return Object.assign({
    config: { _defaultLanguage: 'en', _accessibility: { _isEnabled: true, _isSkipNavigationEnabled: true } },
    course: { _id: 'course', _type: 'course', title: 'C' },
    contentObjects: [{ _id: 'p1', _parentId: 'course', _type: 'page', title: 'Page one', displayTitle: 'Page one' }],
    articles: [{ _id: 'a1', _parentId: 'p1', _type: 'article', title: 'A' }],
    blocks: [{ _id: 'b1', _parentId: 'a1', _type: 'block', title: 'B' }],
    components: components.map((c, i) => Object.assign({ _id: `c${i}`, _parentId: 'b1', _type: 'component' }, c))
  }, extra);
}
const rules = findings => findings.map(f => f.rule);
const text = body => ({ _component: 'text', title: 'T', displayTitle: '', body });
const graphic = alt => ({ _component: 'graphic', title: 'G', _graphic: { alt, large: 'course/en/images/a.png', small: 'course/en/images/a.png' } });

test('a clean course has no findings', () => {
  assert.deepStrictEqual(checkContent(course([text('<p>Hello</p>'), graphic('A blue desk')])), []);
});

test('image alt: missing, filename, long, redundant', () => {
  assert.ok(rules(checkContent(course([graphic('')]))).includes('image-alt-missing'));
  assert.ok(rules(checkContent(course([graphic('image.png')]))).includes('image-alt-filename'));
  assert.ok(rules(checkContent(course([graphic('x'.repeat(200))]))).includes('image-alt-long'));
  assert.ok(rules(checkContent(course([graphic('Picture of a desk')]))).includes('image-alt-redundant'));
  assert.strictEqual(checkContent(course([graphic('')]))[0].severity, 'error');
});

test('alt text is found inside nested component items', () => {
  const narrative = { _component: 'narrative', title: 'N', _items: [{ _graphic: { alt: '', src: 'course/en/images/b.jpg' } }] };
  assert.ok(rules(checkContent(course([narrative]))).includes('image-alt-missing'));
});

test('links: vague, soft-vague, raw url, empty; descriptive passes', () => {
  const r = body => rules(checkContent(course([text(body)])));
  assert.ok(r('<a href="x">click here</a>').includes('link-vague'));
  assert.strictEqual(checkContent(course([text('<a href="x">here</a>')]))[0].severity, 'error');
  assert.strictEqual(checkContent(course([text('<a href="x">read more</a>')]))[0].severity, 'warning');
  assert.ok(r('<a href="x">https://example.com/page</a>').includes('link-url-text'));
  assert.ok(r('<a href="x"></a>').includes('link-empty'));
  assert.deepStrictEqual(r('<a href="x">Download the planner (PDF)</a>'), []);
});

test('tables: no header is an error, header without caption is info', () => {
  const noHeader = checkContent(course([text('<table><tr><td>a</td></tr></table>')]));
  assert.deepStrictEqual(rules(noHeader), ['table-no-header']);
  const noCaption = checkContent(course([text('<table><tr><th>a</th></tr></table>')]));
  assert.deepStrictEqual(rules(noCaption), ['table-no-caption']);
  assert.deepStrictEqual(checkContent(course([text('<table><caption>Plan</caption><tr><th>a</th></tr></table>')])), []);
});

test('headings: h1-h3 and skipped levels', () => {
  assert.ok(rules(checkContent(course([text('<h2>x</h2>')]))).includes('heading-level'));
  assert.ok(rules(checkContent(course([text('<h4>x</h4><h6>y</h6>')]))).includes('heading-skip'));
  assert.deepStrictEqual(checkContent(course([text('<h5>x</h5>')])), []);
});

test('media: transcript, autoplay, external captions note', () => {
  const noTranscript = checkContent(course([{ _component: 'media', title: 'M', _media: { mp4: 'a.mp4' } }]));
  assert.ok(rules(noTranscript).includes('media-transcript'));
  assert.ok(rules(noTranscript).includes('media-captions'));
  const ok = checkContent(course([{ _component: 'youtube', title: 'Y', _transcript: { _inlineTranscript: true, inlineTranscriptBody: '<p>Words</p>' } }]));
  assert.deepStrictEqual(rules(ok), ['media-captions-external']);
  const auto = checkContent(course([{ _component: 'youtube', title: 'Y', _media: { _autoplay: true } }]));
  assert.ok(rules(auto).includes('media-autoplay'));
});

test('page titles: missing and duplicate', () => {
  const dup = course([text('x')]);
  dup.contentObjects.push({ _id: 'p2', _parentId: 'course', _type: 'page', title: 'page ONE' });
  assert.strictEqual(rules(checkContent(dup)).filter(r => r === 'page-title-duplicate').length, 2);
  const none = course([text('x')]);
  none.contentObjects[0].title = none.contentObjects[0].displayTitle = '';
  assert.ok(rules(checkContent(none)).includes('page-title-missing'));
});

test('course settings: accessibility off, skip nav off, no language', () => {
  const c = course([text('x')]);
  c.config = { _accessibility: { _isEnabled: false, _isSkipNavigationEnabled: false } };
  assert.deepStrictEqual(rules(checkContent(c)).sort(), ['a11y-disabled', 'language-missing', 'skip-nav-disabled']);
});

test('inline colour, tiny text and obsolete markup are flagged', () => {
  const r = body => rules(checkContent(course([text(body)])));
  assert.ok(r('<p style="color:#ccc">x</p>').includes('inline-colour'));
  assert.ok(r('<p style="font-size:9px">x</p>').includes('small-text'));
  assert.ok(r('<font>x</font>').includes('obsolete-markup'));
  assert.ok(r('<iframe src="x"></iframe>').includes('iframe-title'));
});

test('H5P player: missing file is an error; every H5P gets a manual-review note', () => {
  const none = checkContent(course([{ _component: 'h5pPlayer', title: 'Quiz', _h5p: { _src: '' } }]));
  assert.deepStrictEqual(rules(none).sort(), ['embed-review', 'h5p-missing-file']);
  assert.strictEqual(none.find(f => f.rule === 'h5p-missing-file').severity, 'error');
  const ok = checkContent(course([{ _component: 'h5pPlayer', title: 'Quiz', _h5p: { _src: 'course/en/assets/a.h5p' } }]));
  assert.deepStrictEqual(rules(ok), ['embed-review']);
  assert.strictEqual(ok[0].severity, 'info');
});
