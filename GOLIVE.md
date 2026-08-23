# Pushing this, and what to check when it is live

## The push

    cd ~/Downloads && rm -rf glovels-patches && mkdir glovels-patches
    tar xzf glovels-golive.tar.gz -C glovels-patches

    cd <your glovels repo>
    git am ~/Downloads/glovels-patches/*.patch
    git push

`git am` keeps each commit with its own message, so `git log` on the server
tells the next person why every change exists.

If `git am` refuses because the tree has drifted, stop rather than forcing it —
`git am --abort` puts everything back, and say so; a tarball that overwrites the
tree is the fallback and it loses the history.

Render redeploys on push. Watch the log for `Administrator created` or, on a
redeploy, for the server starting without complaint; the health check is at
`/api/health` and answers `{"ok":true}`.

## What to look at first, live

In this order, because each one is the thing that most often breaks and the
cheapest to check:

1. **The site loads, and it opens on the navigation.** `https://glovels.onrender.com/`
   — the finder paints, the packages show prices, and there is no orange banner
   above the menu. Those banners are for the copy you open from disk.
2. **One button in the corner — WhatsApp.** The chat box lives inside the
   student login now, where it is the counsellor thread. Lead capture on the
   public site is the contact form and the counselling form, both of which write
   into the enquiry book.
3. **Send the contact form** on `/contact-us` and find yourself in the office
   under **Website chat → Enquiry forms** within a second or two.
4. **Sign in** at `/login` with your own email and the password from Render's
   Environment tab.
5. **Change a price** on Home page → Packages, then reload the site. The card
   and the checkout sheet should both show the new number.
6. **Write an SOP** in the studio on the home page, signed in as a student, and
   check it appears on the dashboard and on that student's record in the office.
7. **Open the site on your phone.** Nothing should scroll sideways, on the
   marketing pages or inside the portal.

## Before you tell anyone about the site

**The WhatsApp number.** Home page → Finder & contact. The number in the links
is `917093314089` — if that is right, leave it. The number as it is *written* on
the page is a line of text on the Page text tab; they are two separate places on
purpose, and they can disagree.

**Email.** Nothing leaves the building yet: password resets and order receipts
are written to `data/outbox/` as `.eml` files instead of being sent. That is the
correct behaviour without SMTP credentials and it is not a failure, but it does
mean a student who forgets their password cannot reset it themselves. Add
`mail.env` when you have the one.com details.

**What a visitor may see of a public university.** Home page → Finder & contact
→ *Public university names*. Three settings: the match without the name (the
default, and the business model), the name without the fee, or everything. It is
enforced on the server, so it is a real decision rather than a display one.

## Being found on Google

Nothing is offered to a search engine while the site is on the `onrender.com`
address. That is deliberate: getting the platform's address into Google's index
is a nuisance to undo once your own domain is live.

When the domain is pointed here, set **`GLOVELS_URL`** in Render's Environment
tab to `https://glovels.com` (or whichever it is). That one variable does three
things: password-reset and receipt links start using the real address,
`robots.txt` starts inviting crawlers to the public pages, and the `noindex` tag
comes off those pages. `sitemap.xml` starts answering at the same moment and
lists all 35 public pages.

To turn indexing on or off regardless — a soft launch, or a hold after the
domain moves — set `ALLOW_INDEXING` to `true` or `false`. The start-up log says
which way it went, on the line beginning `Search engines:`.

## Turning payments on

The checkout is wired to Razorpay and switched off. With no keys set, an order
is recorded and a counsellor collects — the confirmation says exactly that, and
does not claim a payment.

To collect online, set three variables in Render's Environment tab:

    RAZORPAY_KEY_ID          from the Razorpay dashboard, API Keys
    RAZORPAY_KEY_SECRET      shown once, when the key is generated
    RAZORPAY_WEBHOOK_SECRET  whatever you type when you create the webhook

Then create the webhook in Razorpay pointing at
`https://<your domain>/api/razorpay/webhook`, subscribed to **payment.captured**
and **payment.failed**.

The webhook is not optional in practice. It is the only thing that records a
payment when the student's browser dies on the bank's verification page — their
money has gone and nothing on your side would otherwise know. The start-up log
says which state you are in, on the line beginning `Payments:`.

Two things the server refuses in production, rather than letting them through:
one key without the other, and a `rzp_test_` key. Both are cases where the
checkout would look like it was working and would not be.

Nothing is ever marked paid because a browser said so. Razorpay signs the
payment, the server recomputes that signature with the secret, and only a match
counts — so a package's universities cannot be unlocked by anybody who presses
Confirm and closes the tab.

## What is not written

**Terms, Privacy, Refunds and Grievance are written — and want a lawyer's
eye.** They are drafts, built from what this business actually does, and they
are live rather than blank because the guarantee on the Boarding Pass card has
been linking to `refunds.html#guarantee-terms` all along and that anchor did not
exist. A guarantee whose terms are a 404 is the expensive kind of gap.

They are not a lawyer's work. Before you take real money, have somebody who does
this for a living read them — the refund rule and the guarantee especially.

**They also need your numbers.** Home page → **Legal**. CIN, GSTIN, the
registered office, the effective date, and a named grievance officer with a
direct phone number. The tab counts what is still blank and says which page each
blank belongs to. Nothing is guessed: until a line is typed, the pages leave it
out rather than printing a placeholder.

**The terms behind each package** are on that same tab, one box per package.
That is what **Full terms** on a card opens. Edit them there, not in the code.

**These pages are still stubs:**

    disclaimers  careers  refer  glossary  language-french  language-german
    migrate-australia-pr  migrate-canada-pr  test-gre-gmat-sat
    test-ielts-toefl-pte  work-medical-pg-germany  work-nursing-germany
    work-opportunity-card  work-pharma-germany  and the six posts under /post/

Open any of them from disk — `open build/careers.html` — and the note tells you
what was intended for it. Visitors do not see those notes.

**Eight search descriptions are short.** Google shows about 155 characters and
writes its own when the tag is thinner than it can use. `node tests/seotest.js`
lists them under `NOTE`.

## The tests

    cd tests && ./runtests.sh          # every suite, each on a fresh database
    node loadcheck.js                  # every page loads without a console error
    node linkcheck.js                  # every internal link resolves
    node sweep.js                      # every control on every screen does something
    node mobiletest.js                 # nothing scrolls sideways on a phone
    node paytest.js                    # what a forged payment cannot do
    node legaltest.js                  # the legal pages, and the contact form
    node e2e.js                        # one person's walk through the whole business

`e2e.js` is the one to run if you only run one: a stranger lands, is matched on
the finder, asks a question in the chat box, becomes a lead in the enquiry book,
is answered by the office, buys a package, signs up, finds the purchase waiting
on their dashboard, writes an SOP, and messages their counsellor — then a
sentence typed in the office appears on the public page.
