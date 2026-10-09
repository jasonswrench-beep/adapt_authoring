// LICENCE https://github.com/adaptlearning/adapt_authoring/blob/master/LICENSE
/**
 * Pure helpers for the H5P activity gallery (no DOM, no Origin) so they can be unit tested.
 */
define(function() {
  /** Categories in the order they first appear in the catalogue. */
  function categories(activities) {
    var seen = [];
    (activities || []).forEach(function(a) { if (seen.indexOf(a.category) === -1) seen.push(a.category); });
    return seen;
  }

  /** Activities in `category` (all when empty) whose title, summary, "best for" text or category contain every word of `query`. */
  function filter(activities, category, query) {
    var words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    return (activities || []).filter(function(a) {
      if (category && a.category !== category) return false;
      var haystack = [a.title, a.summary, a.bestFor, a.category].join(' ').toLowerCase();
      return words.every(function(w) { return haystack.indexOf(w) !== -1; });
    });
  }

  return { categories: categories, filter: filter };
});
