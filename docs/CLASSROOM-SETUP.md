# Classroom setup: a Rise-style Adapt authoring server

This fork packages adapt_authoring (0.11.5) with Adapt Framework 5.56.3 and a curated plugin bundle so students get a Rise-like authoring experience from day one.

## Deploy (hosted server)

```bash
cp .env.example .env      # set ADAPT_SU_EMAIL / ADAPT_SU_PASSWORD
docker compose up -d --build
docker compose logs -f adapt   # first run takes several minutes
```

Then open `http://<server>:5000` and log in as the super user. Create student accounts in **User management**. Put a reverse proxy (Caddy/nginx) with HTTPS in front before real student use.

First run does: install authoring tool and framework, install the plugin bundle from GitHub, build the front end. Data lives in the `adapt_app` and `mongo_data` Docker volumes; back both up.

## Updating a running server

New code reaches the server in a few steps (source is copied into the persistent volume only on first start, so `git pull` alone changes nothing). Run these on the server:

```bash
cd ~/adapt_authoring
git pull
docker compose build adapt
docker compose stop adapt
docker compose run --rm --entrypoint /usr/local/bin/update.sh adapt
docker compose up -d
```

`update.sh` copies the new source into the volume (keeping `conf/config.json`, courses, users and uploads), updates dependencies, installs any new plugins from `conf/plugin-bundle.json`, and rebuilds the editor. It takes a few minutes. A plugin that is already installed at the same version is skipped, so **change a local plugin's version in its `bower.json` and `package.json` whenever you change its `properties.schema`**; otherwise the editor keeps the old settings form. The first Preview after an update is slower than usual. After an update, open the arrow next to **Preview** and choose **Force rebuild** once, so the preview is built fresh with the new code.

## Why a custom plugin installer

The stock tool installs plugins through a Bower registry hosted on Heroku (`adapt-bower-repository.herokuapp.com`) and silently skips any plugin that fails. `scripts/install-plugin-bundle.js` instead clones each plugin from GitHub (or, for the five plugins in `adapt-plugins/`, copies them from this repository), picks the newest release compatible with the installed framework, and registers it through the tool's own `importPackage`. The list is `conf/plugin-bundle.json`; each entry notes its Rise/Storyline analogue.

## Verification status (be aware)

| Piece | Status |
|---|---|
| All 48 bundle entries resolve (45 from GitHub plus 3 local) to a release compatible with framework 5.56.3, with a schema and a recognised type | Checked against the live GitHub repos |
| Installer script and export-format changes: JavaScript syntax | Checked |
| SCORM / Web export buttons | **Not run** |
| Docker build, first-run install, plugin registration against MongoDB, and the editor UI | **Not run** (no Docker daemon or MongoDB where this was written). Expect to fix small issues on your first deploy. |

Entries marked `"community": true` in `conf/plugin-bundle.json` are not maintained by adaptlearning (mostly cgkineo, plus `nachocinalli/adapt-graphicCompare`). Test them before relying on them.

## Look and feel: the Modern theme and Lessons menu

`adapt-plugins/` holds a Rise-style theme (`adapt-theme-modern`) and course home page (`adapt-menu-lessons`): numbered lesson cards with Start / Continue / Review, the university brand colours (navy `#003E7E` for text, headings, buttons and navigation; orange `#F58426` as a decorative accent only) arranged so every text pairing meets WCAG AA contrast, and a system font stack (no Google Fonts requests). They install with the plugin bundle and are the default for new courses when present; the PowerPoint converter uses them too. See `adapt-plugins/README.md` for where each brand colour can safely be used (pure orange is only 2.56:1 on white, so it is never used for text), how to change the palette, and what was verified (built with the real framework, driven in a browser, axe-core clean). No logo is included. The brand manual page supplied (p. 22) mentions web-safe alternatives on p. 21, which were not available; if that page defines official AA-safe alternatives, send it and the palette can be aligned.

## H5P activities

`adapt-plugins/adapt-component-h5p` adds an **H5P Player** component: upload a `.h5p` file to the asset library, pick it in the component, and the activity plays inside the course, self-hosted, so it also works in Web and SCORM exports. It completes when the learner finishes the activity. The authoring tool unpacks the file automatically when the course is previewed or published (`plugins/output/adapt/h5pPackaging.js`, with path-traversal and size protection). See `adapt-plugins/adapt-component-h5p/README.md` for the steps, how it works and its limits.

