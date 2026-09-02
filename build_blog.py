#!/usr/bin/env python3
"""
The blog, turned into two templates the server fills in.

There were six posts on glovels.com and no way to write a seventh. Each one is
a static HTML file carrying a headline, a lead paragraph and a note to
ourselves where the article should be — so finishing one, correcting a fee that
changed, or writing a new one meant a text editor and a deploy. The office
could not publish. That is not a blog, it is six landing pages.

The design is not re-authored here. One of those files IS the design, so it is
cut into a template with holes in it, and the server fills the holes from the
database. A change to the site's header, footer or type scale reaches the blog
the same way it reaches every other page: rebuild.

Two templates:

  post/_post.tpl.html   one article
  _blog.tpl.html        the index

Both carry the SEO holes on purpose — title, description, keywords, canonical,
Open Graph, Twitter and an Article JSON-LD block. That is the half of "write a
blog post" that decides whether anybody reads it, and it is filled in from the
same form as the words.

Run:  python3 build_blog.py
"""

import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
POST_DONOR = HERE / "post" / "german-universities-lower-cgpa.html"
INDEX_DONOR = HERE / "blog.html"


def die(msg):
    sys.exit("build_blog: " + msg)


# --------------------------------------------------------------- the head
#
# Everything a search engine and a link preview reads. It replaces the donor's
# own head tags rather than being appended, so there is exactly one <title> and
# one description on the page.

HEAD = """<title>{{HEAD_TITLE}}</title>
<meta name="description" content="{{DESC}}">
{{KEYWORDS}}<link rel="canonical" href="{{CANONICAL}}">
{{ROBOTS}}
<meta property="og:type" content="{{OG_TYPE}}">
<meta property="og:site_name" content="Glovels">
<meta property="og:title" content="{{OG_TITLE}}">
<meta property="og:description" content="{{DESC}}">
<meta property="og:url" content="{{CANONICAL}}">
{{ARTICLE}}{{OG_IMAGE}}<meta name="twitter:card" content="{{TWITTER_CARD}}">
<meta name="twitter:title" content="{{OG_TITLE}}">
<meta name="twitter:description" content="{{DESC}}">
{{JSONLD}}"""


def head_holes(html):
    """Swap the donor's fixed head tags for the holes above."""
    # The donor's title, description, robots and every og:/twitter: line go —
    # one page must not carry two of any of them.
    html = re.sub(r'<title>.*?</title>\s*', "", html, count=1, flags=re.S)
    html = re.sub(r'<meta name="description"[^>]*>\s*', "", html, count=1)
    html = re.sub(r'<meta name="robots"[^>]*>\s*', "", html, count=1)
    html = re.sub(r'<meta property="og:[^>]*>\s*', "", html)
    html = re.sub(r'<meta name="twitter:[^>]*>\s*', "", html)
    html = re.sub(r'<link rel="canonical"[^>]*>\s*', "", html, count=1)
    # The donor is a real page, and apply_fixes gives every real page a link
    # preview. Its meta tags went with the og: sweep above; this takes the
    # comment markers that wrapped them, so the template does not carry a
    # marker for a block that is no longer in it.
    html = re.sub(r"\s*<!-- /?GLOVELS-OG-IMAGE -->", "", html)

    i = html.index("<meta charset")
    j = html.index(">", i) + 1
    # Straight after <meta charset> and the viewport, which is where the head
    # tags a crawler cares about belong.
    v = html.index(">", html.index("<meta name=\"viewport\"")) + 1
    return html[:v] + "\n" + HEAD + "\n" + html[v:]


# ---------------------------------------------------------- the contact form
#
# "Every blog or rendering should have contact form where we directly get the
# student details" — so it is part of the template, not something remembered
# per post. It writes to the same enquiries endpoint as the counselling form,
# with the post's title on it, so a lead from an article arrives in the office
# saying which article.

FORM = """
<section class="block alt" id="ask">
  <div class="wrap" style="max-width:760px">
    <div class="blogform">
      <h2>Ask us about this</h2>
      <p>A counsellor who works on this every day, not a chatbot. We reply within one
        working day, and there is nothing to pay for the conversation.</p>
      <form id="postForm" novalidate>
        <div class="bf-grid">
          <div class="field"><label for="bfName">Your name</label>
            <input id="bfName" name="name" autocomplete="name" required></div>
          <div class="field"><label for="bfPhone">Mobile</label>
            <input id="bfPhone" name="phone" inputmode="numeric" autocomplete="tel"
              placeholder="10 digits" required></div>
        </div>
        <div class="field"><label for="bfMail">Email</label>
          <input id="bfMail" name="email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="bfMsg">What would you like to know?</label>
          <textarea id="bfMsg" name="message" rows="3"
            placeholder="Optional — your CGPA, your intake, the course you have in mind"></textarea></div>
        <button class="btn btn-green" type="submit" id="bfGo">Ask a counsellor</button>
        <p class="bf-note" id="bfMsgOut" role="status"></p>
        <p class="bf-fine">We use this to reply to you about this question. Nothing else.</p>
      </form>
    </div>
  </div>
</section>
"""

