# adapt-menu-lessons

A course home page that lists lessons as numbered cards, each with a text status (Not started / In progress / Completed) and a Start / Continue / Review button. Forked from `adapt-contrib-boxMenu` (GPL-3.0).

The visual styling lives in `adapt-theme-modern` (`less/plugins/adapt-menu-lessons`), following the Adapt convention that a menu supplies structure and the theme supplies appearance. With a different theme the menu still works but is unstyled beyond layout. See `../README.md` for details.

## Settings

Course-level labels (Start/Continue/Review text and the three status labels) are under the menu's globals and are translatable. The menu keeps the stock box menu's header image/background options under `_lessonsMenu`.
