# The tests

Every check in here is made by driving a real browser against a real server and
reading what a person would see on the screen. None of it asserts against the
code that produced the screen — a screen that renders perfectly and saves
nothing looks identical to one that works, and that is the failure these are
here to catch.

## Running them

    npm install --no-save playwright        # once; the only dependency, and only for tests
    npx playwright install chromium         # once

    ./tests/runtests.sh                     # everything, each against a fresh database

Each suite gets a database created seconds before it runs. That isolation
matters more than it sounds: several of these delete universities or rewrite the
home page, and a suite inheriting another's leftovers passes or fails for
reasons that have nothing to do with the code.

To run one on its own:

    ./tests/srv.sh 8099                     # fresh database, waits until it answers
    node tests/hometest.js

## What each one covers

| Suite | What it proves |
|---|---|
| `loadcheck.js` | All 43 pages load, as a visitor, a student and an administrator, with no script error. The cheapest test here and the one that would have caught the sign-in page breaking. |
| `sweep.js` | Presses every control on the pages that matter and reports anything that does nothing. The only test that sees a button which renders perfectly and is dead. |
| `contenttest.js` | The page-text editor: every line on the home page, edited and put back. |
| `hometest.js` | The Home page screen — packages, figures, FAQ, stories, text, spreadsheet. |
| `servicetest.js` | The 26 service cards: price, turnaround, badge, category, visibility. |
| `showcasetest.js` | Which universities lead the strip on the home page, and in what order. |
| `appendtest.js` | An Excel upload of new universities ADDS to the list and alters nothing else. |
| `bulktest.js` | Selecting many universities and removing them — including the rule that a programme a student has shortlisted is hidden, never deleted. |
| `sheettest.js` | The catalogue spreadsheet round trip, wrong rows included. |
| `reqtest.js` | Entry requirements edited in the office and read on the website. |
| `aitest.js` | The SOP/LOR studio: it writes from what was entered, writes differently each time, saves for a signed-in student, and the counsellor can read it. |
| `writingtest.js` | The screen that owns the studio's wording, including previewing without saving. |
| `chatboxtest.js` | The chat box: a question reaching a counsellor's open screen, and the answer arriving in the visitor's browser with nothing refreshed. |
| `teamtest.js` | Roles and permissions, against a production-mode server with no demo accounts. |
| `livechat.js` | Two browsers, one conversation — the student portal's own messaging. |

## The two harness bugs worth knowing about

`srv.sh` used to check only that the port answered. When an older process still
held it, the new server died with EADDRINUSE, the old one answered the health
check, and the whole suite went green against yesterday's build. It now refuses
to report success in that case.

Playwright's `fill` focuses and then inserts, so an unfocused fill lands in
whichever box had focus last. Several suites click into a field before typing
for exactly this reason, and the comments say so where it bit.

## robots.txt and sitemap.xml

Both are generated, not served from disk. `ALLOW_INDEXING` decides; it defaults
to on when the site is in production *and* `GLOVELS_URL` is set to a domain
somebody chose, rather than the address the platform handed out. `seotest.js`
covers all three states.
