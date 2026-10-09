# Slides

A slide-style stepped component: **one slide at a time** with Back and Next buttons, a "Slide 2 of 5" counter, progress dots, and an optional image on each slide. It is the closest Adapt gets to stepping through a Storyline slide deck, inside a Rise-style scrolling page.

## Using it

1. In a block, add a component and choose **Slides**.
2. Add slides. Each has a **title**, **text** (formatting, lists and links work) and, if you like, an **image** with alternative text and a position (top, left or right; on phones the image always goes above the text).
3. Optional settings:
   - **Must be seen in order**: learners can go back anywhere but can only move forward one slide at a time, and the dots ahead are disabled.
   - **Complete when**: *allSlides* (default) or *lastSlide*.
   - **Show "Slide 2 of 5"**, and the Back / Next / progress wording (use `{{current}}` and `{{total}}` in the progress text). All of it can be translated.

The component completes when the learner has seen every slide (or reached the last, if you chose that). The first slide counts as seen once the component scrolls into view. Combine it with the **Rules** extension: a trigger on *completed* and this component's class can unlock the next section.

## Importing a PowerPoint into a Slides component

Open the Slides component's settings in the editor and click **Import PowerPoint** in the left sidebar, then choose a `.pptx` file. The component's slides are **replaced** by the deck's slides (title, text, bullets, tables and the first picture of each slide). Pictures are added to the asset library and linked to the course, and the page reloads to show the result, so save any other edits on that screen first. Hidden slides are skipped. Anything that could not be carried over (charts, animations, extra pictures) is listed in the dialog. Add alt text to pictures that have none; **Check accessibility** flags them.

To start a whole new course from a deck instead, use **Import source** on the dashboard.

## Accessibility

- The deck is a labelled `carousel` group, each slide a labelled `slide` group ("2 of 5"); only the current slide is in the page for screen readers.
- After Back / Next / a dot, focus moves to the new slide so it is read out; the counter is a polite live region.
- Back and Next are real buttons whose spoken names say where they lead ("Next: Why it matters (slide 3 of 5)"). A disabled button is marked `aria-disabled`.
- Keyboard: Left/Right arrows step (swapped in right-to-left languages), Home and End jump to the first and last slide. Swiping works on touch screens.
- Dots are buttons with a comfortable touch target; the current slide is `aria-current`.
- Colours come from the course theme.

## Files

`js/slidesLogic.js` holds the decisions (which moves are allowed, labels, key handling) and is unit tested; `js/SlidesView.js` is the screen behaviour; `templates/slides.jsx` the markup.

## Testing

`adapt-plugins/test/slides.test.js` unit-tests the logic. The component was also run in a real framework 5.56.3 build in headless Chromium (24 checks: only the current slide shows, counter and labels, Back/Next states, focus, arrow and Home keys, dots, forced order, both completion modes, image alt text, markup in titles, no page errors) and axe-core found nothing to fix. **Not yet tried in the authoring tool's editor** (the slide list and image picker) or a real LMS; check those first after deploying.
