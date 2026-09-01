#!/usr/bin/env python3
"""
Glovels student portal — page builder.

The portal shell (tokens, component CSS, icon sprite, sidebar, log-out footer)
is authored ONCE and lifted from visa.html, which is the page the design was
signed off on. Every other portal screen is generated from it, so a change to
the shell cannot leave one screen looking different from its neighbours.

Why generate rather than hand-write eight files: the sidebar alone is eight
links that must agree on which page is active, and the shell is 60KB of CSS.
Copy-pasting that eight times is how a portal ends up with three different
button styles.

Run:  python3 build_portal.py
"""

import re
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
DONOR = HERE / "visa.html"

# --------------------------------------------------------------- shell parts

# The comment this script writes at the top of every stylesheet it injects, and
# the way to find one that a previous run left behind. The whole line, not the
# first few words: this script signs more than one kind of injection that way,
# and the other one is a script block with no </style> to run to.
INJECT_MARK = ("/* ---- injected by build_portal.py: "
               "rules the newer dashboard markup needs ---- */")


def strip_injected(html, donor=False):
    """Take out any stylesheet an earlier run of this script put in.

    The donor below is visa.html — a page this script GENERATES. So the head
    every portal page is built from is last build's head, injected stylesheet
    and all, and this build then injects another copy into it. Nothing ever
    took the old one out, so the sheet stacked up once per build: five copies
    of nine hundred lines in every staff and student page, which is most of
    what those files weigh. The rules are identical, so nothing rendered wrong
    and nobody noticed.

    The dashboard branch at the bottom of this file has done exactly this to
    its own copy from the beginning. This is the same two lines, applied where
    the head is read rather than where one page is written.
    """
    # The whitespace in front of the marker goes too. Leaving it behind is what
    # made this file grow by one blank line on every single build.
    out = re.sub(r"\s*" + re.escape(INJECT_MARK) + r".*?</style>", "</style>",
                 html, flags=re.S)
    # Stacked copies leave the empty shells they were wrapped in behind.
    out = re.sub(r"<style>\s*</style>", "", out)
    # And the student app's manifest block, for the same reason: apply_fixes
    # adds it to visa.html, visa.html is the donor, and without this every
    # staff screen built from that head would announce itself as the student
    # app — wrong manifest, wrong name on the home screen, and our name back on
    # the white-labelled partner page.
    out = re.sub(r"\s*<!-- GLOVELS-APP-MANIFEST -->.*?<!-- /GLOVELS-APP-MANIFEST -->",
                 "", out, flags=re.S)
    # And, FOR THE DONOR ONLY, any sheet apply_fixes injects into a head.
    #
    # Same trap, third time: the donor is a page this build wrote and that file
    # then patched, so anything left in its head arrives in every portal page
    # for free and then gets a second copy added on top. Every injected <style>
    # carries a GLOVELS-…-CSS marker on its first line so it can be taken out.
    #
    # `donor` matters. This function is also used on dashboard.html, which is
    # rewritten in place rather than regenerated — stripping there took the
    # sheet out while apply_fixes, which guards on the SCRIPT marker beside it,
    # saw its work already done and never put the sheet back. The dashboard
    # spent one build with a repainted card and no styles for it.
    if donor:
        out = re.sub(r"\s*<style>/\* GLOVELS-[A-Z0-9-]+-CSS \*/.*?</style>",
                     "", out, flags=re.S)
    return out


def shell_parts():
    """head (through </head>), and the icon sprite, taken from the donor page."""
    h = DONOR.read_text(encoding="utf-8")
    head_end = h.index("</head>") + len("</head>")
    head = strip_injected(h[:head_end], donor=True)
    m = re.search(r'<svg width="0" height="0".*?</svg>', h, re.S)
    if not m:
        sys.exit("sprite not found in donor page")
    return head, m.group(0)


HEAD_RAW, SPRITE = shell_parts()

# One icon the donor page never needed. `<use>` on a symbol that does not exist
# renders nothing at all — no icon, no error, and a nav item that sits with a
# blank space where every other item has a picture, which reads as broken.
GLOBE = (
    '<symbol id="i-globe" viewBox="0 0 24 24">'
    '<circle cx="12" cy="12" r="9"/>'
    '<path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"/>'
    '</symbol>'
)
if 'id="i-globe"' not in SPRITE:
    SPRITE = SPRITE.replace("</defs>", GLOBE + "</defs>")

# Two more the donor page never needed — the Blog and Leads screens. A <use> on
# a symbol that is not there renders nothing at all: no icon, no error, and a
# nav item sitting in a blank space where every other item has a picture, which
# reads as broken rather than as missing.
EXTRA_ICONS = {
    "i-book": '<symbol id="i-book" viewBox="0 0 24 24">'
              '<path d="M4 5.5A2 2 0 0 1 6 4h13v16H6a2 2 0 0 0-2 2z"/>'
              '<path d="M19 16H6a2 2 0 0 0-2 2"/></symbol>',
    "i-chart": '<symbol id="i-chart" viewBox="0 0 24 24">'
               '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></symbol>',
}
for _id, _svg in EXTRA_ICONS.items():
    if f'id="{_id}"' not in SPRITE:
        SPRITE = SPRITE.replace("</defs>", _svg + "</defs>")

# The nav, declared once. `slug` marks the active item.
NAV = [
    ("dashboard",    "i-grid",   "Dashboard"),
    ("profile",      "i-user",   "My Profile"),
    ("documents",    "i-file",   "Documents"),
    ("universities", "i-cap",    "My Universities"),
    ("applications", "i-plane",  "Applications"),
    ("services",     "i-star",   "Services"),
    ("scholarships", "i-wallet", "Scholarships"),
    ("visa",         "i-shield", "Visa &amp; Enrollment"),
    ("messages",     "i-chat",   "Messages"),
]


def head_for(title, brand=True):
    """Donor head with the title swapped. Everything else is shared verbatim.

    `brand=False` is the white-label case: a partner showing this screen to
    their own student should not have our name sitting in the browser tab."""
    suffix = " | Glovels" if brand else ""
    return re.sub(r"<title>.*?</title>",
                  f"<title>{title}{suffix}</title>", HEAD_RAW, count=1, flags=re.S)


def sidebar(active):
    on = ' class="on"'
    links = "".join(
        f'<a href="{slug}.html"{on if slug == active else ""}>'
        f'<svg class="ico" aria-hidden="true"><use href="#{icon}"/></svg> {label}</a>'
        for slug, icon, label in NAV
    )
    return f"""<div class="p-shell">
  <aside class="p-side">
    <div class="p-logo"><span class="logo-img" role="img" aria-label="Glovels"></span></div>
    <!-- Sign out belongs where somebody looks for it: beside their own name, at
         the top. At the bottom of a nav it sits below the fold on a laptop and
         under the whole menu on a phone, so the way to leave was the one thing
         on the screen you had to scroll to find. -->
    <div class="p-who">
      <b id="whoName">—</b>
      <a href="#" id="signOut" class="p-out">
        <svg class="ico" aria-hidden="true"><use href="#i-out"/></svg> Sign out</a>
    </div>
    <nav class="p-nav">{links}</nav>
  </aside>
"""


# ------------------------------------------------------------- staff shell
# Counsellors and admins get the same visual system as the student portal —
# same tokens, same components — but a different sidebar and no student data
# loader. Sharing the shell is what stops the internal screens looking like a
# different product built by a different team.

MUST_CHANGE_JS = """
/*
 * An account still holding a password we generated goes to one place.
 *
 * This used to replace the body of whatever portal screen you were on, which
 * left that screen's own scripts running against elements that no longer
 * existed — a TypeError on the dashboard, from code that had every right to
 * assume its own page was still there. The form lives on the sign-in page
 * instead, which is where every other password form already is.
 */
function mustChangeScreen() {
  const here = location.pathname + location.search;
  location.replace('login.html?change=1&next=' + encodeURIComponent(here));
}
"""

STAFF_NAV = [
    ("counsellor", "i-chat",   "Conversations"),
    ("chat",       "i-globe",  "Website chat"),
    ("leads",      "i-chart",  "Leads"),
    ("home",       "i-file",   "Home page"),
    # The public blog lives at blog.html, so the screen that writes it cannot.
    ("blog-admin", "i-book",   "Blog"),
    ("catalogue",  "i-cap",    "Catalogue"),
    ("admin",      "i-grid",   "Organisation"),
]


