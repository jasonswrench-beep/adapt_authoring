# adapt-component-h5p (H5P Player)

Plays an uploaded **.h5p** file inside an Adapt course, self-hosted: no H5P server, no internet needed, and it works in Web and SCORM exports. Uses the MIT-licensed [h5p-standalone](https://github.com/tunapanda/h5p-standalone) 3.8.2 player (vendored, unmodified, in `assets/h5p-player/`; it bundles the GPL-3.0 H5P core).

## For authors

1. Build or download an activity as a `.h5p` file (H5P.com, Lumi, Moodle, WordPress with the H5P plugin, or [h5p.org examples](https://h5p.org/content-types-and-applications)). The file must contain its libraries, which is what "Download" gives you.
2. In the editor, open the **asset library** and upload the `.h5p` file.
3. Add the **H5P Player** component to a block, pick the file under *H5P activity*, and choose when it completes:
   - **completed** (default): when the learner finishes the activity (answers a question, or reaches the end of a presentation or video);
   - **inview**: as soon as it scrolls into view.
4. Preview. **A new `.h5p` file has to be approved by an administrator first** (see *Approval* below): until then the preview shows "This activity is waiting for an instructor to approve it", and downloading or publishing the course is refused. Once approved, preview again (use *Force rebuild* in the Preview menu if it still shows the notice) and download the Web/SCORM package as usual.

## How it works

- `js/`: the component. It loads the player, starts each activity one at a time, names the iframe after the component title, and marks the component complete from H5P's xAPI statements (matched to the right activity with a per-component activity IRI, so several activities can share a page).
- `plugins/output/adapt/h5pPackaging.js` (authoring tool): after the build, unpacks each **approved** H5P component's file into `<build>/h5p/<componentId>/` and removes the packed copy. Unapproved files are left packed and the activity folder gets a `status.json` that the player reads. Extraction uses `yauzl`, rejects unsafe paths, and limits the number of files (5,000), each file (100 MB) and the total (250 MB).

## Approval (administrators)

An `.h5p` file contains JavaScript, so an uploaded file is **never unpacked or run until an administrator has approved that exact file**. This protects the instructor previewing a student's course, and anyone who later opens an exported package.

1. A student adds an H5P Player component. Previewing shows the "waiting for approval" notice; nothing from the file runs.
2. The administrator opens any course in the editor and clicks **H5P approvals** in the sidebar (only users with the Super Admin role see it, and the server only answers them).
3. The dialog lists each waiting file with its title, file name and size, the H5P content type and libraries, and which courses use it. **Approve** or **Do not approve**. Approved files can later be withdrawn.
4. After approval the student previews again (*Force rebuild* in the Preview menu if needed). Downloading or publishing a course that still contains an unapproved file is refused with a message naming the file.

How approval works: files are identified by the SHA-256 of their bytes, so approving one file approves nothing else, and a changed file needs approving again. The same file in other courses is approved once. Decisions are stored in `data/h5p-approvals.json` (in the Docker volume). If that file is unreadable the server refuses to unpack anything rather than treating files as approved.

What to check before approving: who uploaded it, and where it came from (your own work, H5P.org, Lumi). The dialog shows the libraries it uses but cannot tell you whether the content is safe.

## Limits and cautions

- **An H5P file is a program**, so approval is a human judgement, not a scan. Approving a file means you trust it: once approved it runs JavaScript in the browser of everyone who opens the course (including you, previewing in the editor).
- **Completion only, not scores.** H5P scores are not sent to the LMS; SCORM gets completion through Adapt's normal tracking.
- Each activity is unpacked with its own copy of its libraries, so the course package grows by roughly the size of the unpacked file per activity (a simple True/False is about 1.3 MB).
- The activity keeps H5P's own look; the brand theme does not restyle the inside of H5P content.
- Accessibility depends on how the activity was built. The accessibility checker lists every H5P activity for manual review and cannot look inside the frame.
- The asset library's upload size limit applies (`maxFileUploadSize` in the server config).

## Verification

Tested with a real H5P file (the True/False sample from the h5p-standalone project) in a real framework 5.56.3 build, driven in headless Chromium: the question renders, the iframe is named, answering completes the component, and with two activities on one page answering one completes only that one. The export step has unit tests for hostile archives (path traversal, absolute paths, too many files, oversized, not a zip, not H5P), reused files and re-exports. The approval gate was exercised in a real browser (not approved: notice and no activity; approved: plays; approval withdrawn: taken down again), and the approval list, its admin request handlers and the dialog markup have unit tests (hostile input, fail-closed behaviour). The dialog's markup was rendered with the real compiled stylesheet and the front end compiles with the tool's own build. **Not yet run inside the authoring tool's editor** (asset upload of a `.h5p`, the component picker, the approvals dialog and its buttons against a running server, preview/publish), in Safari or Firefox, or inside a real LMS.