FORM_CSS = """
.blogform{background:var(--paper);border:1px solid var(--line);border-radius:16px;
  padding:26px 26px 24px;box-shadow:var(--sh-1)}
.blogform h2{font-size:22px;margin:0 0 6px}
.blogform > p{font-size:13.8px;color:var(--muted);line-height:1.65;margin:0 0 18px}
.blogform .field{margin-bottom:13px}
.blogform label{display:block;font:700 12.4px/1.4 var(--sans);color:var(--navy-800);
  margin-bottom:5px}
.blogform input,.blogform textarea{width:100%;padding:11px 13px;border:1.5px solid #d8dde4;
  border-radius:10px;font:400 14px/1.55 var(--sans);background:#fff;color:var(--navy-900)}
.blogform input:focus,.blogform textarea:focus{outline:none;border-color:var(--blue-deep,#1c4d78)}
.blogform textarea{resize:vertical}
.bf-grid{display:grid;grid-template-columns:1fr 1fr;gap:13px}
@media (max-width:560px){ .bf-grid{grid-template-columns:1fr} }
.blogform .btn{width:100%;margin-top:5px}
.bf-note{margin:12px 0 0;font:600 13px/1.55 var(--sans);display:none;padding:11px 13px;
  border-radius:10px}
.bf-note.ok{display:block;background:#eaf6ee;border:1px solid #bfe0cc;color:#14603a}
.bf-note.bad{display:block;background:#fdf3f2;border:1px solid #f0c8c4;color:#7a2118}
.bf-fine{margin:11px 0 0;font-size:11.4px;color:var(--muted);line-height:1.55;text-align:center}
.prose blockquote{margin:18px 0;padding:2px 0 2px 18px;border-left:3px solid var(--gold,#c9a227)}
.prose blockquote p{margin:0;font-style:italic;color:var(--navy-800)}
.postcard .postmeta .live{color:#14603a}

/* Pictures. Never wider than the column, never taller than most of a phone
   screen, and the space they will occupy is reserved before they load so the
   paragraph somebody is reading does not jump down the page under them. */
.prose figure{margin:26px 0;text-align:center}
.prose figure img{max-width:100%;height:auto;border-radius:12px;border:1px solid var(--line);
  background:#f2f5f9}
.prose figcaption{margin:9px auto 0;max-width:640px;font:400 12.6px/1.6 var(--sans);
  color:var(--muted)}
.prose p > img{max-width:100%;height:auto;border-radius:10px;vertical-align:middle}

/* Tables. The wrapper scrolls, not the page: a fee table with five columns is
   wider than a phone, and without this the whole article slides sideways and
   its left edge — where the sentences start — goes off the screen. */
.prose .tablewrap{overflow-x:auto;margin:22px 0;border:1px solid var(--line);
  border-radius:12px;background:var(--paper,#fff);-webkit-overflow-scrolling:touch}
.prose .tablewrap table{width:100%;border-collapse:collapse;font-size:13.7px;
  line-height:1.6;min-width:440px}
.prose .tablewrap th,.prose .tablewrap td{padding:10px 14px;text-align:left;
  border-bottom:1px solid var(--line);vertical-align:top}
.prose .tablewrap thead th{background:#f4f7fb;font:700 12.5px/1.5 var(--sans);
  color:var(--navy-800);letter-spacing:.02em;white-space:nowrap}
.prose .tablewrap tbody tr:last-child td{border-bottom:0}
.prose .tablewrap tbody tr:nth-child(even) td{background:#fafbfd}

/* Nested lists. Two levels is as deep as a blog post should ever go, and the
   markers change so the second level does not read as more of the first. */
.prose ul ul,.prose ol ol,.prose ul ol,.prose ol ul{margin:7px 0 3px;padding-left:22px}
.prose ul ul{list-style:circle}
.prose ul ul ul{list-style:square}

/* What was written, and what has been corrected since. */
.postfoot{margin:34px 0 0;padding-top:22px;border-top:1px solid var(--line)}
.postfoot h2{font-size:18px;margin:0 0 14px}
.related{list-style:none;margin:0;padding:0;display:grid;gap:11px;
  grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.related a{display:block;padding:14px 16px;border:1px solid var(--line);border-radius:12px;
  background:var(--paper,#fff);color:var(--navy-900)}
.related a:hover{border-color:var(--navy-600,#1c4d78);box-shadow:var(--sh-1)}
.related b{display:block;font:700 13.8px/1.45 var(--sans);margin:0 0 4px}
.related span{display:block;font:400 12.4px/1.6 var(--sans);color:var(--muted)}
.byline{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline;
  font:400 12.7px/1.6 var(--sans);color:var(--muted);margin:0 0 22px;
  padding-bottom:16px;border-bottom:1px solid var(--line)}
.byline b{font:700 12.7px/1.6 var(--sans);color:var(--navy-800)}
.byline .upd{color:#8a5a0b}
"""