def staff_sidebar(active, role_note, nav=None, brand=True):
    """The staff rail. `nav` overrides the menu — a partner is not staff and
    must not be offered a single screen that would refuse them."""
    on = ' class="on"'
    links = "".join(
        f'<a href="{slug}.html"{on if slug == active else ""}>'
        f'<svg class="ico" aria-hidden="true"><use href="#{icon}"/></svg> {label}</a>'
        for slug, icon, label in (nav if nav is not None else STAFF_NAV)
    )
    mark = ('<span class="logo-img" role="img" aria-label="Glovels"></span>'
            if brand else '')
    return f"""<div class="p-shell">
  <aside class="p-side">
    <div class="p-logo">{mark}
      <img id="ownLogo" alt="" hidden></div>
    <div class="plan-badge"><b id="staffName">\u2014</b><span id="staffRole">{role_note}</span>
      <a href="#" id="staffOut" class="p-out">
        <svg class="ico" aria-hidden="true"><use href="#i-out"/></svg> Sign out</a></div>
    <nav class="p-nav">{links}</nav>
  </aside>
"""


def staff_page(slug, title, h1, sub, body, script, role_note, nav=None, tools=True,
               brand=True):
    # The staff screens use the same top bar, plan badge and SLA chip as the
    # dashboard, and those rules live in the injected sheet rather than the
    # donor stylesheet — so they have to come along, or the header renders as
    # three words run together.
    import portal_dashboard_css, portal_push
    extra = ("<style>" + portal_dashboard_css.CSS + "</style>"
             # The manifest is what makes "Add to Home Screen" produce an app
             # rather than a bookmark, and on an iPhone it is the precondition
             # for notifications working at all.
             + '<link rel="manifest" href="/manifest.webmanifest">'
             + '<meta name="theme-color" content="#0b1e31">'
             + '<link rel="apple-touch-icon" href="/icon-192.png">'
             + '<meta name="apple-mobile-web-app-capable" content="yes">'
             + '<meta name="apple-mobile-web-app-title" content="'
             + ("Glovels" if brand else "Students") + '">')

    # Built out here rather than inline: an f-string expression may not contain
    # a backslash, and the live dot's ellipsis is one.
    tool_bar = ""
    bell_panel = ""
    if tools:
        tool_bar = (
            '<span class="sla" id="liveDot">connecting\u2026</span>\n'
            '      <button type="button" class="bell" id="bell" aria-expanded="false"\n'
            '        aria-controls="bellPanel" title="What needs doing">\n'
            '        <svg class="ico" aria-hidden="true"><use href="#i-clock"/></svg>\n'
            '        <span class="bell-n" id="bellN" hidden>0</span></button>')
        bell_panel = ('<div class="bell-panel" id="bellPanel" hidden role="dialog"\n'
                      '      aria-label="What needs doing"></div>')

    return f"""{head_for(title, brand).replace("</head>", extra + "</head>")}
<body>
{SPRITE}
{staff_sidebar(slug, role_note, nav, brand)}  <main class="p-main">
    <div class="p-bar">
      <span class="p-bar-title" id="crumb">{h1}</span>
      {tool_bar}
      <span class="p-av" id="staffAv">\u2014</span>
    </div>
    {bell_panel}
    <div class="p-top">
      <div><h1>{h1}</h1><p>{sub}</p></div>
    </div>
{portal_push.BAR if tools else ""}
{body}
  </main>
</div>
<script>
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function esc(s) {{
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}}[c]));
}}
function ico(n) {{ return '<svg class="ico" aria-hidden="true"><use href="#i-' + n + '"/></svg>'; }}
const api = async (method, path, body) => {{
  const opts = {{ method, credentials: 'same-origin', headers: {{}} }};
  if (body !== undefined) {{
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }}
  const r = await fetch(path, opts);
  if (r.status === 401) {{ location.href = 'login.html?next=' + encodeURIComponent(location.pathname); throw new Error('signed out'); }}
  const data = await r.json().catch(() => ({{}}));
  if (!r.ok) {{
    const err = new Error(data.error || ('HTTP ' + r.status));
    /* Carried through rather than parsed out of the message. The server sets
       this on every route while an account still holds a password somebody
       else chose, and the boot turns it into the one screen that account can
       use. */
    if (data.mustChange) err.mustChange = true;
    throw err;
  }}
  return data;
}};
/* In the middle of the screen, not tucked under the button that was pressed.
   Vishal: "the confirmation message shows up right next to the Save button, it
   must be displayed in the centre of the page clearly and prominently." At the
   bottom edge it competes with whatever the thumb is already covering, and on
   a long form it can land off-screen entirely.

   Still not an alert(): nothing is blocked, and it leaves on its own. */
function toast(msg, tone) {{
  let t = $('#toast');
  if (!t) {{
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }}
  const bad = tone === 'bad';
  t.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%) scale(.96);' +
    'z-index:400;background:' + (bad ? '#7a2118' : 'var(--navy-900)') + ';color:#fff;' +
    'font:700 15.4px/1.5 var(--sans);padding:20px 26px;border-radius:16px;' +
    'box-shadow:0 26px 70px rgba(11,30,49,.42);max-width:min(460px,88vw);text-align:center;' +
    'display:flex;align-items:center;gap:12px;pointer-events:none;opacity:0;' +
    'transition:opacity .16s, transform .16s';
  t.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" ' +
    'stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" ' +
    'style="flex:none">' + (bad
      ? '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.4h.01"/>'
      : '<path d="m5 12.8 4.4 4.4L19 7.6"/>') + '</svg><span></span>';
  t.querySelector('span').textContent = msg;
  requestAnimationFrame(() => {{
    t.style.opacity = '1';
    t.style.transform = 'translate(-50%,-50%) scale(1)';
  }});
  clearTimeout(t._h);
  t._h = setTimeout(() => {{
    t.style.opacity = '0';
    t.style.transform = 'translate(-50%,-50%) scale(.96)';
  }}, bad ? 3600 : 2400);
}}
const timeAgo = iso => {{
  if (!iso) return '';
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}};

/* ------------------------------------------------------ long lists, in pages
 *
 * Every office table here rendered every row it had. With four students that
 * is obviously right and with four hundred it is obviously wrong, and there
 * was nothing in between: the Organisation screen at 131 students was 543 rows
 * across four stacked tables and thirty-four screens of scrolling.
 *
 * Two rules this follows, both learned from the cap it replaces — the
 * catalogue used to stop at 400 rows and say nothing, so at 401 universities
 * one of them simply was not there:
 *
 *   the count is always the TRUE count, never the shown count
 *   a page that is holding rows back says so, in words, on the screen
 *
 * Paging happens in the browser. The list has already been fetched and the
 * whole of it is needed for search and for the totals above it, so asking the
 * server for twenty-five of them would be a second round trip to show less.
 * That reasoning stops being true somewhere around two thousand students,
 * where the fetch itself gets heavy; the honest answer then is server-side
 * paging, not a bigger page.
 */
const PAGE_SIZE = 25;
/* The conversation roster is a narrow scrolling column rather than a table, so
   it takes more before it becomes hard to read. */
const PAGE_SIZES = {{ case: 50 }};
const PAGE_AT = {{}}, PAGE_PAINT = {{}};
const pageOf = key => PAGE_AT[key] || 0;

/* The rows this page shows. Clamped, because a search can shrink the list
   under somebody standing on page six and an unclamped slice would hand them
   an empty table rather than the last page of results. */
const sizeOf = key => PAGE_SIZES[key] || PAGE_SIZE;
function paged(key, list) {{
  const n = sizeOf(key);
  const last = Math.max(0, Math.ceil(list.length / n) - 1);
  if (pageOf(key) > last) PAGE_AT[key] = last;
  const from = pageOf(key) * n;
  return list.slice(from, from + n);
}}

/* The control underneath. Returns nothing at all when everything fits, so a
   short list looks exactly as it did before. */
function pagerHtml(key, total, noun, repaint) {{
  PAGE_PAINT[key] = repaint;
  const n = sizeOf(key);
  if (total <= n) return '';
  const pages = Math.ceil(total / n), at = Math.min(pageOf(key), pages - 1);
  const from = at * n + 1, to = Math.min(total, (at + 1) * n);
  const btn = (to_, label, on, disabled) =>
    '<button type="button" class="pgb' + (on ? ' on' : '') + '"' +
    (disabled ? ' disabled' : ' data-pg="' + key + '|' + to_ + '"') + '>' + label + '</button>';
  /* First, last, and a window around where they are. A hundred numbered
     buttons is its own kind of unreadable. */
  const want = new Set([0, pages - 1, at, at - 1, at + 1]);
  const nums = [...want].filter(n => n >= 0 && n < pages).sort((a, b) => a - b);
  let out = '', prev = -1;
  nums.forEach(n => {{
    if (prev >= 0 && n > prev + 1) out += '<span class="pgg">…</span>';
    out += btn(n, String(n + 1), n === at);
    prev = n;
  }});
  return '<div class="pgr">' +
    '<span class="pgn">' + from + '–' + to + ' of ' + total + ' ' +
      esc(noun || 'rows') + '</span>' +
    '<span style="flex:1"></span>' +
    btn(at - 1, 'Previous', false, at === 0) + out +
    btn(at + 1, 'Next', false, at >= pages - 1) +
    '</div>';
}}

/* ------------------------------------------- a table that continues sideways
 *
 * "The sidebar to move to the side is missing." It was not missing — macOS
 * simply does not draw a scrollbar until something moves, so a table wider
 * than its card reads as a table that has been cut off with no way to reach
 * the rest of it.
 *
 * This wraps every horizontally scrolling card, shades whichever edge still
 * has content behind it, and says so in words underneath. The scrollbar itself
 * is styled to be always drawn in the sheet beside this.
 */
function armScroll(box) {{
  if (!box || box.dataset.scrollArmed) return;
  box.dataset.scrollArmed = '1';
  box.classList.add('scrollx');
  const wrap = document.createElement('div');
  wrap.className = 'scrollwrap';
  box.parentNode.insertBefore(wrap, box);
  wrap.appendChild(box);
  const say = document.createElement('p');
  say.className = 'scrollsay';
  say.hidden = true;
  wrap.appendChild(say);
  const paint = () => {{
    const more = box.scrollWidth - box.clientWidth;
    const left = box.scrollLeft;
    wrap.classList.toggle('more-left', left > 4);
    wrap.classList.toggle('more-right', more - left > 4);
    say.hidden = more <= 4;
    if (more > 4) {{
      say.textContent = left > 4
        ? 'Scroll sideways to see the rest of this table.'
        : 'This table is wider than the screen \u2014 scroll sideways for the '
          + 'remaining columns.';
    }}
  }};
  box.addEventListener('scroll', paint, {{ passive: true }});
  addEventListener('resize', paint);
  /* The table is painted after the data arrives, so its width is not known at
     the moment this runs. */
  if (typeof ResizeObserver === 'function') {{
    try {{ new ResizeObserver(paint).observe(box.firstElementChild || box); }} catch (e) {{}}
  }}
  setTimeout(paint, 60);
  setTimeout(paint, 900);
  setTimeout(paint, 2600);
  paint();
}}
addEventListener('DOMContentLoaded', () => {{
  $$('.p-card').forEach(c => {{
    if (c.querySelector('table') && getComputedStyle(c).overflowX === 'auto') armScroll(c);
  }});
}});

document.addEventListener('click', e => {{
  const b = e.target.closest('[data-pg]');
  if (!b) return;
  const bits = b.dataset.pg.split('|');
  PAGE_AT[bits[0]] = Math.max(0, Number(bits[1]) || 0);
  const fn = PAGE_PAINT[bits[0]];
  if (fn) fn();
  /* Back to the top of the table, not the top of the page — a next-page click
     that leaves you looking at the middle of the new page is disorienting. */
  const box = b.closest('.p-sec') || b.closest('.p-card') || b.parentElement;
  if (box && box.scrollIntoView) box.scrollIntoView({{ block: 'start', behavior: 'smooth' }});
}});

/* The live stream. EventSource reconnects on its own, so the only thing to do
   here is say plainly whether it is up — a chat that has quietly gone deaf
   while still looking connected is worse than one that admits it. */
let ES = null;
function connectLive(handlers) {{
  ES = new EventSource('/api/live');
  ES.addEventListener('hello', () => {{
    const d = $('#liveDot');
    d.textContent = 'live';
    d.className = 'sla';
  }});
  ES.onerror = () => {{
    const d = $('#liveDot');
    d.textContent = 'reconnecting\u2026';
    d.className = 'sla late';
  }};
  Object.keys(handlers).forEach(ev =>
    ES.addEventListener(ev, e => handlers[ev](JSON.parse(e.data))));
}}

{MUST_CHANGE_JS}
async function staffBoot(run) {{
  let me;
  try {{
    me = await api('GET', '/api/staff/me');
  }} catch (e) {{
    if (e.message === 'signed out') return;
    if (e.mustChange) return mustChangeScreen({{ role: 'staff' }});
    document.querySelector('.p-main').innerHTML =
      '<div class="sl-empty" style="margin-top:40px"><b>This screen is not for your account</b>' +
      '<p>' + esc(e.message) + '</p><a class="btn btn-primary" href="dashboard.html">Go to my dashboard</a></div>';
    return;
  }}
  $('#staffName').textContent = me.user.name;
  $('#staffRole').textContent = me.user.role === 'admin' ? 'Administrator'
    : me.user.role === 'editor' ? 'Website editor' : 'Counsellor';

  /* The menu shows what this account can actually open. A link to a screen that
     answers "not your workspace" is worse than no link: it reads as something
     broken rather than something withheld. */
  const perms = me.user.perms || [];
  const allowed = {{
    counsellor: me.user.role !== 'editor',
    chat: me.user.role !== 'editor',
    /* The lead book is casework — an editor is on this site to change the
       website, not to be handed somebody's phone number. */
    leads: me.user.role !== 'editor',
    admin: me.user.role === 'admin',
    catalogue: perms.indexOf('catalogue') >= 0,
    home: perms.indexOf('content') >= 0,
    'blog-admin': perms.indexOf('content') >= 0,
  }};
  $$('.p-nav a').forEach(a => {{
    const slug = (a.getAttribute('href') || '').replace('.html', '');
    if (slug in allowed && !allowed[slug]) a.remove();
  }});
  $('#staffAv').textContent = me.user.name.trim().slice(0, 1).toUpperCase();
  $('#staffOut').onclick = async e => {{
    e.preventDefault();
    await fetch('/api/auth/logout', {{ method: 'POST', credentials: 'same-origin' }});
    location.href = 'login.html';
  }};
  bell(me);
  run(me);
}}

/*
 * The bell.
 *
 * On every staff screen, because "everyone should be alerted so that tasks are
 * completed on time" cannot mean "on the one screen they remembered to open".
 * The number is how many things are late — deadlines coming, students who have
 * been waiting for a reply, files that are still short, follow-ups somebody
 * promised. Pressing one goes to the thing rather than to a list about it.
 */
async function bell(me) {{
  const b = $('#bell'), n = $('#bellN'), panel = $('#bellPanel');
  if (!b) return;
  /* A website editor has no students and no leads; the endpoint would refuse
     them and the bell would sit there permanently empty. */
  if (me.user.role === 'editor') {{ b.remove(); return; }}

  let openNow = false;

  const paint = d => {{
    const c = d.counts || {{}};
    const hot = c.now || 0;
    n.hidden = !c.total;
    n.textContent = c.total > 99 ? '99+' : c.total;
    n.className = 'bell-n' + (hot ? '' : ' quiet');
    b.title = c.total
      ? c.total + ' thing(s) need doing' + (hot ? ', ' + hot + ' of them late' : '')
      : 'Nothing is waiting';

    const who = (d.byPerson || []).length
      ? '<div class="bell-who">' + d.byPerson.map(p =>
          '<span class="' + (p.now ? 'hot' : '') + '">' + esc(p.name) + ' ' + p.total
          + (p.now ? ' · ' + p.now + ' late' : '') + '</span>').join('') + '</div>'
      : '';

    panel.innerHTML = '<h4>What needs doing</h4>' + who
      + ((d.alerts || []).map(a =>
          '<button type="button" class="al ' + esc(a.urgency) + '" '
          + 'data-student="' + esc((a.subject || {{}}).studentId || '') + '" '
          + 'data-lead="' + esc((a.subject || {{}}).leadId || '') + '">'
          + '<b><i></i>' + esc(a.title) + '</b><span>' + esc(a.detail) + '</span></button>'
        ).join('')
        || '<p class="bell-empty"><b>Nothing is waiting.</b><br>No deadline inside six '
           + 'weeks, nobody waiting on a reply, and every follow-up is on time.</p>');
  }};

  const load = async () => {{
    try {{ paint(await api('GET', '/api/staff/alerts')); }}
    catch (e) {{ /* signed out, or not this account's screen */ }}
  }};

  b.onclick = () => {{
    openNow = !openNow;
    panel.hidden = !openNow;
    b.setAttribute('aria-expanded', String(openNow));
    if (openNow) load();
  }};
  document.addEventListener('click', e => {{
    if (!openNow) return;
    if (e.target.closest('#bellPanel') || e.target.closest('#bell')) return;
    openNow = false; panel.hidden = true; b.setAttribute('aria-expanded', 'false');
  }});
  panel.addEventListener('click', e => {{
    const a = e.target.closest('.al');
    if (!a) return;
    if (a.dataset.lead) location.href = 'leads.html';
    else if (a.dataset.student) location.href = 'counsellor.html#s' + a.dataset.student;
  }});

  load();
  /* Every five minutes. A deadline does not move, but a student's message
     does, and a bell that is only right when the page was loaded is a bell
     that stops being looked at. */
  setInterval(load, 300000);
}}
{portal_push.SCRIPT}
{script}

/* Opened by double-clicking rather than through start.command. The portal has
   nothing to talk to in that state and the sign-in cannot work, which is not
   obvious from the inside — the page looks fine. So it says so, at the top,
   where it cannot be missed. apply_fixes.py puts the same thing on the
   marketing pages; it is here as well so a rebuild does not remove it. */
if (location.protocol === 'file:') {{
  const b = document.createElement('div');
  b.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;padding:13px 18px;' +
    'background:#7a2118;color:#fff;font:600 13.5px/1.55 system-ui,-apple-system,sans-serif;' +
    'text-align:center;box-shadow:0 4px 18px rgba(0,0,0,.25)';
  b.innerHTML = '<b>This page was opened straight from the folder.</b> Links and sign-in ' +
    'will not work. Close this tab, double-click <b>start.command</b>, and use the address ' +
    'it opens \u2014 <b>http://localhost:8080</b>';
  document.body.appendChild(b);
  document.body.style.paddingTop = b.offsetHeight + 'px';
}}
</script>
</body>
</html>
"""


