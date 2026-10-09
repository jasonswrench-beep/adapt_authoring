# Rules (variables and triggers)

A small Storyline-style layer for Adapt: **variables** that hold a number, some text or true/false, and **triggers** of the form *when something happens, (if a condition holds,) do something*. It runs in the browser, so it works in the Web export and inside SCORM.

It is not a copy of Storyline's trigger engine. It covers the common cases students reach for: unlock content, count points, show a message, add a button, jump somewhere.

## Turn it on

1. Add the **Rules** extension to the course (Extensions) and tick *Is enabled*.
2. Open the course settings and fill in **Variables** and **Triggers** (the extension adds those boxes).

## Pointing at things

Elements are identified by a **class name** you give them in the editor (every page, article, block and component has a *Classes* box; for example `bonus`). Type that name in the trigger's *On element* / *Element* box. The element's id (such as `c-005`) works too, but ids are not visible in the editor, so use classes.

## Variables

Each variable has a **name** (letters, numbers and underscores; starts with a letter), a **type** (number, text, true/false) and a starting value. Show a value in any text, title or message with double square brackets: `Your score is [[Score]]`. It updates live when the variable changes.

## Triggers

Each trigger is one row; to do two things at the same moment add two rows.

| When | Runs |
|---|---|
| start | when the course opens |
| viewed | when the element appears on screen (a page: when it opens) |
| completed | when the element is completed |
| correct / incorrect | when a question is answered correctly / incorrectly |
| button | adds a button (your text) to the element; runs when it is pressed |
| variable | when the variable named in *Watch variable* changes value |

Optional **condition**: *Only if variable* `Score` `≥` `10` (operators: = ≠ > ≥ < ≤ contains; numbers compare as numbers, text ignores capitals). Tick **Only run once** to stop a trigger repeating.

| Then | Does |
|---|---|
| set-variable / add-to-variable / toggle-variable | changes a variable (add works on numbers, toggle on true/false) |
| show / hide | shows or hides the element |
| go-to | opens the page, or scrolls to the element |
| message | pops up a message (title and text; `[[variables]]` allowed) |
| complete | marks the element complete |

A trigger that changes a variable can fire other triggers (for example unlocking something when the score reaches 10). Chains stop after 10 levels so a loop cannot freeze the course.

## Saving progress

In a SCORM package the variables are saved with the learner's progress (the LMS bookmark data) and restored next time. In the Web export they restart each visit.

## Limits

- Use "hide" for things learners should not get at yet; hidden elements are removed from view and from screen readers. Hiding is not security: anyone can read the course files.
- Hidden elements still count toward completion tracking. Do not hide something learners must finish.
- Button text and messages are the only learner-facing text; they can be translated like other course text.
- Triggers on "viewed" fire again each time the element is displayed; tick *Only run once* if that matters.

## Testing

`adapt-plugins/test/rules.test.js` unit-tests the decision logic. The extension was also run in a real framework 5.56.3 build in headless Chromium: tokens, start rule, button, live text update, conditions, variable-change chaining, message popup, correct-answer rule, toggle, run-once, go-to, and carrying variables between pages all behaved as above. **Not yet tried inside the authoring tool's editor** (the Variables/Triggers boxes) or in a real LMS.