**Approval:** an `.h5p` file contains JavaScript, so a new file is never unpacked or run until an administrator approves it. Students see "waiting for an instructor to approve it" in preview, and downloads are refused until then. The administrator clicks **H5P approvals** in the editor sidebar (Super Admin only, enforced by the server's role permissions), sees each file's title, libraries and the courses using it, and approves or rejects it. Files **you** (an administrator) upload are approved automatically and badged in the dialog, where you can still choose Do not approve; switch this off with `h5pTrustAdminUploads: false`. Approval is per exact file (by hash) and is stored in `data/h5p-approvals.json`. Approving is a human judgement: check who uploaded the file and where it came from. See `adapt-plugins/adapt-component-h5p/README.md`.

**Activity library (no file needed):** in an H5P Player component, **Choose an H5P activity** (left sidebar) opens a gallery of 37 ready-made activities (quizzes, drag and drop, fill in the blanks, hotspots, timelines, course presentations, interactive video and more). Each card has a picture, a plain-language summary and a **Best for** line; search or filter by kind, then **Use this activity**. The activity is added to the asset library, pre-approved (it comes from this tool's own catalogue, not an upload), and the component's completion is set: activities that mark answers complete when answered, view-only ones complete when seen. Replace the example content afterwards by editing in the H5P editor (not part of this tool) or choose a different activity.

How it works: `h5p-library/content/` holds the content-only `.h5p` files; their player code is not inside them, so `h5p-library/install.js` fetches each library from its public source at the exact commit pinned in `h5p-library/lock.json` (76 libraries, mostly `github.com/h5p`), builds the ones that need it, and installs them into `data/h5p-libraries/` on the update routine's schedule (first run takes a few minutes; later runs only fetch what changed). `h5p-library/assemble.js` combines an activity with its libraries into a normal complete `.h5p` when it is first chosen. `node h5p-library/render-check.js <libraryDir>` opens every activity in the real player and reports any that fail to start (all 37 start cleanly); the gallery pictures were made that way. Known limits: Speak the Words needs a microphone and a browser with speech recognition; Impressive Presentation is alpha software; completion for view-only activities means "seen", not "used".

Also: H5P scores are not passed to the LMS (completion is); each activity adds roughly its unpacked size to the package. Tested with a real H5P file and a real framework build in a browser, including the approval lifecycle; **the approvals dialog, its buttons and the trusted-uploader check (which reads uploader permissions from the live database) have not yet been run against a live editor**.

## Variables and triggers (Storyline-style)

`adapt-plugins/adapt-extension-rules` adds Storyline-style **variables** (number, text, true/false) and **trigger rows**: *when* the course opens, an element is viewed or completed, a question is answered correctly or incorrectly, a button is pressed, or a variable changes, *then* set or add to a variable, show or hide something, jump to a page or element, pop up a message or mark something complete, optionally *only if* a variable meets a condition. Show a variable in any text with `[[Score]]`. Elements are targeted by a class you type into their Classes box in the editor. In SCORM the variables are saved with the learner's progress. See `adapt-plugins/adapt-extension-rules/README.md`. Tested in a real framework build in headless Chromium and with unit tests; **not yet tried in the editor** (the Variables and Triggers boxes). It is not a copy of Storyline's engine: there are no layers, timelines or free-form slides, but the message pop-up, show/hide and go-to cover most layer-style needs.

## Slides (stepped deck)

`adapt-plugins/adapt-component-slides` adds a **Slides** component: one slide at a time with Back/Next, a "Slide 2 of 5" counter, progress dots, an optional image per slide, an optional "must be seen in order" setting, and completion when every (or the last) slide has been seen. Keyboard (arrows, Home, End), swipe and screen-reader behaviour are built in. Tested in a real framework build in headless Chromium (24 checks) and with axe-core; **not yet tried in the editor** (slide list, image picker). See `adapt-plugins/adapt-component-slides/README.md`.

## Exporting: SCORM and Web

Spoor (the tracking extension SCORM needs) is added to every **new** course automatically (`addedByDefault` in `conf/plugin-bundle.json`, applied by the installer). A course created before that needs it added once under **Manage extensions**; without it the SCORM button explains this and the Web export still works. The Web package leaves out the SCORM launch files (`imsmanifest.xml`, the `.xsd` schemas, `index_lms.html` and the test pages), so an LMS cannot mistake it for a SCORM package.

The editor sidebar now has two buttons in place of the single Publish button:

- **Download SCORM package** - forces tracking on (Spoor enabled) for this export, giving a zip for an LMS, named `<course>-scorm.zip`.
- **Download Web package** - forces tracking off, giving a zip you can host on any web server or open from a folder, named `<course>-web.zip`.

Neither changes the course's saved settings; the choice only applies to the exported copy. SCORM export requires the **Spoor** extension to be added to the course (Extensions in the editor); otherwise you get a clear error. SCORM 1.2 is the default (widest LMS support); a course can switch to 2004 in its Spoor settings, and completion/pass criteria are set there too.

Implementation: `format=scorm|web` query parameter handled in `plugins/output/adapt/publish.js`; buttons in `part_editorCommon.hbs`. Not yet tested against a running instance - please try both buttons, and test the SCORM zip in your LMS or SCORM Cloud.

## Importing PowerPoint and Google Slides

Two ways in. **Into a page you are building:** add a **Slides** component, open its settings and click **Import PowerPoint** in the sidebar; its slides are replaced by the deck's slides, and the pictures go into the asset library. **As a whole new course:** on the dashboard choose **Import source** and select a `.pptx` file (for Google Slides use *File → Download → Microsoft PowerPoint (.pptx)* first). The server converts it and creates a course with one page holding a **Slides** component: one step per slide with Back/Next, the slide's text, bullets and tables, its first picture (with the alt text from the deck), and an embedded video or audio clip (MP4/WebM/M4V, MP3/M4A/WAV/OGG; AVI, WMV and similar are skipped with a message). Hidden slides are skipped. Older `.ppt` files must be re-saved as `.pptx`.

Not converted: animations, transitions, positions, fonts and colours, charts and SmartArt, a second picture or clip on one slide, speaker notes. Imported media needs a transcript (and captions for video): the dialog reminds you and the accessibility check flags it. Pictures without alt text are listed in the server log and the accessibility checker will flag them. The same converter is available on a command line with other layouts (`scripts/pptx-import/README.md`). The server self-test imports a sample deck and previews it. Tested end to end here: the converted course builds with the real framework and steps through correctly in a browser; **the Import source page itself has not been tried by a person yet**.

## Accessibility

- **Default changed:** the stock authoring tool created every new course with the framework's accessibility master switch (`_accessibility._isEnabled`) **off**. In framework 5 that switch controls focus management, hiding background content from screen readers behind popups/the drawer, popup focus trapping and keyboard focus outlines. This fork now creates courses with it **on** (`plugins/content/config/index.js` and `model.schema`). Courses created before this change keep their old value; the checker flags them.
- **"Check accessibility" button:** in the editor sidebar, under the download buttons. It checks the saved course content immediately (missing alt text, videos without transcripts, vague links, tables without headers, missing page titles, framework accessibility switched off, and more) and shows a plain-language report with what to fix. The report offers a **full check** (about a minute): it builds the preview and runs axe-core on every page in a headless browser to catch colour contrast and screen reader markup problems. The full check needs Chromium and the checker's dependencies on the server; the Docker image installs both. If they are missing the quick check still works and the full check is simply not offered. Only one full check runs at a time.
- **Command line:** `scripts/a11y-check/` does the same on a Web export zip (see its README), useful for grading or CI. Both share one rule set (`scripts/a11y-check/content-rules.js`).
- **Not yet run in a live editor.** The server logic, report builder and rules have automated tests (`node --test scripts/a11y-check/test/*.test.js`), and the full-check path was run against a real framework build, and the editor front end compiles with the tool's own build (`grunt build:dev`: LESS, Handlebars, RequireJS, Babel) with the new button, module and styles present in the output. The button's behaviour, the dialog's appearance and the route itself have not been exercised in a running editor. For a server deployed before this change, follow *Updating a running server* (source is only copied into the volume on first start).
- **Limits:** automated checks cover only part of WCAG. Also test with a keyboard and a screen reader.

## Other projects reviewed

Findings from a web search plus direct checks of GitHub repos against framework 5.56.3. Only the "verified" items were actually tested.

| Project | What it offers | Status / recommendation |
|---|---|---|
| `cgkineo/adapt-tabs`, `cgkineo/adapt-search` | Tabs component; keyword search across the course | Verified compatible with 5.56.3; **added to the bundle** |
| `cgkineo/adapt-audio` | Audio playback extension | Compatible by version, but ships no `properties.schema`, so the authoring tool would ignore it. Not added |
| `danielstorey/adapt-dragndrop` | Drag-and-drop question (a core Storyline interaction) | Targets framework ~2.0, last updated 2017: **does not install on 5.x**. Best treated as a Phase 3 port or rewrite |
| [H5P](https://h5p.org) and the [Lumi](https://lumi.education) desktop editor | 40+ interactive content types (Course Presentation, Interactive Video, Branching Scenario, drag-and-drop); Lumi exports SCORM and standalone HTML | Not an Adapt plugin, so a self-hosted **H5P Player component was built** (see *H5P activities*): drag-and-drop, flip cards, hotspots and similar Storyline-style interactions can be authored in H5P and embedded |
| Xerte, eXe | Other open-source authoring tools with SCORM output | Alternatives rather than components; not evaluated in depth |

### Review of the `adaptlearning` GitHub organization

Jason supplied the org's repository list; every plugin not already in the bundle was checked against framework 5.56.3 (v5.56.3 is the newest framework release tag).

- **Added:** `adapt-youtube`, `adapt-vimeo`, `adapt-contrib-triggered` (button-triggered reveal, the nearest thing to a Storyline trigger), `adapt-contrib-contentObjectTransition`, `adapt-contrib-instructionError`, `adapt-contrib-trackingErrors`.
- **Compatible but not added:** `adapt-contrib-xapi` (xAPI tracking; add it only if you need xAPI, and don't run it alongside Spoor on the same course without testing); `adapt-contrib-pointGmcq` (hotspot-style question, but the repo is archived).
- **Unusable in the authoring tool:** `adapt-contrib-scoring`, `scoringResults`, `scoringAssessment` ship no `properties.schema`, so the tool ignores them.
- **Unreleased:** `randomise`, `banking`, `modifiers` have no release tags yet.
- **Too old:** `adapt-contrib-assessmentResultsTotal` (no release compatible with 5.x).
- Skeletons, tooling and docs repos (`adapt-component`, `adapt-extension`, `adapt-questionComponent`, `adapt-cli`, etc.) are not course plugins.

Community plugins outside this org (in the plugin browser registry) are still unreviewed.

### Community plugin candidates supplied from the plugin browser

28 repositories were checked against framework 5.56.3: release tags, declared framework range, schema file, last commit, and whether the code uses framework-2/3 imports (`coreJS/...`), which no longer exist in 5.x.

- **Added (9):** `adapt-iframe`, `adapt-list`, `adapt-graphicCompare`, `adapt-articleBlockSlider`, `adapt-pageIncompletePrompt`, `adapt-homeButton`, `adapt-close`, `adapt-submitAll`, `adapt-hint`. All declare 5.x support, use current imports, and (except graphicCompare, 2023) were updated in 2023-2026.
  - `adapt-articleBlockSlider` turns a section into slide-by-slide navigation, the closest thing available to Storyline-style slides.
  - `adapt-iframe` is the route for embedding H5P activities, Google Slides ("publish to web") and other web content.
- **Candidates to test in a scratch course first, not bundled:** `danielstorey/adapt-backgroundScroll` (2019, modern imports, declares >=3.0) and `LearnChamp/adapt-table` (2017, modern imports, declares >=2.0).
- **Not usable on framework 5:** `ExultCorp/adapt-contrib-flipcard`, `BATraining/adapt-dragAndDrop-public`, `BATraining/adapt-hotSpot-public`, `danielstorey/adapt-expose`, `adapt-flipper`, `adapt-stacklist`, `kingsonline/adapt-chat`, `adapt-contents`, `adapt-h5p`, `gowithfloat/adapt-course-progress`, `mike-st/adapt-before-and-after` (last commit was a README edit; the code is still framework-2 style). They import `coreJS/...` or declare framework 2.x. Porting is possible but is real development work.
- **No `properties.schema`, so the authoring tool ignores them:** `mike-st/adapt-dragndropwithimage`, `LearningPool/adapt-contrib-blockslider`, `martinsandberg/adapt-order`, `adamlaird/adapt-menu-singlePageCourse`, `SpongeUK/adapt-courseReset`, `kirsty-hames/adapt-iceCream`.

Consequence for the Storyline goal: no maintained, authoring-tool-ready drag-and-drop, flip-card or hotspot-with-layers plugin exists among these. Those would need to be built or ported (Phase 3).

Not found in this search: Adapt-compatible timeline, hotspot-with-layers, or scenario plugins (hotspot-style content is partly covered by `adapt-contrib-hotgraphic`). Compare the Adapt plugin browser before building any of these yourself.

## What this is and isn't

Adapt is page, block and component based with a responsive scrolling layout. That maps well to **Rise**. It has no free-form slide canvas, timeline, or Storyline-style triggers/variables/layers. The bundle gets you the closest practical approximation (Tutor feedback ≈ feedback layers, Branching ≈ simple conditional paths, Trickle ≈ gated progression).

## Roadmap toward Storyline/Captivate-style features

1. **Phase 1 (this change):** plugin bundle, hosted deploy, default theme.
2. **Phase 2, polish:** custom theme/menu so new courses look like Rise lesson cards; default course template with pre-built pages (title, content, knowledge check, results); trim the editor's plugin list to the bundle for simpler student UX.
3. **Phase 3, Storyline-like:** custom components (e.g. drag-and-drop, hotspot-with-layers, slide-style stepped component), (a variable/trigger extension now exists, see *Variables and triggers*), and a simplified "slide" authoring view. This is real development work on both the framework and the editor front end (`frontend/src`).

Decisions needed for Phase 2: institutional branding (colours, logo), whether LMS delivery (SCORM/xAPI via spoor) is required, and how many students will use the server at once.
