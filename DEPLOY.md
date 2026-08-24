# Putting Glovels somewhere other people can reach

Two different questions, and it is worth keeping them apart.

1. **Let a few counsellors test it this afternoon.** Nothing to host. Skip to
   *A public link in one minute*.
2. **Run it properly, at glovels.com, with real student data on it.** Everything after that.

---

## A public link in one minute

Double-click **`share.command`** on the Mac that has this folder.

It opens a Cloudflare quick tunnel — a random `https://something.trycloudflare.com`
address that points at that Mac for as long as the window is open — starts the server in
production mode with a **freshly generated password printed in that window**, and uses a
separate `data-shared/` folder so the test never touches your real data.

Close the window and the link dies. It needs `cloudflared` once:

```
brew install cloudflared
```

This is the right tool for "can you have a look at this". It is not hosting: the site is
only up while that laptop is awake and online.

---

## Vercel will not work, and it is worth knowing why

Vercel is the obvious first thought and it is the wrong shape for this application.
Vercel's own documentation says it plainly: **"SQLite is a popular and fast database
engine. While it can't be used with Vercel, we do offer other storage solutions"**, and
that **storage is ephemeral with serverless functions**.

That is not a limitation you can work around here, because three things this application
does all depend on the same assumption:

- **The database is a file on disk.** `data/glovels.db` — students, sessions, documents,
  messages, orders, and now the home page's own content. A serverless function gets a
  filesystem that is thrown away, so every deploy — and every cold start — would lose
  every account.
- **Uploaded documents are files on disk.** `data/uploads/<student>/` holds passport
  scans and marksheets. Same problem, with worse consequences.
- **The messenger is a long-lived connection.** Server-sent events hold the response open
  for as long as the counsellor has the screen up. Serverless functions are billed and
  bounded by execution time; a connection that is meant to stay open for an hour is
  exactly what they are not for.

The same reasoning rules out Netlify Functions, Cloudflare Workers and AWS Lambda as they
come. What this needs is unglamorous: **one long-running Node process with a disk attached
to it.**

---

## What it actually needs

| | |
|---|---|
| Runtime | Node 22.5 or newer (for `node:sqlite` — it falls back to a JSON file on older Node, which works but is slower) |
| Process | One. Long-running. **Not** two — see *Why only one* below |
| Disk | A persistent volume mounted at `/data`, 1&nbsp;GB to start |
| HTTPS | Required. The session cookie is marked `Secure` in production, and browsers drop it over plain HTTP |
| Memory | 512&nbsp;MB is plenty |
| Build step | None. No `npm install`, no lockfile, no bundler — the server uses only Node's standard library |

### Why only one

Sessions, the live chat hub and the SQLite file all live inside the one process and the
one disk. Two instances behind a load balancer would each have half the chat connections
and their own copy of the database. **Set the instance count to 1 and leave it there.** If
Glovels ever outgrows one process, the change is a real database (`server/store.js` is the
only file that issues a query) and a shared pub/sub for `server/live.js` — not more
replicas.

---

## Somewhere to put it

Any host that gives you a container with a volume will do. Three that fit:

**Render** — natively supports Node, and you "attach a persistent disk" for
"storage of arbitrary files". Watch the free tier: **"Free web service instances spin down
if they receive no incoming traffic for 15 consecutive minutes"** and take about a minute
to come back. A minute of nothing is bad on a marketing site and fatal to a live chat, so
this needs a paid instance, not the free one.

**Railway** — volumes are per service, 5&nbsp;GB on Hobby and 50&nbsp;GB on Pro, billed per
GB actually used, with automated backups and a 48-hour grace period on a deleted volume.
Two of its documented limits are worth reading in advance: **only one volume per service**,
and **replicas cannot coexist with volumes** — which is fine here, because one instance is
what you want anyway. Expect brief downtime on each redeploy, since two deployments cannot
be mounted to the same volume at once.

**A small VPS** (Hetzner, DigitalOcean, Linode) — €4–6 a month, complete control, and you
own the backups. More setup: a systemd unit, Caddy or nginx in front for HTTPS, and you
patch the machine yourself.

The `Dockerfile` in this folder builds on any of them.

---

## The settings it will not start without

Production is a mode, and it refuses to boot until the things that make it safe are set.
That is deliberate: a server that starts anyway and prints a warning nobody reads is how
this goes wrong.

```
GLOVELS_ENV=production
GLOVELS_URL=https://app.glovels.com     # https, no trailing slash — password-reset
                                        # links and order emails are built from it
ADMIN_EMAIL=you@glovels.com             # the account you sign in with
ADMIN_PASSWORD=<24 random characters>   # at least 12, and not the one in the README
DATA_DIR=/data                          # the mounted volume, NOT a folder in the image
PORT=8080
```

Optional:

