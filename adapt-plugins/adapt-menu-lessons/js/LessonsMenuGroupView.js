import MenuItemView from 'core/js/views/menuItemView';
import LessonsMenuItemView from './LessonsMenuItemView';

class LessonsMenuGroupView extends MenuItemView {

  className() {
    return `${super.className()} lessons-group`;
  }

  postRender() {
    _.defer(this.addChildren.bind(this));
    this.$el.imageready(this.setReadyStatus.bind(this));
    this.$el.parents('.lessons__item-container').addClass('has-groups');
    this.updateItemCount();
  }

  updateItemCount() {
    const models = this.model.getChildren().where({
      _isHidden: false,
      _isAvailable: true
    });
    const totalChildren = models.length;
    models.forEach(model => model.set('_totalChild', totalChildren));
  }
}

LessonsMenuGroupView.template = 'lessonsMenuGroup.jsx';
LessonsMenuGroupView.childContainer = '.js-group-children';
LessonsMenuGroupView.childView = LessonsMenuItemView;

export default LessonsMenuGroupView;
