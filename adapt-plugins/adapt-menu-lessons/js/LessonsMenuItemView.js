import MenuItemView from 'core/js/views/menuItemView';
import router from 'core/js/router';

class LessonsMenuItemView extends MenuItemView {

  className() {
    return `${super.className()} lessons-item`;
  }

  events() {
    return {
      'click .js-btn-click': 'onClickMenuItemButton'
    };
  }

  onClickMenuItemButton(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (this.model.get('_isLocked')) return;
    router.navigateToElement(this.model.get('_id'));
  }
}

LessonsMenuItemView.template = 'lessonsMenuItem.jsx';

export default LessonsMenuItemView;