RECEIPT_CSS = """
/* The acceptance receipt. Built to be printed and to be believed: a fixed-width
   fingerprint next to each document, and nothing on the page that moves. */
.rc{border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin:0 0 20px;
  background:var(--paper)}
.rc h2{font-size:19px;margin:0 0 4px}
.rc .rc-sub{font-size:12.9px;color:var(--muted);margin:0 0 16px;line-height:1.6}
.rc dl{display:grid;grid-template-columns:minmax(140px,180px) 1fr;gap:9px 16px;margin:0}
.rc dt{font:700 12.5px/1.6 var(--sans);color:var(--muted)}
.rc dd{margin:0;font:400 13.4px/1.6 var(--sans);color:var(--navy-900);word-break:break-word}
.rc .said{background:#f7f9fc;border-left:3px solid var(--navy-700);padding:13px 16px;
  border-radius:0 10px 10px 0;margin:18px 0 0;font-size:13.6px;line-height:1.7;
  color:var(--navy-900)}
.rc-docs{list-style:none;margin:14px 0 0;padding:0;display:grid;gap:8px}
.rc-docs li{display:flex;gap:10px;flex-wrap:wrap;align-items:baseline;font-size:13.2px}
.rc-docs code{font:600 11.8px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;
  background:#eef2f7;border-radius:5px;padding:2px 7px;color:#3d5a78}
.rc-terms{white-space:pre-wrap;font-size:13.4px;line-height:1.72;color:var(--navy-800);
  background:#fff;border:1px solid var(--line);border-radius:12px;padding:17px 19px;
  margin:14px 0 0}
.rc-none{background:#fdf6e6;border:1px solid #e6d5a8;color:#5b4409;border-radius:12px;
  padding:15px 17px;font-size:13.2px;line-height:1.65}
@media print{
  header.site,footer.site,.cta-band,.page-hero{display:none !important}
  .rc{border:0;padding:0}
  body{background:#fff}
}
"""

FORM_JS = """
<script>
(function () {
  var f = document.getElementById('postForm');
  if (!f) return;
  var out = document.getElementById('bfMsgOut');
  var say = function (msg, good) {
    out.textContent = msg;
    out.className = 'bf-note ' + (good ? 'ok' : 'bad');
  };
  f.addEventListener('submit', async function (e) {
    e.preventDefault();
    var name = f.name.value.trim();
    var email = f.email.value.trim();
    var phone = f.phone.value.trim().replace(/\\D/g, '').slice(-10);
    if (!name) return say('Tell us your name.');
    if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) return say('That email address is not valid.');
    if (phone.length !== 10) return say('A 10-digit Indian mobile, please.');
    var btn = document.getElementById('bfGo');
    btn.disabled = true; btn.textContent = 'Sending\\u2026';
    try {
      var r = await fetch('/api/enquiries', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          name: name, email: email, phone: phone,
          /* Which article they were reading. Without it the office gets a name
             and a number and has to ask what it is about. */
          note: 'From the blog: ' + document.title.replace(/ \\| Glovels$/, ''),
          message: f.message.value.trim(),
          consent: 'blog',
          sourcePage: location.pathname,
          referrer: document.referrer || 'direct'
        })
      });
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(d.error || 'That did not go through.');
      f.reset();
      say('Thank you \\u2014 a counsellor will come back to you within one working day.', 1);
    } catch (err) {
      say(err.message + ' You can also reach us on WhatsApp.');
    } finally {
      btn.disabled = false; btn.textContent = 'Ask a counsellor';
    }
  });
}());
</script>
"""