```
SEED_DEMO=false        # default in production. Turning it on requires DEMO_PASSWORD,
                       # 10+ characters, and not the one published in the README
TRUST_PROXY=true       # default in production; needed behind a platform load balancer
                       # so the cookie gets Secure and links come out https://
RAZORPAY_KEY_ID=rzp_live_xxxxxxxx      # from the Razorpay dashboard, API Keys.
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxx   # shown ONCE when the key is generated.
                       # Both or neither — with only one, the checkout offers a card
                       # and then cannot confirm the payment, and the server refuses
                       # to start in production rather than let that happen.
RAZORPAY_WEBHOOK_SECRET=xxxxxxxxxxxx   # whatever you typed when creating the webhook.
                       # Point the webhook at  https://<your domain>/api/razorpay/webhook
                       # and subscribe to payment.captured and payment.failed.
                       # WITHOUT this, a student whose browser died on the bank's
                       # 3-D Secure page has paid and the order will never say so.
ALLOW_INDEXING=true    # whether search engines may index the public pages.
                       # Defaults to ON once GLOVELS_URL names a domain you chose,
                       # and OFF while the site is on the platform's own address —
                       # a preview URL in Google's index is a nuisance to undo.
                       # robots.txt, sitemap.xml and the per-page noindex tag all
                       # follow this one setting, so they cannot disagree.
```

If any of those are wrong the server prints exactly which one and stops. Read the message;
it says what to do.

### Email

**Read this before setting up SMTP on a free host.** Render's free web services block
outbound traffic to ports 25, 465 and 587 — every SMTP port — so on a free plan no mail
server setting can send anything, whoever the provider is. The symptom is a twenty-second
timeout at connect. Two ways out: upgrade to a paid Render instance, or pick a provider
over HTTPS in **Organisation → Email** (Brevo or Resend; the mail then goes out on port
443, which is never blocked). The second is free and is the better transport anyway — a
transactional provider handles bounces and reputation; a mailbox at a domain host does
not.

Set these as **environment variables** in your host's dashboard — on Render that is the
Environment tab. A password belongs there and not in a file: nothing on disk, nothing in
the repository. On a laptop you can put the same names in a `mail.env` file next to
`serve.js` instead; where both exist, the environment wins.

All three of `SMTP_HOST`, `SMTP_USER` and `SMTP_PASS` are required. With any one of them
missing the server does not send at all — it writes each message to `data/outbox/` and
carries on, because mail must never fail a student's sign-up.

```
SMTP_HOST=mailout.one.com
SMTP_PORT=587
SMTP_USER=website@glovels.com
SMTP_PASS=<the mailbox password>
MAIL_FROM=Glovels <website@glovels.com>
MAIL_TO=info@glovels.com
```

**one.com only accepts SMTP from sites hosted with them**, so if the app is on Render or
Railway their server will refuse it. Use a transactional provider instead — Postmark,
Resend, Brevo, SES — keeping `info@glovels.com` as the address the mail comes *from* and
adding the SPF and DKIM records that provider gives you. Without mail configured, every
message is written to `data/outbox/` as a readable `.eml` file and nothing is lost.

**Check it from the site, not from the logs.** Organisation → Email says whether mail is
going out and through which server, and has a *Send me a test email* button that reports
what the mail server actually said back. That is the fastest way to tell a wrong password
from a blocked host.

---

## Before the first real student

In order:

1. **`robots.txt` blocks every search engine** (`Disallow: /`). It is the preview build.
   Nothing will ever be indexed until that line goes.
2. **`.htaccess` is the preview build**, and its old-URL 301 block is commented out. Fill
   it in, or existing rankings land on a 404. (Only relevant if the marketing pages are
   served by Apache rather than by this Node server.)
3. **Confirm the DUMMY figures.** Ten of them, marked deliberately. Open the **Home page**
   screen, fix each number, and untick *unconfirmed*.
4. **Put in the real intake deadlines.** The pages roll a past deadline forward a year so
   nothing reads as expired — that is a display convenience, not data. The Catalogue screen
   is where they live.
5. **Payment.** No gateway is connected: the order is recorded and the universities unlock,
   but nothing is charged. When one is added, **the entitlement must be written by the
   gateway's signed webhook, never by the browser.** The server already prices from its own
   list and ignores an amount sent by the client; that shape must survive.
6. **Uploaded documents are personal data** under the DPDP Act. They need encryption at
   rest, a retention rule and a deletion route before real passports go in.
7. **Back up `/data`.** It is the only copy — the database and every uploaded file. A
   nightly copy off the host is the minimum; a restore you have actually tested is the
   real bar.

---

## Two DNS things that are already wrong

Worth fixing whatever you decide about hosting:

- **`glovels.com` and `www.glovels.com` point at different places.** The nameservers are
  Wix, `www` resolves to Wix, and the apex resolves to one.com. Decide which one is the
  site and make the other redirect to it, or half your visitors see the wrong thing.
- **The DMARC record is on the apex**, where it does nothing. It belongs at
  `_dmarc.glovels.com`. There is also **no DKIM record**, so mail from the domain has one
  fewer reason to be believed. Whoever sends the email — one.com or a transactional
  provider — publish their DKIM key and move DMARC to the right name.

---

**Sources**

- [Vercel — Is SQLite supported in Vercel?](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel)
- [Render — FAQ (persistent disks, free-instance spin-down)](https://render.com/docs/faq)
- [Railway — Volumes reference (sizes, one volume per service, replicas, backups)](https://docs.railway.com/volumes/reference)
- [one.com — Can I use your SMTP server to send emails?](https://help.one.com/hc/en-us/articles/115005594305-Can-I-use-your-SMTP-server-to-send-emails)
