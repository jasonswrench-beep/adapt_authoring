import ItemsComponentModel from 'core/js/models/itemsComponentModel';

export default class SlidesModel extends ItemsComponentModel {

  // _setCompletionOn "lastSlide": complete as soon as the final slide has been seen (default: every slide)
  areAllItemsCompleted() {
    if (this.get('_setCompletionOn') === 'lastSlide') {
      const last = this.getItem(this.getChildren().length - 1);
      return Boolean(last && last.get('_isVisited'));
    }
    return super.areAllItemsCompleted();
  }
}
