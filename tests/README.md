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

A full run is seventy-odd suites and takes about half an hour.

## What each one covers

### The site a visitor sees

| Suite | What it proves |
|---|---|
| `loadcheck.js` | Every page loads, as a visitor, a student and an administrator, with no script error. The cheapest test here and the one that would have caught the sign-in page breaking. |
| `sweep.js` | Presses every control on the pages that matter and reports anything that does nothing. The only test that sees a button which renders perfectly and is dead. |
| `hometest.js` | The Home page screen — packages, figures, FAQ, stories, text, spreadsheet. |
| `contenttest.js` | The page-text editor: every line on the home page, edited and put back. |
| `copytest.js` | The words on the twenty-three pages that shipped with "text to be written" in a yellow box. |
| `showcasetest.js` | Which universities lead the strip on the home page, and in what order. |
| `storytest.js` | Every admission, on a rail on the home page and on a page of its own. |
| `seotest.js` | `robots.txt`, `sitemap.xml` and the canonical, in all three indexing states. |
| `pagetest.js` | The office screens with a real number of records in them — 131 rows, not four. |
| `mobiletest.js` | Nothing scrolls sideways on a phone, on every screen. |
| `linkcheck.js` | Every internal link on every page, followed. A menu item that 404s is invisible in the source and obvious to the first visitor who presses it. Not in `runtests.sh` — run it by hand after adding pages. |

### Finding a university

| Suite | What it proves |
|---|---|
| `findertest.js` | The finder's own settings: how many names a visitor sees before paying, the euro rate, the budget buckets, the WhatsApp number. |
| `bartest.js` | A programme's entry bar — its own if the catalogue states one, otherwise its destination's rule. |
| `cgpatest.js` | The CGPA bar, from the spreadsheet column to the filter that reads it. |
| `reachtest.js` | The same bar on the counsellor's screens, and the fields the sheet has to carry for an exact filter to be exact. |
| `gradetest.js` | German grades: the modified Bavarian formula, the inverted scale, and what happens when nobody has typed one. |
| `boundstest.js` | Numbers that are not numbers and numbers on the wrong scale — a CGPA of 47.9 clearing every gate, refused rather than clamped. |
| `entrytest.js` | The entry requirements, and the ₹99 three-university product that has to hold together commercially. |
| `feetest.js` | What applying costs and which country the rule belongs to — public-versus-private is a German distinction. |
| `intaketest.js` | An intake is a month; the year is arithmetic. Deadlines that have passed are not shown as open. |
| `scholartest.js` | Scholarships this student can actually get, and the empty profile that used to qualify for twelve. |
| `gatetest.js` | What a visitor who has not paid may see — asserted on what leaves the server, not on what CSS hides. |
| `twolisttest.js` | Two lists: what a student liked the look of, and what their counsellor agreed. |

### The catalogue, in the office

| Suite | What it proves |
|---|---|
| `cattest.js` | The Catalogue screen: the same filters as the public site, and the CGPA on the screen. |
| `sheettest.js` | The catalogue spreadsheet round trip, wrong rows included. |
| `importtest.js` | The import preview refusing what it used to wave through: an unknown id, a fee that is not a number, a CGPA of 99. |
| `appendtest.js` | An Excel upload of new universities ADDS to the list and alters nothing else. |
| `bulktest.js` | Selecting many universities and removing them — a programme a student has shortlisted is hidden, never deleted. |
| `reqtest.js` | Entry requirements edited in the office and read on the website. |
| `edittest.js` | Fixing a mistake and removing one, everywhere, as per process. |

### Becoming a student

| Suite | What it proves |
|---|---|
| `ordertest.js` | What a visitor picks on the home page and what they see after signing in — services included, not just packages. |
| `partstest.js` | Paying in parts, rather than ₹74,999 in one press. |
| `paytest.js` | Razorpay: what is trusted and what is refused, including a replayed signature. |
| `contracttest.js` | What the student accepted when they paid, recorded and shown back to them. |
| `moneytest.js` | Expected, received, pending, dropped off — the four numbers that track the business. |
| `legaltest.js` | The legal pages, the particulars behind them, and the contact page. |
| `deletetest.js` | A person deleting their own account, which Apple and Google both require. |

### The student's own screens

| Suite | What it proves |
|---|---|
| `profiletest.js` | The intake form, after the counsellors' testing round — including the three findings that change what the matcher is told. |
| `formtest.js` | The profile form after Student View Corrections: a given name and a surname, and eight other changes. |
| `studenttest.js` | The dashboard and the messages screen, and the readiness figure that was not true. |
| `portaltest.js` | The portal after the 1.4 round: no demo answers, account deletion behind a heading, the upload cards in the tab order, and a stage the student may not mark done. |
| `doclisttest.js` | The document checklist, and how each document has to arrive rather than only which one. |
| `sharedtest.js` | A file shared in the conversation actually being uploaded, not just named. |
| `visatest.js` | The visa file: a card per document, uploaded, on the record, and waiting to be checked. |
| `applytest.js` | Applying to a private university is free, and the button does it. |
| `stagetest.js` | What a student is asked for, what they are told, and which names they may see. |
| `deliverytest.js` | What a student gets for their money, and who they get to talk to. |
| `delivertest.js` | Finished work — the SOP, the LOR, the visa checklist — handed back to the people waiting for it. |
| `counscardtest.js` | The counsellor card: who their counsellor is, not whether they have paid. |
| `authscreentest.js` | The two screens `login.html` turns itself into — the emailed link and the forced password change. |
| `pwresettest.js` | An administrator resetting a student's password, from the list that actually contains students. |

