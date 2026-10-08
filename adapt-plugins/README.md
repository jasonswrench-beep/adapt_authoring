# Rise-style look: Modern theme and Lessons menu

Two plugins for the authoring tool, forked from the Adapt core theme (`adapt-contrib-vanilla`) and menu (`adapt-contrib-boxMenu`), both GPL-3.0. They are installed by `scripts/install-plugin-bundle.js` (entries with a `path` in `conf/plugin-bundle.json`) and, when installed, are the default for **new** courses.

## `adapt-theme-modern`

- **Brand colours** from the university brand manual (p. 22): navy (PANTONE 281, `#003E7E`) for navigation, headings, links and buttons; orange (PANTONE 165, `#F58426`) as a decorative accent (the bar under titles). Rounded corners, bold headings, 1.6 line height.
- **System font stack** (`-apple-system`, Segoe UI, Roboto, ...): no request to Google Fonts, so no third-party tracking, faster loads and it works offline.
- Tighter vertical spacing than the stock theme (blocks 2rem, page title 2.5rem).
- All colours are LESS variables in `less/_defaults/_colors.less`. `node --test adapt-plugins/test/palette.test.js` re-checks WCAG AA contrast (4.5:1) for every text pairing and fails if the orange (or any lighter brand colour) is ever used as a text colour.
- Course-specific colour overrides still work through the editor's theme settings (the theme keeps the stock theme's variable schema).

### Where each brand colour can be used (measured contrast against white)

The brand manual warns that several of its colours fail WCAG 2.0 AA; these are the real numbers.

| Colour | Contrast on white | Use |
|---|---|---|
| Navy `#003E7E` | 10.55:1 | Text, headings, links, buttons (white text on it is also 10.55:1), navigation |
| Rust `#A84D10` (PANTONE 174) | 5.62:1 | The orange-family colour that is safe for text (the "In progress" label); white text on it passes too |
| Orange `#F58426` | 2.56:1 | **Decorative only**: bars, borders, or a background with near-black text (6.94:1). Never text, never a background for white text |
| Gold `#FDB924`, coral `#F26649`, sky `#10A6DB`, green `#B0BC22`, slate `#80A1B6` | 1.7 - 3.1:1 | Decorative backgrounds with near-black text only |
| Cream, mist, sage, warm grey, cool grey, sand (neutrals) | 1.1 - 2.1:1 | Surfaces and borders only |

The secondary and neutral colours are defined as `@brand-*` variables for custom styling but are not used by the theme itself.

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

Built with the real Adapt framework (5.56.3) in the brand colours and driven in headless Chromium: lesson list at desktop and phone widths; Start opens the lesson; after the lesson is read the card becomes Completed/Review; keyboard focus reaches the buttons; axe-core finds no violations on the menu or on content pages; building under a renamed theme/menu folder (as the authoring tool does) gives identical output. Palette contrast is unit tested. **Not yet run inside the authoring tool's editor** (theme picker, theme variable editor, preview/publish). Not tested on real iOS/Android devices or in Safari/Firefox.
