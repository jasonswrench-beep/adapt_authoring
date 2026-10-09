import Adapt from 'core/js/adapt';
import data from 'core/js/data';
import router from 'core/js/router';
import notify from 'core/js/notify';
import offlineStorage from 'core/js/offlineStorage';
import {
  initialState, restore, rulesFor, classesOf, conditionMet, applyVariableAction, isVariableAction,
  substitute, tokenPattern, formatValue, MAX_CHAIN_DEPTH
} from './rulesCore';

const STORAGE_KEY = 'rulesVars';

class Rules extends Backbone.Controller {

  initialize() {
    this.rules = [];
    this.store = { values: {}, types: {} };
    this.hidden = new Set(); // ids hidden by a rule, re-applied when their view is (re)rendered
    this.fired = new Set(); // rules marked "only once" that have run
    this.depth = 0;
    this.ready = false; // events caused by restoring saved progress must not run rules a second time
    this.listenTo(Adapt, 'app:dataReady', this.onDataReady);
  }

  onDataReady() {
    const settings = Adapt.course.get('_rules');
    if (!settings || !settings._isEnabled) return;
    this.rules = (settings._triggers || []).map((rule, index) => Object.assign({ _index: index }, rule));
    this.store = initialState(settings._variables);
    this.listenTo(Adapt, {
      'view:postRender': this.onViewPostRender,
      'pageView:ready menuView:ready': this.onContentObjectReady,
      remove: this.onRemove
    });
    this.listenTo(data, {
      'change:_isComplete': this.onCompleteChange,
      'change:_isCorrect': this.onCorrectChange
    });
    this.listenTo(Adapt, 'adapt:initialize', this.onInitialize);
  }

  onInitialize() {
    restore(this.store, this.readSaved());
    this.ready = true;
    this.run('start');
  }

  readSaved() {
    try {
      const raw = offlineStorage.ready && offlineStorage.get(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  save() {
    try {
      if (offlineStorage.ready) offlineStorage.set(STORAGE_KEY, JSON.stringify(this.store.values));
    } catch (error) { /* not worth interrupting the learner */ }
  }

  onRemove() {
    this.depth = 0;
  }

  // ----- events -----

  subjectOf(model) {
    return { id: model.get('_id'), classes: classesOf({ _classes: model.get('_classes') }) };
  }

  onViewPostRender(view) {
    const model = view.model;
    const id = model.get('_id');
    if (this.hidden.has(id)) view.$el.addClass('u-display-none');
    this.insertButtons(view);
    this.insertTokens(view.$el);
    if (model.get('_type') !== 'page' && model.get('_type') !== 'menu') this.run('viewed', this.subjectOf(model));
  }

  onContentObjectReady(view) {
    this.insertTokens(view.$el);
    this.run('viewed', this.subjectOf(view.model));
  }

  onCompleteChange(model, value) {
    if (value && this.ready) this.run('completed', this.subjectOf(model));
  }

  // _isCorrect is set (to true or false) when a submitted answer has been marked, and reset to undefined on retry
  onCorrectChange(model, value) {
    if (!this.ready || (value !== true && value !== false)) return;
    this.run(value ? 'correct' : 'incorrect', this.subjectOf(model));
  }

  // ----- running rules -----

  run(event, subject) {
    if (this.depth >= MAX_CHAIN_DEPTH) return;
    this.depth++;
    try {
      rulesFor(this.rules, event, subject).forEach(rule => this.runRule(rule));
    } finally {
      this.depth--;
    }
  }

  runRule(rule) {
    const key = rule._index;
    if (rule._once && this.fired.has(key)) return;
    if (!conditionMet(this.store, rule)) return;
    if (rule._once) this.fired.add(key);
    this.perform(rule);
  }

  perform(rule) {
    if (isVariableAction(rule)) {
      const { changed } = applyVariableAction(this.store, rule);
      if (changed) {
        this.save();
        this.refreshTokens();
        this.run('variable', changed);
      }
      return;
    }
    const models = this.modelsFor(rule._element);
    switch (rule._do) {
      case 'show': return models.forEach(model => this.setVisible(model, true));
      case 'hide': return models.forEach(model => this.setVisible(model, false));
      case 'complete': return models.forEach(model => model.setCompletionStatus && model.setCompletionStatus());
      case 'go-to': return this.goTo(models[0]);
      case 'message': return notify.popup({
        _isCancellable: true,
        title: substitute(rule._title || '', this.store),
        body: substitute(rule._text || '', this.store)
      });
    }
  }

  modelsFor(target) {
    const wanted = String(target || '').trim().replace(/^\./, '');
    if (!wanted) return [];
    return data.filter(model => {
      if (model.get('_id') === wanted) return true;
      return classesOf({ _classes: model.get('_classes') }).includes(wanted);
    });
  }

  setVisible(model, visible) {
    const id = model.get('_id');
    if (visible) this.hidden.delete(id); else this.hidden.add(id);
    model.set('_isVisible', visible, { pluginName: '_rules' });
    const view = data.findViewByModelId(id);
    if (view && view.$el) view.$el.toggleClass('u-display-none', !visible);
  }

  goTo(model) {
    if (!model) return;
    const id = model.get('_id');
    if (['page', 'menu'].includes(model.get('_type'))) return router.navigate(`#/id/${id}`, { trigger: true });
    router.navigateToElement(`.${id}`);
  }

  // ----- buttons -----

  insertButtons(view) {
    const subject = this.subjectOf(view.model);
    rulesFor(this.rules, 'button', subject).forEach(rule => {
      const label = rule._buttonText || 'Continue';
      const $button = $('<button type="button" class="btn-text rules__button"></button>').text(label);
      $button.on('click', () => this.runRule(rule));
      $('<div class="rules__button-container"></div>').append($button).appendTo(view.$el);
    });
  }

  // ----- [[variable]] text -----

  insertTokens($root) {
    const pattern = tokenPattern();
    const walker = document.createTreeWalker($root[0], NodeFilter.SHOW_TEXT, {
      acceptNode: node => (/\[\[[A-Za-z]/.test(node.nodeValue) && !$(node.parentNode).closest('script,style,textarea').length
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT)
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      const text = node.nodeValue;
      const fragment = document.createDocumentFragment();
      let last = 0;
      let match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(text))) {
        const name = match[1];
        fragment.appendChild(document.createTextNode(text.slice(last, match.index)));
        if (name in this.store.values) {
          const span = document.createElement('span');
          span.className = 'rules__value';
          span.setAttribute('data-rules-var', name);
          span.textContent = formatValue(this.store.values[name]);
          fragment.appendChild(span);
        } else {
          fragment.appendChild(document.createTextNode(match[0]));
        }
        last = match.index + match[0].length;
      }
      fragment.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(fragment, node);
    });
  }

  refreshTokens() {
    $('[data-rules-var]').each((index, element) => {
      const name = element.getAttribute('data-rules-var');
      if (name in this.store.values) element.textContent = formatValue(this.store.values[name]);
    });
  }
}

export default new Rules();
