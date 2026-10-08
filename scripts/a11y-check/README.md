# Accessibility checker for Adapt courses

Checks a **built** course (the Web export) in two layers and writes a plain-language report students can act on. The same rules power the editor's **Check accessibility** button (quick check on saved content, plus an optional full check that runs this tool on the preview).

```bash
cd scripts/a11y-check && npm install            # once
node a11y-check.js my-course-web.zip --html report.html
node a11y-check.js path/to/build --json report.json --fail-on warning
```

| Option | Effect |
|---|---|
| `--html file` / `--json file` | Write a report (HTML is readable by students; JSON is for tooling) |
| `--no-browser` | Content rules only (also automatic for a source course with no `index.html`) |
| `--fail-on error\|warning\|never` | Exit code 1 at that level (default `error`), for CI or a grading script |
| `--browser /path/to/chrome` | Chrome/Chromium to use (or set `CHROME_PATH`) |

## Layer 1: Adapt-aware content rules (`content-rules.js`)

Run on the course JSON, so they understand component settings that generic scanners cannot see.

| Rule | Severity | WCAG |
|---|---|---|
| Image with no alt text, filename or generic alt ("image.png"), very long alt, redundant "image of" | error / warning / info | 1.1.1 |
| Video/audio with no transcript; video with no caption file; external video (check captions at source); autoplay | error / warning / info | 1.2.1, 1.2.2, 2.2.2 |
| Vague link text ("click here", "read more"), raw URLs as link text, empty links | error / warning | 2.4.4 |
| Table with no header cells; table with no caption | error / info | 1.3.1 |
| Content headings at levels 1-3 (the tool already uses them) and skipped heading levels | warning | 1.3.1 |
| iframe without title; obsolete markup (`font`, `blink`, `marquee`); custom text colour; text under 12px | error / warning | 4.1.2, 1.4.2, 1.4.1, 1.4.4 |
| Missing or duplicate page titles | error / warning | 2.4.2 |
| Framework accessibility switched off; skip-navigation off; no course language | error / warning | 4.1.2, 2.4.1, 3.1.1 |

## Layer 2: rendered check with axe-core

Serves the build locally, opens the menu and every page in headless Chromium (animations reduced, page scrolled so on-scroll content appears) and runs [axe-core](https://github.com/dequelabs/axe-core) for WCAG 2.0/2.1/2.2 A and AA. Finds colour contrast, ARIA misuse, landmark and focus problems. Items axe cannot decide are listed under "needs a manual look".

## Limits (please read)

Automated checking finds only a portion of accessibility problems (commonly cited as roughly a third to a half). It cannot judge whether alt text is *good*, whether reading order makes sense, or whether an interaction works with a keyboard and screen reader. Treat a clean report as "no known automated failures", not "accessible". It does not look inside iframes or embedded H5P/YouTube content.

## Testing

`node --test test/*.test.js` covers every content rule plus the editor integration (server core and report builder). The rendered layer was verified against a real framework build, plus a deliberately broken copy where axe flagged the injected low-contrast text and the image with no alt.
