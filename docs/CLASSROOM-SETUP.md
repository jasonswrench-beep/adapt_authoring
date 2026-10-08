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

Re-run the plugin installer any time (for example after editing `conf/plugin-bundle.json`):

```bash
docker compose stop adapt && docker compose run --rm --entrypoint "" adapt node scripts/install-plugin-bundle.js && docker compose start adapt
```

## Why a custom plugin installer

The stock tool installs plugins through a Bower registry hosted on Heroku (`adapt-bower-repository.herokuapp.com`) and silently skips any plugin that fails. `scripts/install-plugin-bundle.js` instead clones each plugin from GitHub, picks the newest release compatible with the installed framework, and registers it through the tool's own `importPackage`. The list is `conf/plugin-bundle.json`; each entry notes its Rise/Storyline analogue.

## Verification status (be aware)

| Piece | Status |
|---|---|
| All 30 bundle plugins resolve to a release compatible with framework 5.56.3, with a schema and a recognised type | Checked against the live GitHub repos |
| Installer script and export-format changes: JavaScript syntax | Checked |
| SCORM / Web export buttons | **Not run** |
| Docker build, first-run install, plugin registration against MongoDB, and the editor UI | **Not run** (no Docker daemon or MongoDB where this was written). Expect to fix small issues on your first deploy. |

Four bundle entries (`adapt-hotgrid`, `adapt-visua11y`, `adapt-tabs`, `adapt-search`) are community plugins by cgkineo, not adaptlearning.

## Exporting: SCORM and Web

The editor sidebar now has two buttons in place of the single Publish button:

- **Download SCORM package** - forces tracking on (Spoor enabled) for this export, giving a zip for an LMS, named `<course>-scorm.zip`.
- **Download Web package** - forces tracking off, giving a zip you can host on any web server or open from a folder, named `<course>-web.zip`.

Neither changes the course's saved settings; the choice only applies to the exported copy. SCORM export requires the **Spoor** extension to be added to the course (Extensions in the editor); otherwise you get a clear error. SCORM 1.2 is the default (widest LMS support); a course can switch to 2004 in its Spoor settings, and completion/pass criteria are set there too.

Implementation: `format=scorm|web` query parameter handled in `plugins/output/adapt/publish.js`; buttons in `part_editorCommon.hbs`. Not yet tested against a running instance - please try both buttons, and test the SCORM zip in your LMS or SCORM Cloud.

## Other projects reviewed

Findings from a web search plus direct checks of GitHub repos against framework 5.56.3. Only the "verified" items were actually tested.

| Project | What it offers | Status / recommendation |
|---|---|---|
| `cgkineo/adapt-tabs`, `cgkineo/adapt-search` | Tabs component; keyword search across the course | Verified compatible with 5.56.3; **added to the bundle** |
| `cgkineo/adapt-audio` | Audio playback extension | Compatible by version, but ships no `properties.schema`, so the authoring tool would ignore it. Not added |
| `danielstorey/adapt-dragndrop` | Drag-and-drop question (a core Storyline interaction) | Targets framework ~2.0, last updated 2017: **does not install on 5.x**. Best treated as a Phase 3 port or rewrite |
| [H5P](https://h5p.org) and the [Lumi](https://lumi.education) desktop editor | 40+ interactive content types (Course Presentation, Interactive Video, Branching Scenario, drag-and-drop); Lumi exports SCORM and standalone HTML | Not an Adapt plugin. Worth evaluating as a *companion* for the Storyline-style interactions Adapt lacks, e.g. embedding H5P output in an Adapt page. Not tested here |
| Xerte, eXe | Other open-source authoring tools with SCORM output | Alternatives rather than components; not evaluated in depth |

Not found in this search: Adapt-compatible timeline, hotspot-with-layers, or scenario plugins (hotspot-style content is partly covered by `adapt-contrib-hotgraphic`). Compare the Adapt plugin browser before building any of these yourself.

## What this is and isn't

Adapt is page, block and component based with a responsive scrolling layout. That maps well to **Rise**. It has no free-form slide canvas, timeline, or Storyline-style triggers/variables/layers. The bundle gets you the closest practical approximation (Tutor feedback ≈ feedback layers, Branching ≈ simple conditional paths, Trickle ≈ gated progression).

## Roadmap toward Storyline/Captivate-style features

1. **Phase 1 (this change):** plugin bundle, hosted deploy, default theme.
2. **Phase 2, polish:** custom theme/menu so new courses look like Rise lesson cards; default course template with pre-built pages (title, content, knowledge check, results); trim the editor's plugin list to the bundle for simpler student UX.
3. **Phase 3, Storyline-like:** custom components (e.g. drag-and-drop, hotspot-with-layers, slide-style stepped component), a variable/trigger extension, and a simplified "slide" authoring view. This is real development work on both the framework and the editor front end (`frontend/src`).

Decisions needed for Phase 2: institutional branding (colours, logo), whether LMS delivery (SCORM/xAPI via spoor) is required, and how many students will use the server at once.