DEMO_STRIP = ('<div class="p-demo" id="pDemo"><svg class="ico" aria-hidden="true"><use href="#i-info"/></svg> '
              '<span id="pDemoTxt">Signed in. Everything on this screen is saved to your account on '
              'the server.</span></div>')


def page(slug, title, h1, sub, body, script="", topright=""):
    # The student screens are built from the donor head, which carries the
    # designer's stylesheet and not the rules written since. Sign out beside
    # their name at the top of the sidebar is one of those, so without this it
    # rendered as two bare words floating above the menu.
    import portal_dashboard_css
    head = head_for(title).replace(
        "</head>", "<style>" + portal_dashboard_css.CSS + "</style></head>", 1)
    return f"""{head}
<body>
{SPRITE}
{sidebar(slug)}  <main class="p-main">
    {DEMO_STRIP}
    <div class="p-top">
      <div><h1>{h1}</h1><p>{sub}</p></div>
      {topright}
    </div>
{body}
  </main>
</div>
<script>
/* ---------------------------------------------------------------------------
   Shared portal runtime.

   Student data lives on the server, in a database. This layer loads it once per
   screen and writes changes back. The page code below still reads and writes a
   plain `DB` object and calls save() — that shape was kept deliberately, so the
   screens did not have to be rewritten around promises.

   save() does not send `DB`. It diffs against what the server last confirmed and
   sends only what changed, through the endpoint that owns it. A screen cannot
   accidentally overwrite a field it never touched.

   If the server cannot be reached the screen still works and says so, holding
   changes in the browser — a dropped connection should not lose the paragraph a
   student just typed.
   --------------------------------------------------------------------------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let DB = {{}};
let ONLINE = true;
let SERVER = {{ short: [], apps: {{}}, saved: [] }};
const LOCAL_KEY = 'glovels.portal.offline';

const api = async (method, path, body, isForm) => {{
  const opts = {{ method, credentials: 'same-origin', headers: {{}} }};
  if (body !== undefined) {{
    if (isForm) opts.body = body;
    else {{ opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }}
  }}
  const r = await fetch(path, opts);
  if (r.status === 401) {{ location.href = 'login.html?next=' + encodeURIComponent(location.pathname); throw new Error('signed out'); }}
  const data = await r.json().catch(() => ({{}}));
  if (!r.ok) throw Object.assign(new Error(data.error || ('HTTP ' + r.status)),
    {{ status: r.status, data, mustChange: !!data.mustChange }});
  return data;
}};

function esc(s) {{
  return String(s).replace(/[&<>"]/g, c => ({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}}[c]));
}}
function ico(n) {{ return '<svg class="ico" aria-hidden="true"><use href="#i-' + n + '"/></svg>'; }}

/* A toast, not an alert(). An alert blocks the page and reads as an error even
   when it is a confirmation. */
/* In the middle of the screen, not tucked under the button that was pressed.
   Vishal: "the confirmation message shows up right next to the Save button, it
   must be displayed in the centre of the page clearly and prominently." At the
   bottom edge it competes with whatever the thumb is already covering, and on
   a long form it can land off-screen entirely.

   Still not an alert(): nothing is blocked, and it leaves on its own. */
function toast(msg, tone) {{
  let t = $('#toast');
  if (!t) {{
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }}
  const bad = tone === 'bad';
  t.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%) scale(.96);' +
    'z-index:400;background:' + (bad ? '#7a2118' : 'var(--navy-900)') + ';color:#fff;' +
    'font:700 15.4px/1.5 var(--sans);padding:20px 26px;border-radius:16px;' +
    'box-shadow:0 26px 70px rgba(11,30,49,.42);max-width:min(460px,88vw);text-align:center;' +
    'display:flex;align-items:center;gap:12px;pointer-events:none;opacity:0;' +
    'transition:opacity .16s, transform .16s';
  t.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" ' +
    'stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" ' +
    'style="flex:none">' + (bad
      ? '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.4h.01"/>'
      : '<path d="m5 12.8 4.4 4.4L19 7.6"/>') + '</svg><span></span>';
  t.querySelector('span').textContent = msg;
  requestAnimationFrame(() => {{
    t.style.opacity = '1';
    t.style.transform = 'translate(-50%,-50%) scale(1)';
  }});
  clearTimeout(t._h);
  t._h = setTimeout(() => {{
    t.style.opacity = '0';
    t.style.transform = 'translate(-50%,-50%) scale(.96)';
  }}, bad ? 3600 : 2400);
}}

function offlineNotice(why) {{
  ONLINE = false;
  const box = $('#pDemo'), txt = $('#pDemoTxt');
  if (!box) return;
  box.style.background = '#fdf6e6';
  box.style.borderColor = '#e6d5a8';
  box.style.color = '#5b4409';
  txt.textContent = 'Working offline — ' + why + ' Your changes are held in this browser and are '
    + 'not saved to your account. Start the server and reload.';
}}

/* Changes are queued and flushed on a short timer: typing in the profile form
   fires save() on every field, and one request per keystroke is both wasteful
   and a race with itself. */
let flushTimer = null, flushing = false;
function save() {{
  try {{ localStorage.setItem(LOCAL_KEY, JSON.stringify(DB)); }} catch (e) {{}}
  if (!ONLINE) return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 350);
}}

async function flush() {{
  if (flushing) {{ clearTimeout(flushTimer); flushTimer = setTimeout(flush, 250); return; }}
  flushing = true;
  try {{
    if (DB.profile && JSON.stringify(DB.profile) !== JSON.stringify(SERVER.profile)) {{
      await api('PUT', '/api/profile', {{ profile: DB.profile }});
      SERVER.profile = JSON.parse(JSON.stringify(DB.profile));
    }}
    if (Array.isArray(DB.short)) {{
      for (const id of DB.short) if (!SERVER.short.includes(id)) await api('POST', '/api/shortlist', {{ id }});
      /* Additions only. A student cannot take a university off their own
         shortlist — it is what the package delivered and what the counsellor
         confirms before anything is submitted — so a browser whose local copy
         is short of the server's is a stale browser, not an instruction to
         delete. This loop used to obey it. */
      SERVER.short = DB.short.slice();
    }}
    if (DB.apps) {{
      for (const id of Object.keys(DB.apps)) {{
        const a = DB.apps[id], b = SERVER.apps[id];
        if (!b || b.stage !== a.stage || b.outcome !== a.outcome) {{
          await api('PUT', '/api/applications/' + encodeURIComponent(id), a);
          SERVER.apps[id] = {{ stage: a.stage, outcome: a.outcome }};
        }}
      }}
    }}
    if (Array.isArray(DB.saved)) {{
      for (const id of DB.saved) if (!SERVER.saved.includes(id)) await api('PUT', '/api/scholarships/' + encodeURIComponent(id), {{ saved: true }});
      for (const id of SERVER.saved) if (!DB.saved.includes(id)) await api('PUT', '/api/scholarships/' + encodeURIComponent(id), {{ saved: false }});
      SERVER.saved = DB.saved.slice();
    }}
  }} catch (e) {{
    if (e.message !== 'signed out') offlineNotice('the server did not respond.');
  }} finally {{
    flushing = false;
  }}
}}
/* A student who closes the tab mid-edit must not lose the edit. */
addEventListener('beforeunload', () => {{ if (ONLINE && flushTimer) {{ clearTimeout(flushTimer); flush(); }} }});

/* Boot: who is this, and what have they got. Signed out goes to the sign-in
   page rather than showing an empty portal that looks broken. */
{MUST_CHANGE_JS}
async function boot(run) {{
  let state = null;
  try {{
    state = await api('GET', '/api/state');
  }} catch (e) {{
    if (e.message === 'signed out') return;
    if (e.mustChange) return mustChangeScreen({{ role: 'student' }});
    try {{ DB = JSON.parse(localStorage.getItem(LOCAL_KEY)) || {{}}; }} catch (x) {{ DB = {{}}; }}
    offlineNotice('the Glovels server is not running.');
    ORDER = DB.order || {{}};
    USER = DB.user || {{}};
    HANDOVER_KEYS = Array.isArray(DB.short) ? DB.short.slice() : [];
  ORDERS = (DB.user && DB.user.orders) || [];
    return run();
  }}
  USER  = state.user  || {{}};
  ORDER = state.order || {{}};
  COUNSELLOR = state.counsellor || null;
  DB = {{
    profile: state.profile || {{}},
    short:   state.shortlist.map(p => p.id),
    apps:    state.apps || {{}},
    docs:    state.docs || {{}},
    saved:   state.saved || [],
    msgs:    state.msgs || [],
    user:    state.user,
    order:   state.order,
  }};
  SHORT_ROWS = state.shortlist;
  /* Before the page paints. A screen that renders the snapshot and then swaps
     it out under the reader is worse than one that waits 80ms. */
  if (typeof loadLiveCatalogue === 'function') await loadLiveCatalogue();
  /* What an entry package owes this student and whether it has arrived. Null
     for everybody who has not bought one. */
  MATCHED = state.matched || null;
  /* Every order this student has placed, with what was in each. The Services
     screen needs it to mark what they have already bought; nothing else reads
     it, and it costs nothing — /api/state already carried it. */
  ORDERS = state.orders || [];
  HANDOVER_KEYS = DB.short.slice();
  SERVER = {{
    profile: JSON.parse(JSON.stringify(DB.profile)),
    short: DB.short.slice(),
    apps: JSON.parse(JSON.stringify(DB.apps)),
    saved: DB.saved.slice(),
  }};
  const avatar = $('#pAvatar');
  if (avatar && USER.name) avatar.textContent = USER.name.trim().slice(0, 1).toUpperCase();
  /* Their own name beside the way out, at the top of the sidebar. */
  const who = $('#whoName');
  if (who) who.textContent = USER.name || USER.email || 'Signed in';
  const out = $('#signOut');
  if (out) {{
    out.onclick = async e => {{
      e.preventDefault();
      try {{
        await fetch('/api/auth/logout', {{ method: 'POST', credentials: 'same-origin' }});
      }} catch (err) {{}}
      location.href = 'login.html';
    }};
  }}
  run();
}}

let USER = {{}}, ORDER = {{}}, HANDOVER_KEYS = [], SHORT_ROWS = [], COUNSELLOR = null, ORDERS = [], MATCHED = null;
{script}

/* Opened by double-clicking rather than through start.command. The portal has
   nothing to talk to in that state and the sign-in cannot work, which is not
   obvious from the inside — the page looks fine. So it says so, at the top,
   where it cannot be missed. apply_fixes.py puts the same thing on the
   marketing pages; it is here as well so a rebuild does not remove it. */
if (location.protocol === 'file:') {{
  const b = document.createElement('div');
  b.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;padding:13px 18px;' +
    'background:#7a2118;color:#fff;font:600 13.5px/1.55 system-ui,-apple-system,sans-serif;' +
    'text-align:center;box-shadow:0 4px 18px rgba(0,0,0,.25)';
  b.innerHTML = '<b>This page was opened straight from the folder.</b> Links and sign-in ' +
    'will not work. Close this tab, double-click <b>start.command</b>, and use the address ' +
    'it opens \u2014 <b>http://localhost:8080</b>';
  document.body.appendChild(b);
  document.body.style.paddingTop = b.offsetHeight + 'px';
}}
</script>
</body>
</html>
"""


