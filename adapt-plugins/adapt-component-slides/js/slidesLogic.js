/**
 * Decisions for the Slides component, free of Adapt and the DOM so they can be unit tested.
 */

export const clamp = (index, count) => Math.max(0, Math.min(count - 1, Number.isFinite(index) ? Math.trunc(index) : 0));

/**
 * Can the learner move to `target`? When the slides must be seen in order they may go back anywhere and
 * forward only to the next slide after the furthest one they have already reached.
 */
export function canGo({ target, count, furthest, isSequenced }) {
  if (!Number.isInteger(target) || target < 0 || target >= count) return false;
  if (!isSequenced) return true;
  return target <= furthest + 1;
}

/** "Slide {{current}} of {{total}}" with the numbers filled in. Any other text is left exactly as typed. */
export function progressText(template, current, total) {
  return String(template || 'Slide {{current}} of {{total}}')
    .replace(/\{\{\s*current\s*\}\}/g, current)
    .replace(/\{\{\s*total\s*\}\}/g, total);
}

const plain = html => String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** Spoken names for the buttons, e.g. "Next: Why it matters (slide 3 of 5)". */
export function buttonLabel(direction, items, index, words = {}) {
  const target = direction === 'next' ? index + 1 : index - 1;
  const base = direction === 'next' ? (words.next || 'Next') : (words.back || 'Back');
  if (target < 0 || target >= items.length) return base;
  const title = plain(items[target].title);
  const place = `(slide ${target + 1} of ${items.length})`;
  return title ? `${base}: ${title} ${place}` : `${base} ${place}`;
}

/** The index a key press moves to, or null if the key is not one the component handles. */
export function targetForKey(key, index, count, isRtl) {
  const forward = isRtl ? 'ArrowLeft' : 'ArrowRight';
  const backward = isRtl ? 'ArrowRight' : 'ArrowLeft';
  if (key === forward) return Math.min(index + 1, count - 1);
  if (key === backward) return Math.max(index - 1, 0);
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}
