# PowerPoint → Adapt converter

Turns a `.pptx` deck into a zip for the authoring tool's **Import source** button, so students can start from a draft instead of an empty course. Google Slides works too: *File → Download → Microsoft PowerPoint (.pptx)*.

```bash
cd scripts/pptx-import && npm install          # once
node pptx-to-adapt.js my-deck.pptx             # writes my-deck-adapt.zip next to the deck
```

Then in the authoring tool: **Import source** → choose the zip.

## Options

| Option | Effect |
|---|---|
| `-o out.zip` | Output path |
| `--layout single` (default) | One scrolling page, each slide a titled section (Rise-like) |
| `--layout pages` | Each slide is its own page on the course menu |
| `--notes` | Add speaker notes under each slide |
| `--include-hidden` | Keep hidden slides (skipped by default) |
| `--title "..."` | Course title (default: the deck's title property, else first slide title) |
| `--theme name` / `--menu name` | Theme and menu plugins for the course (default: `adapt-theme-modern` and `adapt-menu-lessons`; they must be installed on the server) |
| `--classic` | Use the stock `adapt-contrib-vanilla` theme and `adapt-contrib-boxMenu` menu instead |
| `--lang en` / `--framework 5.56.3` | Two-letter language folder / framework version recorded in the zip (must share a major version with the installed framework) |

## What converts

- Slide titles → section/page titles.
- Text, bold, italic, http(s)/mailto links, bullet and numbered lists (nested).
- Tables → simple HTML tables.
- Pictures (png, jpg, gif, svg, webp) → graphic components, with alt text if the deck has it. Text + one image sit side by side.
- Speaker notes (optional).

## What does not convert (reported after each run)

Animations, transitions, slide layout/positions, fonts and colours, charts, SmartArt, embedded video/audio (links are kept as text), emf/wmf/tiff images, and images without alt text (listed so you can add it). Only the core `text` and `graphic` components are emitted, so the import never depends on optional plugins; enhance the draft in the editor (accordions, tabs, quizzes).

## Testing

`test/make_sample.py` builds a deck covering these cases (`pip install python-pptx pillow`); `test/validate.js` checks a generated zip against the constraints enforced by `plugins/output/adapt/importsourcecheck.js` and `importsource.js`. This has **not** been run through a live authoring tool yet; please import a real deck after your first deploy and report anything odd.