# ------------------------------------------------- dashboard API bootstrap
#
# The dashboard was written against three localStorage keys the sales page used
# to write. Rather than rewrite it, its own code is wrapped in a function and
# run only after the student's real record has arrived and been put into those
# same keys — so the file the designer maintains stays as it is, and what it
# renders is what the database holds.

DASH_BOOT_PREFIX = """
/* ---- injected by build_portal.py: load this student's real record first ---- */
async function __dashBoot(main) {
  try {
    const r = await fetch('/api/state', { credentials: 'same-origin' });
    if (r.status === 401) {
      location.href = 'login.html?next=' + encodeURIComponent('/dashboard');
      return;
    }
    /* An account still holding a password we generated. The server refuses
       every other endpoint until it is replaced, so showing the dashboard would
       show an empty one — which is exactly what it did: "No package yet" to
       somebody who had just bought a package. */
    if (r.status === 403) {
      const why = await r.json().catch(function () { return {}; });
      if (why && why.mustChange) return mustChangeScreen({ role: 'student' });
    }
    if (r.ok) {
      const s = await r.json();
      /* Written into the keys the dashboard already reads, so its own code did
         not have to change. These are a cache of the server's answer, not the
         source of truth — the server is. */
      localStorage.setItem('glovels_user', JSON.stringify(s.user || {}));
      localStorage.setItem('glovels_order', JSON.stringify(s.order || {}));
      localStorage.setItem('glovels_shortlist', JSON.stringify(s.shortlist || []));
      window.__GLOVELS = s;
      __dashTodo(s);
      __dashOrders(s);
    }
  } catch (e) {
    /* Server down: fall through to whatever this browser last saw, and say so
       rather than showing a stale screen that claims to be live. */
    const d = document.querySelector('.p-demo');
    if (d) {
      d.style.background = '#fdf6e6';
      d.textContent = 'The Glovels server is not running, so this is the last view '
        + 'cached in this browser. Start it with start.command and reload.';
    }
  }
  main();
}
/*
 * What we still need from them, on the screen they land on.
 *
 * A half-finished profile holds up the university application and then the
 * visa, and the student is not being obstructive — nobody has told them which
 * four boxes are empty. "Your profile is 62% complete" is a number; "we still
 * need your Class 12 marksheet and your date of birth" is something somebody
 * can finish in a minute.
 *
 * It stays until the file is complete, which is the point: this is the polite
 * version of chasing somebody, and it chases every time they open the page.
 */
function __dashTodo(s) {
  const t = s && s.todo;
  if (!t) return;
  const gaps = t.profileMissing || [], docs = t.documentsMissing || [];
  if (!gaps.length && !docs.length) return;
  const main = document.querySelector('.p-main') || document.body;
  const host = main.querySelector('.p-top') || main.firstElementChild;
  if (!host) return;
  const esc2 = x => String(x == null ? '' : x)
    .replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const line = (n, what, list, href, cta) =>
    '<li><b>' + n + ' ' + what + '</b> — ' + esc2(list.slice(0, 5).join(', '))
    + (list.length > 5 ? ', and ' + (list.length - 5) + ' more' : '')
    + ' <a href="' + href + '">' + cta + '</a></li>';

  /* What this student is actually being asked for, and WHY. The old sentence —
     "applications cannot be filed and a visa cannot be applied for" — was
     printed to everybody, including somebody who paid ₹99 for three university
     names and is never going to file an application through us. Being told a
     purchase is 0% complete when it has been delivered in full is the screen
     being wrong about their own order. */
  const on = t.stages || [];
  const why = on.indexOf('visa') >= 0
    ? 'Applications cannot be filed, and a visa cannot be applied for, until it is '
      + 'finished. Nothing here takes long.'
    : on.indexOf('apply') >= 0
    ? 'Applications cannot be filed until this is finished. Nothing here takes long.'
    : on.indexOf('write') >= 0
    ? 'This is what your writer needs to know about you before they start. '
      + 'Nothing here takes long.'
    : on.indexOf('match') >= 0
    ? 'These are the answers your universities are matched against \u2014 change '
      + 'one and the list is picked again.'
    : 'Just enough for us to reach you.';

  const el = document.createElement('div');
  el.className = 'todo-card';
  el.innerHTML =
      '<div class="todo-head"><b>Your file is ' + t.complete + '% complete</b>'
    + '<span>' + why + '</span></div>'
    + '<div class="todo-bar"><i style="width:' + t.complete + '%"></i></div>'
    + '<ul>'
    + (gaps.length ? line(gaps.length, gaps.length === 1 ? 'thing about you'
        : 'things about you', gaps, 'profile.html', 'Fill these in') : '')
    + (docs.length ? line(docs.length, docs.length === 1 ? 'document' : 'documents',
        docs, 'documents.html', 'Upload them') : '')
    + '</ul>';
  host.parentNode.insertBefore(el, host.nextSibling);
}

/*
 * Your orders, and what you accepted with each one.
 *
 * "The student should be shown proof that during payment he has accepted all
 * conditions." A record nobody can reach is not proof of anything, so the way
 * to it is on the screen they land on rather than on a link a counsellor has
 * to remember to send.
 */
function __dashOrders(s) {
  const orders = (s && s.orders) || [];
  if (!orders.length) return;
  const main = document.querySelector('.p-main') || document.body;
  const host = main.querySelector('.todo-card')
    || main.querySelector('.p-top') || main.firstElementChild;
  if (!host) return;
  const esc3 = x => String(x == null ? '' : x)
    .replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const money = p => '₹' + Number((p || 0) / 100).toLocaleString('en-IN');
  const when = iso => {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-IN',
      { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const WORD = { paid: 'Paid', owing: 'To pay', awaiting: 'Card started',
    failed: 'Card failed' };

  /* The instalments, where the student can see them.
     A schedule they agreed to and cannot look at is a debt, not a plan — and
     the first question a counsellor gets is "how much is left". */
  const schedule = o => {
    if (!o.plan || !o.plan.length) return '';
    const left = o.plan.filter(x => x.status !== 'paid')
      .reduce((n, x) => n + Number(x.paise || 0), 0);
    const next = o.plan.find(x => x.status !== 'paid');
    return '<div class="ord-plan"><b>'
      + (left ? money(left) + ' left of ' + money(o.grossPaise) : 'Paid in full')
      + '</b><ul>'
      + o.plan.map(x =>
          '<li class="' + (x.status === 'paid' ? 'done' : '') + '">'
          + '<span>' + esc3(x.label) + (x.dueAt && x.status !== 'paid'
              ? ' · by ' + when(x.dueAt) : '') + '</span>'
          + '<b>' + money(x.paise) + '</b>'
          + '<i>' + (x.status === 'paid' ? 'paid ' + when(x.paidAt) : 'to come') + '</i>'
          + '</li>').join('')
      + '</ul>'
      + (next ? '<button type="button" class="btn btn-primary btn-sm" data-paypart="'
          + esc3(o.reference) + '">Pay ' + money(next.paise) + ' now</button>' : '')
      + '</div>';
  };

  const el = document.createElement('div');
  el.className = 'ord-card';
  el.innerHTML = '<b class="ord-h">Your orders</b><ul>'
    + orders.map(o =>
        '<li><span class="ord-l"><b>' + esc3(o.package || 'Order') + '</b>'
        + '<span>' + esc3(o.reference) + ' · ' + when(o.paidAt) + '</span></span>'
        + '<span class="ord-r"><b>' + money(o.grossPaise) + '</b>'
        + '<span class="ord-st">' + esc3(WORD[o.status] || o.status || '') + '</span></span>'
        + '<a class="ord-a" href="/acceptance/' + encodeURIComponent(o.reference) + '">'
        + 'What I accepted</a>'
        + schedule(o) + '</li>').join('')
    + '</ul>';

  /* Paying the next part opens the same card sheet the checkout uses. The
     amount comes back from the server; nothing here decides what to charge. */
  el.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-paypart]');
    if (!b) return;
    b.disabled = true;
    const was = b.textContent;
    b.textContent = 'One moment…';
    try {
      const r = await fetch('/api/orders/' + encodeURIComponent(b.dataset.paypart)
        + '/pay-part', { method: 'POST', credentials: 'same-origin' });
      const d = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(d.error || 'That did not go through.');
      if (window.__glovelsCollect) {
        await window.__glovelsCollect(d);
        location.reload();
      } else {
        b.textContent = 'Your counsellor will take this part';
        return;
      }
    } catch (e) {
      b.disabled = false;
      b.textContent = was;
      const note = document.createElement('p');
      note.style.cssText = 'margin:8px 0 0;font:600 12.4px/1.5 var(--sans);color:#7a2118';
      note.textContent = e.message;
      b.parentNode.appendChild(note);
    }
  });
  host.parentNode.insertBefore(el, host.nextSibling);
}

function __dashMain() {
"""

