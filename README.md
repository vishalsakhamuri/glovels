# Glovels — running the site on your laptop

## Start it

Double-click **`start.command`**.

The site opens in your browser at <http://localhost:8080/>. Stop it with **Control-C**
in the black window, or close the window.

If macOS refuses to open it the first time: right-click `start.command` → **Open** →
**Open** again. That happens once.

It needs **Node** — if the window says so, install it once from <https://nodejs.org>
(the LTS button) and double-click again.

| Where | Address |
|---|---|
| Website | <http://localhost:8080/> |
| Sign in / create account | <http://localhost:8080/login> |
| Student portal | <http://localhost:8080/dashboard> |

**Three accounts**, all with the password `glovels123`, created by the server on its
first run:

| Sign in as | Opens | What it is |
|---|---|---|
| `student@glovels.com` | `/dashboard` | A student with a shortlist, six documents, applications part-way through and a paid order |
| `kavya@glovels.com` | `/counsellor` | The counsellor assigned to that student — **this is who answers the chat** |
| `admin@glovels.com` | `/admin` | The organisation view, and the control that assigns counsellors |

**To see the live chat work:** open `/messages` signed in as the student in one browser
window, and `/counsellor` as Kavya in a second window (use a private window so the two
sessions do not collide). Type in one — it appears in the other, with a typing
indicator, and no refresh anywhere.

You can also **create your own account** on the sign-in page. It is a real sign-up:
the password is hashed, the session is a cookie, and everything you then do is saved
against that account.

### Do not open the .html files by double-clicking them

Opening `index.html` straight from Finder breaks every link, because the site uses
clean addresses (`/study-in-germany`, not `study-in-germany.html`), and the portal has
nothing to talk to. Always go through `start.command`.

---

## Where the data goes

Student data is **not** kept in the browser. It is in a database on disk:

```
data/glovels.db        SQLite — students, sessions, profiles, shortlists,
                       applications, documents, messages, orders, enquiries
data/uploads/<id>/     the actual files a student uploads, one folder each
```

Neither is reachable over HTTP — the server refuses any request for `/data/`, and a
document comes back only through `/api/documents/<key>/file`, which resolves the
student from their session cookie. One student cannot fetch another's passport by
guessing a URL.

Stop the server, start it again, use a different browser, use a different machine —
the data is still there, because it was never in the browser to begin with.

**To wipe everything and start fresh:** quit the server, delete the `data` folder,
start again. The demo account is recreated.

*(On Node older than 22.5 there is no built-in SQLite. The server notices and stores
the same tables in `data/glovels-data.json` instead, written atomically. Nothing else
changes.)*

### Email

Until `mail.env` exists, every message is **written to `data/outbox/` as a real `.eml`
file** you can double-click and read — the same message, addressed and encoded the same
way, just not sent. That is the right default on a laptop, and one.com forces it anyway
since they only accept SMTP from sites hosted with them.

To switch it on, create `mail.env` next to `serve.js`:

```
SMTP_HOST=mailout.one.com
SMTP_PORT=587
SMTP_USER=website@glovels.com
SMTP_PASS=the-mailbox-password
MAIL_FROM=Glovels <website@glovels.com>
MAIL_TO=info@glovels.com
```

Both `info@glovels.com` and `website@glovels.com` must be real mailboxes on the domain —
a From address that is not a real mailbox is what gets mail treated as spam. **`mail.env`
holds a password: keep it out of git and off any shared drive.**

A copy of every message is written to the outbox even when sending succeeds, so nothing
is lost if a mail server is down.

### What is stored, and when

| You do this | This is written |
|---|---|
| Create an account | `students` row, password hashed with scrypt; any order already paid for with that email is claimed |
| Sign in | `sessions` row; an HttpOnly cookie no script can read |
| Fill in your profile | `profiles` — and your name and mobile update your account record |
| Add a university | `shortlist` row — the server looks the programme up in its own catalogue, so a made-up price or university name cannot be stored |
| Advance an application | `applications` row |
| Upload a document | the file to `data/uploads/`, a row in `documents` |
| Message your counsellor | `messages` rows, both sides |
| Save a scholarship | `saved_scholarships` row |
| Buy a package | `orders` row — **priced by the server**, from its own list; an amount sent by the browser is ignored |
| Send the counselling form | `enquiries` row, plus an email to the office and an acknowledgement to the enquirer |
| Edit the home page | `content` row — packages, numbers, FAQ, stories, or the wording overrides |
| Message your counsellor | `messages` row, pushed to their screen, emailed if they are offline |
| Ask to reset your password | `password_resets` row — single use, 30 minutes, and using it signs out every device |
| A counsellor verifies a document | `documents.status`, pushed to the student's screen |
| An admin assigns a counsellor | `students.counsellor_id` — which is what unlocks that student's file for that counsellor |

**The shortlist is one list.** Buying a package on the home page stores the matched
universities against your account, and the dashboard, My Universities and Applications
all read that same list. Change it in one place and it changes everywhere, on any
device you sign in from.

---

