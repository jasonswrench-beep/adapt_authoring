import components from 'core/js/components';
import LessonsMenuView from './LessonsMenuView';
import LessonsMenuModel from './LessonsMenuModel';

// Use as default "_type": "course" or "_type": "menu" view.
// Note: This is necessary to maintain legacy behaviour in the AAT where
// only one menu is usable per course and the course / menu is assumed to be
// a core model and use the only installed MenuView.
components.register('course menu', {
  view: LessonsMenuView,
  model: LessonsMenuModel
});

// Use for "_component": "lessonsMenu", or "_view": "lessonsMenu" and "_model": "lessonsMenu"
components.register('lessonsMenu', {
  view: LessonsMenuView,
  model: LessonsMenuModel
});
