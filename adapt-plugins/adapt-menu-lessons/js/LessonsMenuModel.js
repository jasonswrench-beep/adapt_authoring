import MenuModel from 'core/js/models/menuModel';

export default class LessonsMenuModel extends MenuModel {

  getTypeGroup() {
    if (!this.get('_lessonsMenu')?._renderAsGroup) return;
    return 'group';
  }

}
