# H5P editor service

The H5P editor for the course authoring tool, built on [Lumi's h5p-nodejs-library](https://github.com/Lumieducation/H5P-Nodejs-library) (GPL-3.0). It runs as the `h5p-editor` service in `docker-compose.yml`.

**Not reachable from the internet.** The authoring tool forwards a signed-in author's requests to it (`routes/h5peditor/`, `plugins/output/adapt/h5pEditorClient.js`) after `POST /api/content/component/:id/h5peditor/start` has checked that the user may change that H5P Player component. Every forwarded request carries an HMAC signature (`auth.mjs`) made with a secret the two services share through the `h5p_shared` volume (created on first start). Requests without a valid signature get 401.

| File | Purpose |
| --- | --- |
| `server.mjs` | The service: the editor's own endpoints, the edit/new pages, and course-tool-only `internal/import`, `internal/export`, `internal/content` |
| `auth.mjs` | Request signing and checking |
| `permissions.mjs` | Authors may create, edit and export; only the course tool may install libraries (nobody can from the editor) |
| `renderer.mjs` | The editor page, with **Save to course** (it tells the course tool to take the finished activity) |
| `setup-core.sh` | Fetches the H5P browser scripts at pinned commits |
| `entrypoint.sh` | First start: secret, scripts, libraries (`../h5p-library/install.js --editor`), then the server |
| `sweep.mjs` | Opens every catalogue activity in the real editor (dev tool) |

How an edit goes: **Edit this activity** sends the component's current `.h5p` to the editor (`internal/import`) and opens it; the author edits and presses **Save to course**; the page saves in the editor, then asks the course tool (`.../h5peditor/finish`), which fetches the finished package (`internal/export`), approves it, stores it in the asset library, points the component at it and removes the editor's copy. Editor content nobody has finished with is removed after 14 days (`H5P_EDITOR_KEEP_DAYS`).

Tests: `node --test test/*.test.mjs` (add `NODE_PATH=<the authoring tool's node_modules>` for the signing-agreement test). The browser test needs a prepared data folder: set `H5P_EDITOR_TEST_DATA` and `H5P_EDITOR_TEST_PACKAGE` (see `test/editor-browser.test.mjs`).
