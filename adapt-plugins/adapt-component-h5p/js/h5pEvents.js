/**
 * Pure helpers for reading H5P xAPI statements. Kept free of Adapt imports so they can be unit tested.
 */

const FINISHED_VERBS = /\/(completed|answered|passed|failed)$/;

/** True when a statement means the learner has finished an attempt at the activity. */
export function isFinishedStatement(statement) {
  if (!statement) return false;
  if (statement.result && statement.result.completion === true) return true;
  const verb = statement.verb && statement.verb.id;
  return typeof verb === 'string' && FINISHED_VERBS.test(verb);
}

/** Only the statement about the whole activity counts, not those about its sub-parts. */
export function isTopLevelStatement(statement) {
  const parent = statement && statement.context && statement.context.contextActivities && statement.context.contextActivities.parent;
  return !(Array.isArray(parent) && parent.length);
}

/** Folder (relative to the course's index.html) that the export step unpacks this activity into. */
export function contentFolderFor(componentId) {
  return `./h5p/${String(componentId).replace(/[^\w-]/g, '_')}`;
}

/** The activity IRI given to the player for a component; it comes back as the statement's object.id. */
export function activityIriFor(pageUrl, componentId) {
  return `${String(pageUrl).split('#')[0]}#h5p-${String(componentId).replace(/[^\w-]/g, '_')}`;
}

/** True when a statement is about this activity (its object id is the IRI, optionally followed by a query). */
export function isFromActivity(statement, iri) {
  const id = statement && statement.object && statement.object.id;
  return typeof id === 'string' && (id === iri || id.startsWith(`${iri}?`));
}
