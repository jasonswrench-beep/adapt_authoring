# adapt-component-h5p (H5P Player)

Plays an uploaded **.h5p** file inside an Adapt course, self-hosted: no H5P server, no internet needed, and it works in Web and SCORM exports. Uses the MIT-licensed [h5p-standalone](https://github.com/tunapanda/h5p-standalone) 3.8.2 player (vendored, unmodified, in `assets/h5p-player/`; it bundles the GPL-3.0 H5P core).

## For authors

1. Build or download an activity as a `.h5p` file (H5P.com, Lumi, Moodle, WordPress with the H5P plugin, or [h5p.org examples](https://h5p.org/content-types-and-applications)). The file must contain its libraries, which is what "Download" gives you.
2. In the editor, open the **asset library** and upload the `.h5p` file.
3. Add the **H5P Player** component to a block, pick the file under *H5P activity*, and choose when it completes:
   - **completed** (default): when the learner finishes the activity (answers a question, or reaches the end of a presentation or video);
   - **inview**: as soon as it scrolls into view.
4. Preview, or download the Web/SCORM package. The `.h5p` file is unpacked automatically when the course is built.

## How it works

- `js/`: the component. It loads the player, starts each activity one at a time, names the iframe after the component title, and marks the component complete from H5P's xAPI statements (matched to the right activity with a per-component activity IRI, so several activities can share a page).
- `plugins/output/adapt/h5pPackaging.js` (authoring tool): after the build, unpacks each H5P component's file into `<build>/h5p/<componentId>/` and removes the packed copy. Extraction uses `yauzl`, rejects unsafe paths, and limits the number of files (5,000), each file (100 MB) and the total (250 MB).

## Limits and cautions

- **An H5P file is a program.** It contains JavaScript that runs in the learner's browser, in the same site as the course. Only use `.h5p` files you trust. If students upload their own, an uploaded file can run code when anyone, including an instructor previewing in the editor, opens that course. Review student H5P files first, or restrict who may upload them.
- **Completion only, not scores.** H5P scores are not sent to the LMS; SCORM gets completion through Adapt's normal tracking.
- Each activity is unpacked with its own copy of its libraries, so the course package grows by roughly the size of the unpacked file per activity (a simple True/False is about 1.3 MB).
- The activity keeps H5P's own look; the brand theme does not restyle the inside of H5P content.
- Accessibility depends on how the activity was built. The accessibility checker lists every H5P activity for manual review and cannot look inside the frame.
- The asset library's upload size limit applies (`maxFileUploadSize` in the server config).

## Verification

Tested with a real H5P file (the True/False sample from the h5p-standalone project) in a real framework 5.56.3 build, driven in headless Chromium: the question renders, the iframe is named, answering completes the component, and with two activities on one page answering one completes only that one. The export step has unit tests for hostile archives (path traversal, absolute paths, too many files, oversized, not a zip, not H5P), reused files and re-exports. **Not yet run inside the authoring tool's editor** (asset upload of a `.h5p`, the component picker, preview/publish), in Safari or Firefox, or inside a real LMS.
