# Pushing this, and what to check when it is live

## The push

    cd ~/Downloads && rm -rf glovels-patches && mkdir glovels-patches
    tar xzf glovels-golive.tar.gz -C glovels-patches

    cd <your glovels repo>
    git am ~/Downloads/glovels-patches/*.patch
    git push

Nine commits. `git am` keeps each one with its own message, so `git log` on the
server tells the next person why every change exists.

If `git am` refuses because the tree has drifted, stop rather than forcing it —
`git am --abort` puts everything back, and say so; a tarball that overwrites the
tree is the fallback and it loses the history.

Render redeploys on push. Watch the log for `Administrator created` or, on a
redeploy, for the server starting without complaint; the health check is at
`/api/health` and answers `{"ok":true}`.

## What to look at first, live

In this order, because each one is the thing that most often breaks and the
cheapest to check:

1. **The site loads.** `https://glovels.onrender.com/` — the finder paints, the
   packages show prices.
2. **The chat button is in the corner.** Press it, give a name and a number,
   send a message. It should appear in the operations site under
   **Website chat** within a second or two.
3. **Reply to yourself from the office** and watch it arrive in the other tab
   with nothing refreshed. That is the half that makes it a chat.
4. **Sign in** at `/login` with your own email and the password from Render's
   Environment tab.
5. **Change a price** on Home page → Packages, then reload the site. The card
   and the checkout sheet should both show the new number.
6. **Write an SOP** in the studio on the home page, signed in as a student, and
   check it appears on the dashboard and on that student's record in the office.

## Two things to set before you tell anyone about the site

**The WhatsApp number.** Home page → Finder & contact. The number in the links
is `917093314089` — if that is right, leave it. The number as it is *written* on
the page is a line of text on the Page text tab; they are two separate places on
purpose, and they can disagree.

**Email.** Nothing leaves the building yet: password resets and order receipts
are written to `data/outbox/` as `.eml` files instead of being sent. That is the
correct behaviour without SMTP credentials and it is not a failure, but it does
mean a student who forgets their password cannot reset it themselves. Add
`mail.env` when you have the one.com details.

## What is not built

Payment. An order is recorded, priced and confirmed, and no money moves. That
was deliberate and it is the one thing standing between this and taking money.