## What is in here

**40 marketing pages** — home, seven study destinations, four work-abroad pages, two
migration pages, test prep, languages, blog and six posts, about, careers, contact,
glossary, refer, and the six legal pages.

**8 portal screens** behind sign-in — Dashboard, My Profile, Documents, My Universities,
Applications, Scholarships, Visa & Enrollment, Messages.

Every button works. No dead links, no "coming soon" pop-ups, nothing that goes nowhere.

**4 staff screens** — Conversations (the counsellor's caseload and live threads),
**Home page** (everything the front of the site says), **Catalogue** (the universities and
destinations the site offers), and Organisation (every student, who is assigned to whom, and
who is allowed to change what).

### Who can do what

Three kinds of staff account, created on the Organisation screen:

| | Sees |
|---|---|
| **Administrator** | Everything, including adding people. Always allowed to change the site |
| **Counsellor** | The students assigned to them, and the chat |
| **Website editor** | The site only — **no student record, no document, no conversation** |

On top of that, two permissions decide what may be *changed* on the website:

- **Home page** — packages, prices, the figures, the questions, the stories, the wording
- **Universities** — adding, editing and removing what the finder offers

A counsellor has neither until an administrator ticks the box. The rule is enforced on the
server: hiding the menu item is a courtesy, not the permission.

Adding someone generates a password and **shows it once** — it is stored hashed, so nobody
including the administrator can read it back. If it is lost, *Reset password* makes a new
one and signs that person out everywhere.

### The Home page screen — the front of the site, without a developer

`index.html` is generated from `Glovels_Content_Master.xlsx`, so until now every price change
and every corrected number was a developer job. It is not any more. Six tabs:

- **Packages** — all nine, across the three tabs the home page shows. Name, the line under it,
  price, what is included, the ribbon, the guarantee panel, the tick box at checkout, how many
  public universities it unlocks. Add one, remove one, reorder them, hide one.
- **Numbers** — the four figures under the hero.
- **FAQ** — the questions, and the answers.
- **Stories** — the student testimonials.
- **Page text** — **every other word on the page.** Headings, paragraphs, button labels, the
  words in the enquiry form, the footer, the page title and the description Google shows.
  430 lines, searchable, each with **Back to original** beside it.
- **Spreadsheet** — download any of the five as Excel or CSV, edit it, upload it back.

**The price you type is the price charged.** The card, the checkout sheet and the receipt all
read the one number, so they cannot drift apart. **Universities revealed** is the same: the
server hands out that many gated names to a student who has paid, so it is not marketing copy.

**Unconfirmed** on a figure, a question or a story puts a DUMMY marker beside it on the site.
It is ugly deliberately — an unverified student count should not be able to ship quietly.

Two things it will not let you do. It refuses to leave a section of the home page empty, and it
refuses to remove the last package. Both are recoverable mistakes that are invisible until a
visitor finds them.

**When the marketing pages are rebuilt**, run `python3 build_content.py` alongside the other
two. Edits are stored against the sentence they replace, so a line that comes out of the rebuild
differently keeps its original wording rather than silently taking last month's. Those edits are
listed on the Page text tab as no longer matching, for somebody to decide about.

### The Catalogue screen — no spreadsheet, no developer

Counsellors add and edit what universities the website offers, and the home page picks it up
immediately. Add a university in Australia or the UK, change a fee, close an intake,
take something off the site — it is live on the finder on the next page load.

Two tabs:

- **Programmes** — every course, searchable, with a full editor: name, university, city,
  destination, level, field, public or private, total tuition, course page, and up to
  three intake deadlines. Leave the budget band blank and it is worked out from the fee,
  so a ₹30 lakh course cannot land in the "under ₹10L" bucket by accident.
- **Destinations** — the countries the finder offers. A programme cannot be added to a
  destination that does not exist yet, which is what stops a typo creating a country
  called "Austrlia" that nobody notices for a month.

Every change is recorded with who made it, on the **Recent changes** tab.

**Excel, both ways.** The **Spreadsheet** tab downloads all 171 programmes as `.xlsx` or `.csv`,
with the id in the first column. Edit it — fifty universities from a partner's list, a fee
revision across a whole country — and upload it back. An upload **never writes on the first
try**: it comes back as a plan (these are new, these change, these are already right, these
cannot be imported and why), and it is applied only when you press the button under that
summary. A row with the id filled in changes that programme; a row with it blank creates one.
Nothing is ever deleted by an import — to take a programme off the site, put `no` in the
**on the site** column.

Removing a programme a student has already shortlisted **hides** it instead of deleting
it, so their shortlist and their application do not blank out.

**A public university's name is still what a package buys.** The catalogue endpoint the
home page calls returns a locked row's country, level, fee band and deadlines — and the
*length* of the name so the blurred placeholder is the right width — but not the name.
Signed in with a paid order, the names come back up to what that package covers, decided
on the server from the order.

### The messenger

Student and counsellor, both ways, pushed rather than polled — a message appears on the
other screen in under a second without a refresh. Built on server-sent events, so there
is nothing to install and it reconnects by itself if the connection drops. The chip in
the header says `live` when the stream is up and `reconnecting…` when it is not, because
a chat that has quietly gone deaf while still looking connected is worse than one that
admits it.

If the other person is not online, the message goes out by email instead of waiting for
them to happen to log in.

**WhatsApp** is written as a driver and switched off. Turning it on needs three things
no amount of code can conjure: a Meta Business account with the number verified, a
permanent token and phone-number ID, and a **public HTTPS webhook** — which a laptop
cannot be. Put `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_ID` in `mail.env` and it starts
working; until then the messenger works without it.

### Still a demo in one place, and it is marked

- **No payment is taken.** The order is recorded, the receipt goes out and the
  universities unlock, but no gateway is connected. In production the entitlement must
  be written by the gateway's signed webhook, never by the browser.

---

## Making changes

Two kinds of file live here, and the difference matters.

### Generated — do not edit by hand

`index.html` and the other marketing pages are built by **`build_pages.py`** from
**`Glovels_Content_Master.xlsx`**. Neither is in this folder. Editing the HTML works
until someone runs a rebuild, and then the edit silently disappears.

Content changes — prices, copy, programmes, countries — belong in the workbook.

### Hand-written — safe to edit

| File | What it is |
|---|---|
| `serve.js` | The local server: static files, clean URLs, and the API |
| `server/store.js` | The database. Every query the app makes is in this one file |
| `server/api.js` | The endpoints, the password hashing, the price list |
| `server/seed.js` | The three demo accounts |
| `server/mail.js` | SMTP client and the outbox driver |
| `server/emails.js` | The emails themselves, plain text and HTML |
| `server/live.js` | The live stream behind the messenger |
| `server/notify.js` | Email today, WhatsApp when it is configured |
| `server/content.js` | The home page's content: what is valid, and the price list orders are charged from |
| `server/sheet.js` | Excel and CSV, read and written, with nothing installed |
| `apply_fixes.py` | Every hand fix to the generated pages, as a re-runnable script |
| `build_content.py` | Lifts the home page's content out of `index.html` into `content.json` |
| `page_text.py` | Addresses every line of text on the home page so it can be edited |
| `content_client.py` | The script the home page runs to paint itself from the server |
| `portal_home.py` | The Home page screen in the operations site |
| `build_portal.py` | Builds the portal screens from one shared shell |
| `portal_*.py` | One file per portal screen: its markup and its behaviour |

**After any rebuild of the marketing pages, run both:**

```
python3 apply_fixes.py     # re-applies the hand fixes to index.html etc.
python3 build_portal.py    # rebuilds the portal screens and catalogue.json
python3 build_content.py   # re-reads the home page's own content into content.json
```

All three are safe to run twice — they check for their own result first.

---

## Putting it live

**`LAUNCH.md` is the step-by-step**: GitHub, then Render, about twenty minutes.
`DEPLOY.md` is the reasoning behind it — including why Vercel and Cloudflare cannot run
this application as it stands.

For a link this afternoon with no hosting at all, double-click **`share.command`**: a
Cloudflare quick tunnel, a freshly generated password, and a separate data folder.

---

### The older notes, still true

The marketing pages need Apache with `mod_rewrite`; one.com's standard hosting is fine.
Upload the contents of this folder to `httpd.www`, including the hidden `.htaccess`.

**The portal needs somewhere to run Node, or a PHP rewrite of `server/`.** One.com's
standard plan is PHP and MySQL, not Node — so either the portal moves to a small Node
host, or `server/store.js` gets a MySQL driver and `server/api.js` is reimplemented in
PHP. Every query the application makes is in `store.js`; that is the file to port.

Before it goes live, in order:

1. **`robots.txt` blocks every search engine** (`Disallow: /`) — it is the preview
   build. Nothing will ever be indexed until that line goes.
2. **`.htaccess` is the preview build**, and its old-URL 301 block is still commented
   out. Fill it in, or existing rankings land on a 404.
3. **Serve it over HTTPS and add `Secure` to the session cookie** (`server/api.js`,
   `sessionCookie`). A session cookie over plain HTTP is readable on the wire.
   HTTPS is also what makes the WhatsApp webhook possible at all.
4. **Ten `DUMMY` chips on the home page** mark unconfirmed values — student counts, the
   FAQ answers, the testimonials. They are marked deliberately, so an unconfirmed number
   cannot ship by accident. Confirm each, then untick **unconfirmed** on the Home page screen.
   (The same figure appears twice on the page: once in the numbers strip, which the Numbers tab
   owns, and once in the line beside the faces under the hero, which is on the Page text tab.
   Change both.)
5. **The intake deadlines are last cycle's.** The pages roll a past deadline forward a
   year so nothing reads as expired, but that is a display convenience. Put the real
   dates in the workbook.
6. **Uploaded documents are personal data** under the DPDP Act. On a real host they need
   encryption at rest, a retention rule, and a deletion route.
7. **Back up `data/`.** It is the only copy.