DASH_BOOT_SUFFIX = """
}
__dashBoot(__dashMain);
"""


# ------------------------------------------------------------------ catalogue
def catalogue():
    """
    The portal's programme list = the sales site's P[] joined to unlocked.json.

    P[] carries the facts (country, band, public/private, fit, intakes) but
    deliberately withholds the names — that is what a package unlocks.
    unlocked.json carries the names for the ones already unlocked. Joining them
    here means the portal shows a student exactly the programmes the site
    matched them to, with one source of truth for both.
    """
    import html as _html
    import json

    index = (HERE / "index.html").read_text(encoding="utf-8")

    def unent(v):
        """&amp; is an ampersand.

        These names are lifted out of HTML, where an ampersand is written as an
        entity. Stored as-is they go into the database as "AI &amp;amp; Machine
        Learning" and reach the page escaped a second time — which is exactly
        what three programme names did. Fixing the file by hand worked until the
        next build wrote it back."""
        return _html.unescape(v) if isinstance(v, str) else v

    def const(name):
        i = index.index(f"const {name} =")
        s = index[index.index("=", i) + 1:]
        depth, started = 0, False
        for k, ch in enumerate(s):
            if ch in "[{":
                depth += 1
                started = True
            elif ch in "]}":
                depth -= 1
                if started and depth == 0:
                    return json.loads(s[:k + 1])
        raise ValueError(f"could not read const {name}")

    progs = const("P")
    countries = const("C")
    settings = const("D").get("settings", {})
    unlocked = json.loads((HERE / "unlocked.json").read_text(encoding="utf-8"))

    cat = []
    for p in progs:
        u = unlocked.get(p["id"])
        if not u:
            # A private programme carries its own name — it was never gated.
            # A public one with no entry in unlocked.json has no name to show
            # anywhere, so the catalogue screen has nothing to edit.
            if p.get("isPublic") or not p.get("university"):
                continue
            u = {
                "program": p.get("program", ""),
                "university": p.get("university", ""),
                "city": p.get("city", ""),
                "totalInr": p.get("totalInr", 0),
                "url": p.get("url", ""),
            }
        cat.append({
            "id": str(p["id"]),
            "program": unent(u["program"]),
            "university": unent(u["university"]),
            "city": unent(u.get("city", "")),
            "country": p["country"],
            "level": p.get("level", ""),
            "field": p.get("field", ""),
            "band": p.get("band", ""),
            "isPublic": bool(p.get("isPublic")),
            "fit": p.get("fit"),
            # The bar this programme sets for itself. Dropped here, the portal's
            # Browse tab had no way to know a university would turn the student
            # away, and cheerfully offered it to them.
            "minCgpa": p.get("minCgpa"),
            "totalInr": u.get("totalInr", 0),
            "url": u.get("url", ""),
            "intakes": p.get("intakes", []),
        })

    # The entry requirements travel with the destination now. They used to be
    # dropped here — the seed carried a code, a name and a flag — which is why
    # the CGPA minimums, the funds to show and the document list were editable
    # only by a developer editing index.html, while the finder's Requirements
    # panel showed them to every visitor deciding whether to pay.
    FACTS = ["minCgpaPublic", "minCgpaPrivate", "degreeRule", "backlogRule", "extraNote",
             "tests", "fundsLabel", "fundsInr", "fundsNote", "livingInr", "workRights",
             "deadlineNote", "documents", "hasPublicTrack", "tuitionFree", "region"]
    slim = {}
    for c, v in countries.items():
        row = {"code": v["code"], "name": unent(v["name"]), "flag": v["flag"]}
        for f in FACTS:
            if f in v:
                row[f] = unent(v[f])
        slim[c] = row
    return cat, slim, {
        # What to use when a destination has not written its own rule down.
        # The same two numbers the finder falls back to, carried across so the
        # portal cannot end up looser than the page the student came from.
        "full": settings.get("cgpaFull"),
        "partial": settings.get("cgpaPartial"),
    }


