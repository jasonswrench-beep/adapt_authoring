import Adapt from 'core/js/adapt';
import ComponentView from 'core/js/views/componentView';
import { activityIriFor, contentFolderFor, isFinishedStatement, isFromActivity, isTopLevelStatement } from './h5pEvents';

// Where the player files ship inside every course build (copied from this plugin's assets folder)
const PLAYER_PATH = 'assets/h5p-player/';

let playerScript = null;

// The player's scripts are UMD bundles: when an AMD loader's define() exists on the page they register
// as modules instead of creating the globals (window.H5PStandalone, window.H5P) that the player relies on.
// Adapt pages have a define(), so hide it while the player starts. A counter keeps this correct when
// several activities on one page start at the same time.
let amdHiddenCount = 0;
let savedDefine;
async function withoutAmd(task) {
  if (amdHiddenCount++ === 0) {
    savedDefine = window.define;
    window.define = undefined;
  }
  try {
    return await task();
  } finally {
    if (--amdHiddenCount === 0) window.define = savedDefine;
  }
}

// Activities start one at a time. The player skips scripts that are already on the page without waiting for
// them to finish loading, so a second activity started in parallel can report "ready" before the H5P core
// exists and would then never be initialised or subscribed.
let startQueue = Promise.resolve();
function startPlayer(task) {
  const run = startQueue.then(() => withoutAmd(task));
  startQueue = run.catch(() => {});
  return run;
}

// The H5P core replaces window.H5P.externalDispatcher each time another activity initialises, so a view that
// subscribed to "its" dispatcher can be left listening to an abandoned one. Instead there is one shared
// subscription that is moved onto the current dispatcher after every start, and it routes each event to
// every active view (each ignores statements that are not about its own activity).
const activeViews = new Set();
let subscribedDispatcher = null;

function routeXapi(event) {
  activeViews.forEach(view => view.onXapi(event));
}

function ensureSubscribed() {
  const dispatcher = window.H5P && window.H5P.externalDispatcher;
  if (!dispatcher || dispatcher === subscribedDispatcher) return;
  dispatcher.on('xAPI', routeXapi);
  subscribedDispatcher = dispatcher;
}

/** Resolves with the page's H5P event dispatcher once the H5P core has created it (null after the timeout). */
function whenDispatcher(timeoutMs = 15000) {
  const started = Date.now();
  return new Promise(resolve => {
    (function check() {
      const dispatcher = window.H5P && window.H5P.externalDispatcher;
      if (dispatcher) return resolve(dispatcher);
      if (Date.now() - started > timeoutMs) return resolve(null);
      setTimeout(check, 100);
    })();
  });
}

/** Loads the player script once for the whole course. */
function loadPlayerScript() {
  if (window.H5PStandalone) return Promise.resolve(window.H5PStandalone);
  if (playerScript) return playerScript;
  playerScript = withoutAmd(() => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${PLAYER_PATH}main.bundle.js`;
    script.onload = () => {
      window.H5PStandalone ? resolve(window.H5PStandalone) : reject(new Error('The H5P player did not initialise'));
    };
    script.onerror = () => reject(new Error('The H5P player could not be loaded'));
    document.head.appendChild(script);
  })).catch(error => {
    playerScript = null;
    throw error;
  });
  return playerScript;
}

class H5pPlayerView extends ComponentView {

  initialize() {
    super.initialize();
    this.onXapi = this.onXapi.bind(this);
  }

  postRender() {
    this.$container = this.$('.js-h5p-container');
    const minHeight = this.model.get('_h5p')?._minHeight;
    if (minHeight) this.$container.css('min-height', `${minHeight}px`);
    if (this.getCompletionMode() === 'inview') {
      this.$('.component__widget').on('inview', this.onInview.bind(this));
    }
    this.renderPlayer();
  }

  getCompletionMode() {
    return this.model.get('_setCompletionOn') === 'completed' ? 'completed' : 'inview';
  }

  async renderPlayer() {
    try {
      const { H5P } = await loadPlayerScript();
      const id = this.model.get('_id');
      const title = this.model.get('displayTitle') || this.model.get('title') || '';
      // a unique IRI per component lets onXapi tell which activity a statement came from
      this.activityIri = activityIriFor(window.location.href, id);
      await startPlayer(() => new H5P(this.$container[0], {
        h5pJsonPath: contentFolderFor(id),
        frameJs: `${PLAYER_PATH}frame.bundle.js`,
        frameCss: `${PLAYER_PATH}styles/h5p.css`,
        title,
        xAPIObjectIRI: this.activityIri,
        frame: false,
        copyright: false,
        export: false,
        icon: false,
        fullScreen: true
      }));
      // Activities report to the page's shared H5P dispatcher; onXapi picks out the statements that belong
      // to this component (see ensureSubscribed).
      activeViews.add(this);
      await whenDispatcher();
      ensureSubscribed();
      // the player does not name its iframe; give it an accessible name
      this.$container.find('iframe').attr('title', title || 'Interactive activity');
      this.setReadyStatus();
    } catch (error) {
      console.error('H5P Player:', error);
      this.$('.js-h5p-error').prop('hidden', false);
      this.setReadyStatus();
    }
  }

  /** Called (via routeXapi) for every xAPI event from any H5P activity on the page. */
  onXapi(event) {
    if (this.getCompletionMode() !== 'completed' || this.model.get('_isComplete')) return;
    const statement = event && event.data && event.data.statement;
    if (!isFromActivity(statement, this.activityIri)) return;
    if (!isFinishedStatement(statement) || !isTopLevelStatement(statement)) return;
    this.setCompletionStatus();
  }

  remove() {
    activeViews.delete(this);
    super.remove();
  }
}

H5pPlayerView.template = 'h5pPlayer.jsx';

export default H5pPlayerView;
