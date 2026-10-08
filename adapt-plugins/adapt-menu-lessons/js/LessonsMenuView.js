import device from 'core/js/device';
import MenuView from 'core/js/views/menuView';
import LessonsMenuItemView from './LessonsMenuItemView';
import LessonsMenuGroupView from './LessonsMenuGroupView';

class LessonsMenuView extends MenuView {

  className() {
    const backgroundImages = this.model.get('_lessonsMenu')?._backgroundImage;
    const backgroundImage = backgroundImages?.[`_${device.screenSize}`] ?? backgroundImages?._small;
    const textAlignment = this.model.get('_lessonsMenu')?._menuHeader?._textAlignment;

    return [
      `${super.className()} lessons`,
      backgroundImage && 'has-bg-image',
      textAlignment?._title && `title-align-${textAlignment._title}`,
      textAlignment?._subtitle && `subtitle-align-${textAlignment._subtitle}`,
      textAlignment?._body && `body-align-${textAlignment._body}`,
      textAlignment?._instruction && `instruction-align-${textAlignment._instruction}`
    ].join(' ');
  }

  initialize() {
    super.initialize();
  }

  addChildren() {
    // LessonsMenu renders all children in a single pass. Ignore subsequent calls
    // (e.g. triggered by trickle:kill) that would otherwise append a second
    // full set of child views and duplicate the menu items.
    if (this.getChildViews()) return;
    let nthChild = 0;
    const models = this.model.getChildren().models;
    const totalChild = this.model.getChildren().where({
      _isHidden: false
    }).length;

    const childViews = [];
    models.forEach(model => {
      if (!model.get('_isAvailable')) return;

      if (model.get('_isHidden')) {
        model.set('_isReady', true);
        return;
      }

      nthChild++;
      model.set({
        _nthChild: nthChild,
        _totalChild: totalChild,
        _isRendered: true
      });

      const ChildView = (model.get('_type') === 'menu' && model.get('_lessonsMenu') && model.get('_lessonsMenu')._renderAsGroup) ?
        LessonsMenuGroupView :
        LessonsMenuItemView;

      const $parentContainer = this.$(this.constructor.childContainer);
      const childView = new ChildView({ model });

      childViews.push(childView);

      $parentContainer.append(childView.$el);
    });

    this.setChildViews(childViews);
  }

}

LessonsMenuView.template = 'lessonsMenu.jsx';

export default LessonsMenuView;