def build_post():
    if not POST_DONOR.exists():
        die(f"donor post missing: {POST_DONOR}")
    html = POST_DONOR.read_text(encoding="utf-8")
    html = head_holes(html)
    html = html.replace("</style>", FORM_CSS + "</style>", 1)

    # The hero: headline and the line under it.
    hero = re.search(r'(<section class="page-hero">.*?</section>)', html, re.S)
    if not hero:
        die("no page-hero in the donor post")
    html = html.replace(hero.group(1), """<section class="page-hero"><div class="wrap">
  <div class="crumbs"><a href="../index.html">Home</a> / <a href="../blog.html">Blog</a></div>
  <h1>{{H1}}</h1><p>{{DATELINE}}</p>
</div></section>""", 1)

    # The article itself, and the form under it.
    art = re.search(r'<section class="block"><div class="wrap prose">.*?</div></section>',
                    html, re.S)
    if not art:
        die("no prose section in the donor post")
    html = html.replace(art.group(0),
                        '<section class="block"><div class="wrap prose" id="article">'
                        '{{BODY}}'
                        '<p style="margin-top:30px"><a class="btn btn-ghost" href="../blog.html">'
                        'All posts</a></p></div></section>' + FORM, 1)

    html = html.replace("</body>", FORM_JS + "</body>", 1)
    out = HERE / "post" / "_post.tpl.html"
    out.write_text(html, encoding="utf-8")
    return out


def build_index():
    if not INDEX_DONOR.exists():
        die(f"donor index missing: {INDEX_DONOR}")
    html = INDEX_DONOR.read_text(encoding="utf-8")
    html = head_holes(html)
    html = html.replace("</style>", FORM_CSS + "</style>", 1)

    hero = re.search(r'(<section class="page-hero">.*?</section>)', html, re.S)
    if not hero:
        die("no page-hero in blog.html")
    html = html.replace(hero.group(1), """<section class="page-hero"><div class="wrap">
  <div class="crumbs"><a href="index.html">Home</a> / Blog</div>
  <h1>{{H1}}</h1><p>{{DATELINE}}</p>
</div></section>""", 1)

    cards = re.search(r'<section class="block"><div class="wrap prose">.*?</div></section>',
                      html, re.S)
    if not cards:
        die("no card list in blog.html")
    html = html.replace(cards.group(0),
                        '<section class="block"><div class="wrap prose" id="posts">'
                        '{{BODY}}</div></section>', 1)

    out = HERE / "_blog.tpl.html"
    out.write_text(html, encoding="utf-8")
    return out


def build_page():
    """A plain top-level page, for anything the server has to render per request.

    The acceptance receipt is the first: it is different for every order, so it
    cannot be a file. terms.html is the donor because it is the plainest page on
    the site — a heading and a column of prose, which is exactly the shape of a
    document somebody prints.
    """
    donor = HERE / "terms.html"
    if not donor.exists():
        die(f"donor page missing: {donor}")
    html = donor.read_text(encoding="utf-8")
    html = head_holes(html)
    html = html.replace("</style>", FORM_CSS + RECEIPT_CSS + "</style>", 1)

    hero = re.search(r'(<section class="page-hero">.*?</section>)', html, re.S)
    if not hero:
        die("no page-hero in terms.html")
    html = html.replace(hero.group(1), """<section class="page-hero"><div class="wrap">
  <div class="crumbs">{{CRUMBS}}</div>
  <h1>{{H1}}</h1><p>{{DATELINE}}</p>
</div></section>""", 1)

    block = re.search(r'<section class="block">.*?</section>', html, re.S)
    if not block:
        die("no prose section in terms.html")
    html = html.replace(block.group(0),
                        '<section class="block"><div class="wrap prose" id="page">'
                        '{{BODY}}</div></section>', 1)

    out = HERE / "_page.tpl.html"
    out.write_text(html, encoding="utf-8")
    return out


def main():
    a = build_post()
    b = build_index()
    c = build_page()
    for f in (a, b, c):
        t = f.read_text(encoding="utf-8")
        for hole in ("{{HEAD_TITLE}}", "{{DESC}}", "{{CANONICAL}}", "{{H1}}", "{{BODY}}",
                     "{{ARTICLE}}", "{{OG_IMAGE}}"):
            if hole not in t:
                die(f"{f.name} lost {hole} — the donor page changed shape")
    print("page templates built")
    print(f"   {a.relative_to(HERE)}")
    print(f"   {b.relative_to(HERE)}")
    print(f"   {c.relative_to(HERE)}")


if __name__ == "__main__":
    main()
