# Smoke test: first run on a real server

**Shortcut:** on the server, `git pull` then `sh scripts/selftest.sh` runs the server-side parts for you (log in, build a throwaway course, preview it twice, accessibility check, SCORM and Web downloads, H5P approvals list) and prints PASS or FAIL for each. What it cannot judge is how things look and feel in the editor: use the steps below for that.

About 15–20 minutes. Do these in order; each step says what you should see. When something differs, note the step number and what you saw (a screenshot helps), plus the output of `docker compose logs --tail=100 adapt`.

You need: the server running (see *Deploy* in `CLASSROOM-SETUP.md`), the super-user login from `.env`, one test student account, a small `.h5p` file (any activity exported from H5P.org or Lumi; the repo has one at `adapt-plugins/test/fixtures/h5p-test.h5p`), and an image.

## A. Server and install
1. `docker compose logs adapt` ends with the server listening and no repeated errors. **Expect:** the plugin installer reports every bundle entry installed (48). Note any it lists as failed.
2. Open `http://<server>:5000`, log in as the super user. **Expect:** the dashboard loads.
3. **Plugin management → Components / Extensions / Themes / Menus.** **Expect:** *Modern* theme, *Lessons* menu and *H5P Player* component listed and enabled.

## B. Look and feel
4. Create a course. **Expect:** the Modern theme and Lessons menu are the defaults, and Spoor and accessibility are on.
5. Add two pages, each with an article, a block and a Text component. Click **Preview**. **Expect:** numbered lesson cards in navy and orange, Start buttons, readable text.
6. Click a card, scroll, return. **Expect:** the card now says Continue or Review as appropriate.

## C. Exports
7. Download as **SCORM**. **Expect:** a zip named `<course>-scorm.zip`; it contains `imsmanifest.xml`.
8. Download as **Web**. **Expect:** `<course>-web.zip`, no manifest, opens from a web server (not from a double-click; browsers block that).
9. Upload the SCORM zip to your LMS (or SCORM Cloud). **Expect:** launches, completion is recorded.

## D. Accessibility checker
10. In the editor, click **Check accessibility**. **Expect:** a report appears (first run can take ~20 s). Add an image with no alt text and run it again: **Expect:** it is flagged and links to the fix.

## E. H5P and approvals
11. As super user, upload the `.h5p` through **Assets**, add an **H5P Player** component, choose the asset, preview. **Expect:** the activity plays (auto-approved because you uploaded it).
12. Open **H5P approvals** in the sidebar. **Expect:** the file under *Approved* with an "Approved automatically" badge and a **Do not approve** button.
13. Log in as the test student (separate browser), create a course, upload the same kind of file under a *different* name, add it, preview. **Expect:** "waiting for an instructor to approve it", and downloading is refused with a message naming the file.
14. Back as super user, open **H5P approvals**. **Expect:** that file under *Pending* with title, libraries and the course. Click **Approve**.
15. As the student, force-rebuild the preview. **Expect:** the activity plays. Download works.
16. As the student, check they cannot see **H5P approvals**, and that opening `http://<server>:5000/api/h5papproval` while logged in as the student returns an error, not a list.
17. As super user click **Do not approve** on the auto-approved file, rebuild. **Expect:** that activity is blocked again.

## F. Pptx import
18. On the dashboard choose **Import source**, select a small `.pptx` (the repo has one at `scripts/pptx-import/test/sample.pptx`) and import it. **Expect:** a course appears with one page holding a Slides component; Preview steps through the slides with Back/Next.

## G. Before real students
19. HTTPS reverse proxy is in place and the super-user password has been changed.
20. Back up the `adapt_app` and `mongo_data` volumes; confirm you can restore one.
