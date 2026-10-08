# Rise-style look: Modern theme and Lessons menu

Two plugins for the authoring tool, forked from the Adapt core theme (`adapt-contrib-vanilla`) and menu (`adapt-contrib-boxMenu`), both GPL-3.0. They are installed by `scripts/install-plugin-bundle.js` (entries with a `path` in `conf/plugin-bundle.json`) and, when installed, are the default for **new** courses.

## `adapt-theme-modern`

- Indigo palette on white with a dark navy navigation bar, rounded corners, bold headings, 1.6 line height.
- **System font stack** (`-apple-system`, Segoe UI, Roboto, ...): no request to Google Fonts, so no third-party tracking, faster loads and it works offline.
- Tighter vertical spacing than the stock theme (blocks 2rem, page title 2.5rem).
- All colours are LESS variables in `less/_defaults/_colors.less`. Change the palette block at the top of that file to re-brand; `node --test adapt-plugins/test/palette.test.js` re-checks WCAG AA contrast for every text pairing (4.5:1) so a new colour that fails is caught.
- Course-specific colour overrides still work through the editor's theme settings (the theme keeps the stock theme's variable schema).

## `adapt-menu-lessons`

A course home page that lists lessons as full-width cards:

- numbered badge, title, optional description, duration and image;
- a **status label written as text** (Not started / In progress / Completed; colour is only a hint) and a button that follows progress (Start / Continue / Review);
- the screen reader label includes the status, title and position ("Completed. Review Plan your week. Item 2 of 6.");
- the labels are editable (Course settings > Menu > Lessons Menu) and translatable;
- groups of lessons (menu sections) are supported as in the stock menu.

## Choosing them

New courses use them automatically when installed (`plugins/content/config/preferredLook.js`; if either is missing the stock theme/menu are used). For an existing course: editor sidebar > **Select theme** and **Menu settings**. The PowerPoint converter uses them by default (`--classic` for the stock look).

## Verification

Built with the real Adapt framework (5.56.3) and driven in headless Chromium: lesson list at desktop and phone widths; Start opens the lesson; after the lesson is read the card becomes Completed/Review; keyboard focus reaches the buttons; axe-core finds no violations on the menu or on content pages; building under a renamed theme/menu folder (as the authoring tool does) gives identical output. Palette contrast is unit tested. **Not yet run inside the authoring tool's editor** (theme picker, theme variable editor, preview/publish). Not tested on real iOS/Android devices or in Safari/Firefox.