### The office

| Suite | What it proves |
|---|---|
| `admintest.js` | The Organisation screen: the counters lead somewhere, and a student can be made. |
| `teamtest.js` | Roles and permissions, against a production-mode server with no demo accounts. |
| `paneltest.js` | The admin panel: the eye on every password field, the drafts that were live, the screens that never called `staffBoot` — and the registered company name, as rendered. |
| `shortlisttest.js` | The counsellor running the student's list, which is the day-to-day work of the business. |
| `assigntest.js` | Who is doing this one, asked on each of the three screens where work arrives. |
| `leadtest.js` | Every enquiry in one place, with where it came from and what happened to it. |
| `alerttest.js` | What needs doing and who by — the four things that used to go wrong quietly. |
| `guidetest.js` | Reading the conversations, and guiding the counsellor having them. |
| `booktest.js` | The agency's book: filter, close, remove — and what the screen must never say. |
| `partnertest.js` | The B2B partner portal, and everything it must refuse. An agency is not staff. |
| `servicetest.js` | The service cards: price, turnaround, badge, category, visibility. |
| `mailtest.js` | Whether the email is connected, answerable from the screen rather than from the source. |

### Writing

| Suite | What it proves |
|---|---|
| `aitest.js` | The SOP/LOR studio: it writes from what was entered, writes differently each time, saves for a signed-in student, and the counsellor can read it. |
| `writingtest.js` | The screen that owns the studio's wording, including previewing without saving. |
| `sopdetailtest.js` | The studio asking what the experience actually was, rather than pasting one fixed phrase per chip. |
| `blogtest.js` | The blog, written and published by the office. |
| `postseotest.js` | The blog after Blogs Changes: the half of a post that decides whether anybody ever reaches it. |

### Talking

| Suite | What it proves |
|---|---|
| `chatboxtest.js` | The chat box: a question reaching a counsellor's open screen, and the answer arriving with nothing refreshed. |
| `livechat.js` | Two browsers, one conversation — the student portal's own messaging. |

### The app

| Suite | What it proves |
|---|---|
| `apptest.js` | The app a student installs, and what it does with no connection. |
| `twatest.js` | What makes the Android build an app: `assetlinks.json` and the signing fingerprint in it. |
| `pushtest.js` | The Web Push crypto, proved by reversing it — there is no honest answer from a test otherwise. |
| `spushtest.js` | Notifications for the student who installed it, not only for the counsellor. |

### Everything at once

| Suite | What it proves |
|---|---|
| `e2e.js` | One walk through the whole business on a fresh database: a stranger arrives, is matched, asks, buys, becomes a student, and finds their purchase waiting. |
| `sweeptest.js` | Everything that has been added, opened as each of the three people who use it. |
| `round2test.js` | The counsellors' second testing round — thirteen notes on a screenshot, two of them with teeth. |
| `roundtest.js` | The 1.6 round: the file types nothing enforced, the student verifying their own documents, one password minimum, an optional section's heading, one answer per press on the profile, and a package on sale at nothing. |

## The harness bugs worth knowing about

`srv.sh` used to check only that the port answered. When an older process still
held it, the new server died with EADDRINUSE, the old one answered the health
check, and the whole suite went green against yesterday's build. It now refuses
to report success in that case. It also kills by reading `PORT` out of
`/proc/<pid>/environ` rather than matching a command line, because
`setsid env PORT=8099 node serve.js` does not contain the string it was matched
against and the old process kept answering.

Playwright's `fill` focuses and then inserts, so an unfocused fill lands in
whichever box had focus last. Several suites click into a field before typing
for exactly this reason, and the comments say so where it bit.

A suite that dies rather than reporting a count prints a stack, and the runner
keeps eight lines of it — three was the file and the line number with the
message cut off, which is the one part that says what went wrong.

The one assertion that waits on the BROWSER rather than on our own pages — a
native file chooser opening in `portaltest.js` — waits twenty seconds across two
presses. It went red once in a full run and green every time alone, which is the
shape of a check measuring the machine rather than the code.

## robots.txt and sitemap.xml

Both are generated, not served from disk. `ALLOW_INDEXING` decides; it defaults
to on when the site is in production *and* `GLOVELS_URL` is set to a domain
somebody chose, rather than the address the platform handed out. `seotest.js`
covers all three states.
