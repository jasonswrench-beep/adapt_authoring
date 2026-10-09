# H5P activity library

Ready-made H5P activities for the H5P Player component (the **Choose an H5P activity** button in the editor).

| File | Purpose |
| --- | --- |
| `catalogue.json` | The gallery's entries: title, category, summary, "best for", completion mode (`activity` = the learner answers it, `viewed` = complete when seen), notes |
| `content/*.h5p` | Content-only H5P files (no player code inside) |
| `lock.json` | Every library needed (found by `resolve.js`), pinned to a commit |
| `repo-overrides.json` | Where a library's source is when it is not `github.com/h5p/h5p-<name>` |
| `patches/` | Fixes for upstream bugs, applied to the pinned commit before building (`H5P.InfoWall-0.4`: the filter box crashed) |
| `thumbs/*.jpg` | Gallery pictures, made by `render-check.js` |
| `requirements.js` | Lists the libraries a set of content files needs, including sub-content |
| `resolve.js` | Finds each library's source and writes `lock.json` |
| `install.js` | Installs the locked libraries (builds them if needed); run by the update routine |
| `assemble.js` | Combines an activity with its libraries into a complete `.h5p` |
| `render-check.js` | Opens every activity in the real player; reports failures; makes thumbnails |

## Adding an activity

1. Put the `.h5p` file in `content/` and add an entry to `catalogue.json`.
2. `node requirements.js content > /tmp/req.json`, then `node resolve.js /tmp/cache /tmp/req.json lock.json` (needs git and the internet). Add `repo-overrides.json` entries for libraries it cannot find.
3. `node install.js /tmp/libs`, then `node render-check.js /tmp/libs thumbs <id>` and check it started cleanly.
4. Choose `completion` honestly: use `activity` only if the activity reports a result (check by answering it in a course and watching the component complete).

Run the unit tests with `node --test adapt-plugins/test/h5p-library.test.js`.
