/**
 * The decision-making part of the Rules extension, kept free of Adapt and the DOM so it can be unit tested.
 * Variables are numbers, text or true/false. A "rule" is one Storyline-style trigger row:
 * when <event> [on <target>] [if <variable> <operator> <value>] then <action>.
 */

export const EVENTS = ['start', 'viewed', 'completed', 'correct', 'incorrect', 'button', 'variable'];
export const ACTIONS = ['set-variable', 'add-to-variable', 'toggle-variable', 'show', 'hide', 'go-to', 'message', 'complete'];
export const OPERATORS = ['=', '≠', '>', '≥', '<', '≤', 'contains'];
const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const TOKEN = /\[\[([A-Za-z][A-Za-z0-9_]*)\]\]/g;
const MAX_CHAIN = 10; // rules that change variables can trigger other rules; stop runaway loops

const isNumeric = value => typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && isFinite(Number(value)));

/** Converts a typed-in value (always text in the editor) to the variable's type. */
export function coerce(value, type) {
  if (type === 'true/false') return value === true || String(value).trim().toLowerCase() === 'true';
  if (type === 'number') return isNumeric(value) ? Number(value) : 0;
  return value === undefined || value === null ? '' : String(value);
}

/** Builds the starting state from the variable list. Variables with a bad or repeated name are ignored. */
export function initialState(definitions) {
  const state = {};
  const types = {};
  (definitions || []).forEach(def => {
    const name = def && String(def.name || '').trim();
    if (!name || !NAME.test(name) || name in state) return;
    types[name] = ['number', 'text', 'true/false'].includes(def.type) ? def.type : 'text';
    state[name] = coerce(def.initial, types[name]);
  });
  return { values: state, types };
}

/** Restores saved values, keeping only known variables and re-applying their types. */
export function restore(store, saved) {
  if (!saved || typeof saved !== 'object') return store;
  Object.keys(store.values).forEach(name => {
    if (name in saved) store.values[name] = coerce(saved[name], store.types[name]);
  });
  return store;
}

export function compare(left, operator, right) {
  if (operator === 'contains') return String(left).toLowerCase().includes(String(right).toLowerCase());
  if (typeof left === 'boolean') right = String(right).trim().toLowerCase() === 'true';
  const numeric = isNumeric(left) && isNumeric(right) && typeof left !== 'boolean';
  const a = numeric ? Number(left) : String(left).toLowerCase();
  const b = numeric ? Number(right) : String(right).toLowerCase();
  switch (operator) {
    case '=': return a === b;
    case '≠': return a !== b;
    case '>': return a > b;
    case '≥': return a >= b;
    case '<': return a < b;
    case '≤': return a <= b;
    default: return false;
  }
}

/** True when the rule has no condition, or the condition holds. An unknown variable never satisfies a condition. */
export function conditionMet(store, rule) {
  const name = String(rule._ifVariable || '').trim();
  if (!name) return true;
  if (!(name in store.values)) return false;
  return compare(store.values[name], rule._ifOperator || '=', rule._ifValue === undefined ? '' : rule._ifValue);
}

/** The enabled rules that respond to this event. `subject` is an element id/classes, or a variable name. */
export function rulesFor(rules, event, subject) {
  return (rules || []).filter(rule => {
    if (!rule || rule._isEnabled === false || rule._when !== event) return false;
    if (event === 'start') return true;
    if (event === 'variable') return String(rule._watch || '').trim() === subject;
    return matchesTarget(rule._target, subject);
  });
}

/** `target` is an element id (c-005) or a class name given to the element in the editor. */
export function matchesTarget(target, subject) {
  const wanted = String(target || '').trim().replace(/^\./, '');
  if (!wanted || !subject) return false;
  return subject.id === wanted || (subject.classes || []).includes(wanted);
}

export function classesOf(model) {
  return String((model && model._classes) || '').split(/\s+/).filter(Boolean);
}

/**
 * Runs a variable action. Other actions (show, hide, go-to...) need the page, so they are returned unchanged for
 * the caller to perform.
 * @returns {{changed: string|null}} the name of the variable that changed value, if any
 */
export function applyVariableAction(store, rule) {
  const name = String(rule._variable || '').trim();
  if (!(name in store.values)) return { changed: null };
  const type = store.types[name];
  const before = store.values[name];
  let after = before;
  if (rule._do === 'set-variable') after = coerce(rule._value, type);
  if (rule._do === 'add-to-variable' && type === 'number') after = before + coerce(rule._value, 'number');
  if (rule._do === 'toggle-variable' && type === 'true/false') after = !before;
  store.values[name] = after;
  return { changed: after !== before ? name : null };
}

export const isVariableAction = rule => ['set-variable', 'add-to-variable', 'toggle-variable'].includes(rule._do);

export function formatValue(value) {
  return typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
}

/** Replaces [[name]] with the variable's value (unknown names are left as typed). */
export function substitute(text, store) {
  return String(text).replace(TOKEN, (match, name) => (name in store.values ? formatValue(store.values[name]) : match));
}

export const tokenPattern = () => new RegExp(TOKEN.source, 'g');
export const MAX_CHAIN_DEPTH = MAX_CHAIN;
