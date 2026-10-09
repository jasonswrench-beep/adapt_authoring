import a11y from 'core/js/a11y';
import ComponentView from 'core/js/views/componentView';
import { buttonLabel, canGo, clamp, progressText, targetForKey } from './slidesLogic';

class SlidesView extends ComponentView {

  events() {
    return {
      'click .js-slides-back': 'onBack',
      'click .js-slides-next': 'onNext',
      'click .js-slides-dot': 'onDot',
      'keydown .js-slides-region': 'onKeyDown',
      'swipeleft .js-slides-stage': 'onNext',
      'swiperight .js-slides-stage': 'onBack'
    };
  }

  initialize(...args) {
    super.initialize(...args);
    this.index = 0;
    this.furthest = 0;
    this.started = false;
  }

  get count() {
    return this.model.getChildren().length;
  }

  postRender() {
    // listens for "scrolled into view" (the callback is not used: completion is decided by the slides seen)
    this.setupInviewCompletion('.component__inner', () => {});
    this.setReadyStatus();
    this.showSlide(0, { focus: false, visit: false });
  }

  // The first slide only counts as seen once the learner can actually see it.
  onInview(event, visible, ...rest) {
    super.onInview(event, visible, ...rest);
    if (!visible || this.started) return;
    this.started = true;
    this.markSeen(this.index);
  }

  onBack(event) {
    event.preventDefault();
    this.go(this.index - 1, { focus: true });
  }

  onNext(event) {
    event.preventDefault();
    this.go(this.index + 1, { focus: true });
  }

  onDot(event) {
    event.preventDefault();
    this.go(Number($(event.currentTarget).attr('data-index')), { focus: true });
  }

  onKeyDown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
    const target = targetForKey(event.key, this.index, this.count, document.documentElement.dir === 'rtl');
    if (target === null) return;
    if (target !== this.index) {
      event.preventDefault();
      this.go(target, { focus: true });
    }
  }

  go(target, { focus }) {
    if (!canGo({ target, count: this.count, furthest: this.furthest, isSequenced: this.model.get('_isSequenced') })) return;
    if (target === this.index) return;
    this.showSlide(target, { focus, visit: true });
  }

  showSlide(index, { focus, visit }) {
    index = clamp(index, this.count);
    this.index = index;
    this.furthest = Math.max(this.furthest, index);
    const items = this.model.toJSON()._items;
    const $slides = this.$('.js-slides-slide');
    $slides.each((i, element) => {
      const active = i === index;
      element.hidden = !active;
      element.classList.toggle('is-active', active);
      // a clip must not keep playing behind a slide the learner has left
      if (!active) element.querySelectorAll('video, audio').forEach(media => media.pause());
    });
    this.$('.js-slides-dot').each((i, element) => {
      const $dot = $(element);
      $dot.toggleClass('is-selected', i === index).toggleClass('is-visited', i <= this.furthest);
      $dot.attr('aria-current', i === index ? 'true' : null);
      const blocked = this.model.get('_isSequenced') && i > this.furthest + 1;
      $dot.toggleClass('is-disabled', blocked).attr('aria-disabled', blocked ? 'true' : null);
    });
    this.setButton('.js-slides-back', buttonLabel('back', items, index, this.words()), index === 0);
    this.setButton('.js-slides-next', buttonLabel('next', items, index, this.words()), index === this.count - 1);
    this.$('.js-slides-progress').text(progressText(this.model.get('_progressText'), index + 1, this.count));
    if (visit && this.started) this.markSeen(index);
    if (focus) $slides.eq(index).trigger('focus');
  }

  // An item counts as seen once it has been shown; seeing them all (or the last one) completes the component.
  markSeen(index) {
    this.model.setActiveItem(index);
    const item = this.model.getItem(index);
    if (item) item.toggleVisited(true);
  }

  words() {
    return { next: this.model.get('_nextText'), back: this.model.get('_backText') };
  }

  setButton(selector, label, disabled) {
    this.$(selector)
      .toggleClass('is-disabled', disabled)
      .attr('aria-disabled', disabled ? 'true' : null)
      .attr('aria-label', label);
  }
}

SlidesView.template = 'slides.jsx';

export default SlidesView;