def data_js():
    cat, countries, cgpa = catalogue()
    import json
    return (
        "/* Catalogue, joined at build time from the sales site's programme table and\n"
        "   unlocked.json. Inlined rather than fetched so the screen can paint before the\n"
        "   first API round trip finishes. The server holds the same list and is the one\n"
        "   that prices and validates anything the browser asks it to store. */\n"
        f"const CAT = {json.dumps(cat, ensure_ascii=False)};\n"
        f"const COUNTRIES = {json.dumps(countries, ensure_ascii=False)};\n"
        f"const CGPA_RULE = {json.dumps(cgpa)};\n"
        "\n"
        "/* POOL = the catalogue, plus anything on this student's shortlist that is no\n"
        "   longer in it. A programme withdrawn from the catalogue must not vanish from\n"
        "   the shortlist of someone who is already applying to it. Built after the boot\n"
        "   call, because that is when the shortlist arrives. */\n"
        "let POOL = [], byId = {}, LIVE_CAT = null;\n"
        "\n"
        "/* The catalogue as it is RIGHT NOW, not as it was when the site was last\n"
        "   built. Without this the student's Browse tab paints a snapshot: a\n"
        "   university the office added this morning is missing, a fee corrected last\n"
        "   week is wrong, and a CGPA bar typed into the spreadsheet may as well not\n"
        "   exist. The finder on the public site has read the live list for a while;\n"
        "   the screen the student sees AFTER PAYING was the one still guessing.\n"
        "\n"
        "   The endpoint is the same one the public page calls, so it answers for this\n"
        "   student's entitlement: a public university they have not unlocked comes\n"
        "   back without its name. Where that happens the built-in name is kept —\n"
        "   inside the portal they are signed in and the shortlist already names it —\n"
        "   but every other field is taken from the live row, because those are what\n"
        "   the filters read. */\n"
        "async function loadLiveCatalogue() {\n"
        "  try {\n"
        "    const d = await api('GET', '/api/catalogue');\n"
        "    LIVE_CAT = Array.isArray(d.programmes) ? d.programmes : null;\n"
        "    if (d.countries) Object.assign(COUNTRIES, d.countries);\n"
        "  } catch (e) { LIVE_CAT = null; }   /* offline: the snapshot is better than nothing */\n"
        "}\n"
        "\n"
        "function buildPool() {\n"
        "  const built = Object.fromEntries(CAT.map(p => [String(p.id), p]));\n"
        "  if (LIVE_CAT) {\n"
        "    POOL = LIVE_CAT.map(r => {\n"
        "      const was = built[String(r.id)] || {};\n"
        "      const named = Object.assign({}, was, r);\n"
        "      /* A masked row carries no name. Falling through to the built-in one\n"
        "         rather than rendering an empty card. */\n"
        "      if (!r.university) { named.university = was.university || ''; }\n"
        "      if (!r.program) { named.program = was.program || ''; }\n"
        "      return named;\n"
        "    }).filter(p => p.university);\n"
        "  } else {\n"
        "    POOL = CAT.slice();\n"
        "  }\n"
        "  const seen = new Set(POOL.map(p => String(p.id)));\n"
        "  (SHORT_ROWS || []).forEach(r => {\n"
        "    if (!seen.has(String(r.id))) { POOL.push(r); seen.add(String(r.id)); }\n"
        "  });\n"
        "  byId = Object.fromEntries(POOL.map(p => [p.id, p]));\n"
        "}\n"
    )


# ---------------------------------------------------------------------- build
def main():
    import portal_profile, portal_documents, portal_universities
    import portal_applications, portal_scholarships, portal_messages
    import portal_visa, portal_services

    DATA = data_js()

    PAGES = [
        ("profile", "My Profile", "My profile",
         "Asked once, and reused across every application, your SOP brief and the visa checklist.",
         portal_profile),
        ("documents", "Documents", "Documents",
         "Upload once. Your counsellor verifies each file before it goes anywhere.",
         portal_documents),
        ("universities", "My Universities", "My universities",
         "The programmes on your shortlist, and the full catalogue they were picked from.",
         portal_universities),
        ("applications", "Applications", "Applications",
         "Where each application stands, and what is holding it up.",
         portal_applications),
        ("visa", "Visa &amp; enrollment", "Visa &amp; enrollment",
         "The papers the consulate wants, uploaded once and checked by your counsellor.",
         portal_visa),
        ("services", "Services", "Services",
         "Everything we do, with the price on the front of the card.",
         portal_services),
        ("scholarships", "Scholarships", "Scholarships",
         "Checked against your profile, so you only spend time on the ones you can win.",
         portal_scholarships),
        ("messages", "Messages", "Messages",
         "Your counsellor, on the record — so nobody is working from memory.",
         portal_messages),
    ]

    # ---- staff screens: the other end of the conversation ----
    import portal_counsellor, portal_admin
    written = []

    (HERE / "counsellor.html").write_text(staff_page(
        "counsellor", "Conversations", "Conversations",
        "Your students, and the thread with each of them. Messages arrive without a refresh.",
        portal_counsellor.BODY, portal_counsellor.SCRIPT, "Counsellor"), encoding="utf-8")
    written.append("counsellor.html")

    import portal_chat
    (HERE / "chat.html").write_text(staff_page(
        "chat", "Website chat", "Website chat",
        "People asking questions in the chat box on the website. They have not made an account "
        "\u2014 they left a name and a number, and they are waiting.",
        portal_chat.BODY, portal_chat.SCRIPT, "Counsellor"), encoding="utf-8")
    written.append("chat.html")

    import portal_home
    (HERE / "home.html").write_text(staff_page(
        "home", "Home page", "Home page",
        "The packages, the figures, the questions, the stories and every word on the front of "
        "the site. What you change here is what the next visitor reads.",
        portal_home.BODY, portal_home.SCRIPT, "Counsellor"), encoding="utf-8")
    written.append("home.html")

    import portal_leads
    (HERE / "leads.html").write_text(staff_page(
        "leads", "Leads", "Leads",
        "Everybody who has asked us something \u2014 the website, the chat box, a blog "
        "post, Facebook, WhatsApp, Google, or a call somebody took \u2014 in one book, "
        "with what was said and what happens next.",
        portal_leads.BODY, portal_leads.SCRIPT, "Counsellor"), encoding="utf-8")
    written.append("leads.html")

    import portal_blog
    (HERE / "blog-admin.html").write_text(staff_page(
        "blog-admin", "Blog", "Blog",
        "Write a post, fill in what Google and WhatsApp show, and put it on the site. "
        "There is nothing to deploy \u2014 Publish is the deploy.",
        portal_blog.BODY, portal_blog.SCRIPT, "Website editor"), encoding="utf-8")
    written.append("blog-admin.html")

    import portal_catalogue
    (HERE / "catalogue.html").write_text(staff_page(
        "catalogue", "Catalogue", "Catalogue",
        "The universities and destinations the website offers. Anything you change here is "
        "on the home page immediately.",
        portal_catalogue.BODY, portal_catalogue.SCRIPT, "Counsellor"), encoding="utf-8")
    written.append("catalogue.html")

    (HERE / "admin.html").write_text(staff_page(
        "admin", "Organisation", "Organisation",
        "Every student, who is looking after them, and what is waiting on someone.",
        portal_admin.BODY, portal_admin.SCRIPT, "Administrator"), encoding="utf-8")
    written.append("admin.html")

    # The B2B partner's screen. Its own rail with one item on it, and no bell,
    # no live dot and no push bar — every one of those calls a staff endpoint
    # that would refuse a partner, and a control that refuses you is worse than
    # one that is not there.
    import portal_partner
    (HERE / "partner.html").write_text(staff_page(
        "partner", "Your students", "Your students",
        "Every student on your books, and where each one has got to.",
        portal_partner.BODY, portal_partner.SCRIPT, "Partner agency",
        nav=[("partner", "i-list", "Your students")], tools=False,
        # White label, all the way down: no mark, no name in the tab, and
        # nothing left for a screen reader to announce in our voice.
        brand=False), encoding="utf-8")
    written.append("partner.html")

    for slug, title, h1, sub, mod in PAGES:
        # Page code runs only once the student and their data have arrived.
        wrapped = DATA + "\nboot(function () {\nbuildPool();\n" + mod.SCRIPT + "\n});\n"
        html = page(slug, title, h1, sub, mod.BODY, wrapped)
        (HERE / f"{slug}.html").write_text(html, encoding="utf-8")
        written.append(f"{slug}.html")

    # visa.html used to be its own donor: this block read the body out of the
    # page it had written last time and wrapped it again. It worked, and it
    # accumulated — two blank lines a build, and a patch that could apply twice
    # if its marker moved. The body lives in portal_visa.py now and the page is
    # generated like every other one, above.

    # Dashboard keeps its own markup and scripts; two things are replaced.
    import portal_dashboard_css

    dash = (HERE / "dashboard.html").read_text(encoding="utf-8")

    # 1. the sidebar, so the "Soon" stubs are real links now that the pages exist
    new_nav = re.search(r'<nav class="p-nav">.*?</nav>', sidebar("dashboard"), re.S).group(0)
    dash, n = re.subn(r'<nav class="p-nav">.*?</nav>', new_nav, dash, count=1, flags=re.S)
    if not n:
        sys.exit("dashboard sidebar not found — check the markup before rerunning")

    # 2. the stylesheet for the newer blocks, which shipped with no CSS at all
    # Every copy, not the first. This file is read and written in place, so it
    # had been stacking them up too — one behind the others, for the same
    # reason and with the same result.
    dash = strip_injected(dash)
    dash = dash.replace("</style>", portal_dashboard_css.CSS + "</style>", 1)

    # Sign out, at the top. The dashboard is the designer's own file rather
    # than one built by sidebar() above, so it carries its own copy of the
    # sidebar markup and had to be moved separately — otherwise the way out
    # sits at the top on eight screens and at the bottom on the ninth.
    OLD_FOOT = """    <div class="p-side-foot">
      <div class="plan-badge" id="planBadge"></div>
      <a href="login.html" id="signOut"><svg class="ico" aria-hidden="true"><use href="#i-out"/></svg> Switch role / log out</a>
    </div>"""
    NEW_TOP = """    <div class="p-who">
      <b id="whoName">\u2014</b>
      <a href="#" id="signOut" class="p-out"><svg class="ico" aria-hidden="true"><use href="#i-out"/></svg> Sign out</a>
    </div>
    <div class="plan-badge" id="planBadge"></div>"""
    # And its own click handler, which only cleared localStorage and let the
    # href do the navigating. The href is now "#", so without this the button
    # would clear a key and sit there — and it never ended the SERVER session
    # anyway, which is the thing that actually signs somebody out.
    # The one thing they paid for, said first.
    #
    # "User should get the message: after you sign in with the details you can
    #  see your universities." The prompt on this screen always said "fill in
    #  your profile" — even to somebody whose five universities had just landed
    #  and who had come here to look at them.
    OLD_NEXT = """const next = !paid
  ? ['Fill in your profile',"""
    NEW_NEXT = """const __m = (window.__GLOVELS && window.__GLOVELS.matched) || null;
const next = (__m && __m.delivered > 0)
  ? ['Your ' + __m.delivered + ' universit' + (__m.delivered === 1 ? 'y is' : 'ies are')
       + ' ready',
     'Named, with the fee, the intake and the deadline on each one. They are yours '
     + 'to keep \u2014 and your counsellor can add or drop any of them with you.',
     'See my universities', 'universities.html', 'cap']
  : (__m && __m.owed && __m.needsProfile)
  ? ['Answer six questions and your ' + __m.owed + ' universities appear',
     'What you are applying for, where, and what you can spend. Nobody has to ring '
     + 'you \u2014 the list is picked the moment you save.',
     'Answer them now', 'profile.html', 'user']
  : !paid
  ? ['Fill in your profile',"""
    if OLD_NEXT in dash:
        dash = dash.replace(OLD_NEXT, NEW_NEXT)

    OLD_OUT = """$('#signOut').onclick = () => {
  try { localStorage.removeItem('glovels_user'); } catch(e) {}
};"""
    NEW_OUT = """$('#signOut').onclick = async (e) => {
  e.preventDefault();
  try { localStorage.removeItem('glovels_user'); } catch(err) {}
  /* The session lives on the server. Clearing a browser key and navigating
     away left it signed in, so the next person at this machine pressed Back
     and was in. */
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); }
  catch (err) {}
  location.href = 'login.html';
};"""
    if OLD_OUT in dash:
        dash = dash.replace(OLD_OUT, NEW_OUT)

    if OLD_FOOT in dash:
        dash = dash.replace(OLD_FOOT, "")
        dash = dash.replace(
            '''<nav class="p-nav">''', NEW_TOP + '''\n    <nav class="p-nav">''', 1)

    # 3. the dashboard reads three localStorage keys the sales page used to write.
    #    Those are now filled from the student's account on the server before its
    #    own code runs, so the screen shows what is actually stored against them
    #    rather than whatever this browser happens to remember. Wrapping rather
    #    than rewriting keeps the designer's file intact and re-appliable.
    if "__dashMain" not in dash:
        i = dash.index("<script>", dash.index("</style>"))
        j = dash.index("</script>", i)
        inner = dash[i + len("<script>"):j]
        # The dashboard is the designer's own file wrapped rather than generated,
        # so it does not go through page() and has to be handed the shared
        # password screen explicitly. Without it, a student signing in for the
        # first time lands on the one portal page that cannot ask them to
        # choose a password.
        dash = dash[:i] + "<script>\n" + DASH_BOOT_PREFIX + inner \
            + DASH_BOOT_SUFFIX + dash[j:]

    else:
        # Already wrapped by an earlier build. The wrap happens once; the
        # PREFIX changes — it is where the student's record is loaded and where
        # anything that has to run before their own page does goes. A guard
        # that only ever adds leaves whatever version was written the first
        # time, which is how the "what we still need from you" card was written
        # here and never appeared on a single screen.
        # Matched on the boot function, not on the comment: "injected by
        # build_portal.py" also heads the CSS block above, and cutting from
        # there swallowed the stylesheet.
        start = dash.index("/* ---- injected by build_portal.py: load this student")
        end = dash.index("function __dashMain() {") + len("function __dashMain() {")
        dash = dash[:start] + DASH_BOOT_PREFIX.strip() + dash[end:]

    # Separately, and unconditionally: the wrap above only happens once, and on
    # every build after the first this file arrives already wrapped. The shared
    # password screen has to be put in either way, or the dashboard becomes the
    # one portal page that cannot ask a first-time student to choose one.
    # Replaced, not skipped-if-present. This file persists between builds, so a
    # guard that only ever ADDS leaves whatever version happened to be written
    # the first time — including a broken one.
    # Matched on the CODE, not on the prose above it. The first version of this
    # keyed off the comment — "The password we gave you…" — and the comment was
    # then rewritten, so the removal silently stopped matching and every build
    # bolted on another copy: dashboard.html carried three. A marker has to be
    # something that cannot be edited without noticing.
    dash = re.sub(
        r"<script>(?:(?!</script>)[\s\S])*function mustChangeScreen\(\)"
        r"(?:(?!</script>)[\s\S])*</script>\n?", "", dash)
    k = dash.index("<script>", dash.index("</style>"))
    dash = dash[:k] + "<script>\n" + MUST_CHANGE_JS + "</script>\n" + dash[k:]

    dash = dash.replace(
        "Demo dashboard \u2014 sign-in is not live, and everything\n"
        "      below comes from what you did on the website. Nothing is stored on a server yet.",
        "Signed in. Your shortlist, order, documents and messages are stored on the\n"
        "      Glovels server against your account \u2014 not in this browser. Payment is not "
        "connected yet, so orders are recorded but nothing is charged.")

    (HERE / "dashboard.html").write_text(dash, encoding="utf-8")
    written.append("dashboard.html (sidebar, CSS, and wired to the API)")

    # The server prices and validates against the same list the pages render,
    # so it is written out rather than duplicated by hand.
    import json as _json
    cat, _countries, _ = catalogue()
    (HERE / "catalogue.json").write_text(_json.dumps(cat, ensure_ascii=False), encoding="utf-8")
    (HERE / "countries.json").write_text(_json.dumps(_countries, ensure_ascii=False), encoding="utf-8")
    written.append("catalogue.json + countries.json (seed for the database)")

    print(f"portal built · {len(cat)} programmes in the catalogue")
    for w in written:
        print("  ", w)


if __name__ == "__main__":
    main()
