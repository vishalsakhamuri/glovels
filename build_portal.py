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

def shell_parts():
    """head (through </head>), and the icon sprite, taken from the donor page."""
    h = DONOR.read_text(encoding="utf-8")
    head_end = h.index("</head>") + len("</head>")
    head = h[:head_end]
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
    ("scholarships", "i-wallet", "Scholarships"),
    ("visa",         "i-shield", "Visa &amp; Enrollment"),
    ("messages",     "i-chat",   "Messages"),
]


def head_for(title):
    """Donor head with the title swapped. Everything else is shared verbatim."""
    return re.sub(r"<title>.*?</title>",
                  f"<title>{title} | Glovels</title>", HEAD_RAW, count=1, flags=re.S)


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
    <nav class="p-nav">{links}</nav>
    <div class="p-side-foot">
      <a href="login.html"><svg class="ico" aria-hidden="true"><use href="#i-out"/></svg> Switch role / log out</a>
    </div>
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


def staff_sidebar(active, role_note):
    on = ' class="on"'
    links = "".join(
        f'<a href="{slug}.html"{on if slug == active else ""}>'
        f'<svg class="ico" aria-hidden="true"><use href="#{icon}"/></svg> {label}</a>'
        for slug, icon, label in STAFF_NAV
    )
    return f"""<div class="p-shell">
  <aside class="p-side">
    <div class="p-logo"><span class="logo-img" role="img" aria-label="Glovels"></span></div>
    <div class="plan-badge"><b id="staffName">\u2014</b><span id="staffRole">{role_note}</span></div>
    <nav class="p-nav">{links}</nav>
    <div class="p-side-foot">
      <a href="#" id="staffOut"><svg class="ico" aria-hidden="true"><use href="#i-out"/></svg> Sign out</a>
    </div>
  </aside>
"""


def staff_page(slug, title, h1, sub, body, script, role_note):
    # The staff screens use the same top bar, plan badge and SLA chip as the
    # dashboard, and those rules live in the injected sheet rather than the
    # donor stylesheet — so they have to come along, or the header renders as
    # three words run together.
    import portal_dashboard_css
    extra = "<style>" + portal_dashboard_css.CSS + "</style>"
    return f"""{head_for(title).replace("</head>", extra + "</head>")}
<body>
{SPRITE}
{staff_sidebar(slug, role_note)}  <main class="p-main">
    <div class="p-bar">
      <span class="p-bar-title" id="crumb">{h1}</span>
      <span class="sla" id="liveDot">connecting\u2026</span>
      <button type="button" class="bell" id="bell" aria-expanded="false"
        aria-controls="bellPanel" title="What needs doing">
        <svg class="ico" aria-hidden="true"><use href="#i-clock"/></svg>
        <span class="bell-n" id="bellN" hidden>0</span></button>
      <span class="p-av" id="staffAv">\u2014</span>
    </div>
    <div class="bell-panel" id="bellPanel" hidden role="dialog"
      aria-label="What needs doing"></div>
    <div class="p-top">
      <div><h1>{h1}</h1><p>{sub}</p></div>
    </div>
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
function toast(msg) {{
  let t = $('#toast');
  if (!t) {{
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:400;' +
      'background:var(--navy-900);color:#fff;font:600 13px/1.4 var(--sans);padding:12px 18px;' +
      'border-radius:12px;box-shadow:0 16px 40px rgba(11,30,49,.36);max-width:min(460px,90vw)';
    document.body.appendChild(t);
  }}
  t.textContent = msg;
  clearTimeout(t._h);
  t._h = setTimeout(() => t.remove(), 2600);
}}
const timeAgo = iso => {{
  if (!iso) return '';
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}};

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
      '<div class="sl-empty" style="margin-top:40px"><b>This screen is for Glovels staff</b>' +
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
    return f"""{head_for(title)}
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
function toast(msg) {{
  let t = $('#toast');
  if (!t) {{
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:400;' +
      'background:var(--navy-900);color:#fff;font:600 13px/1.4 var(--sans);padding:12px 18px;' +
      'border-radius:12px;box-shadow:0 16px 40px rgba(11,30,49,.36);max-width:min(460px,90vw);' +
      'opacity:0;transition:opacity .18s,transform .18s';
    document.body.appendChild(t);
  }}
  t.textContent = msg;
  requestAnimationFrame(() => {{ t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(-4px)'; }});
  clearTimeout(t._h);
  t._h = setTimeout(() => {{ t.style.opacity = '0'; t.style.transform = 'translateX(-50%)'; }}, 2600);
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
      for (const id of SERVER.short) if (!DB.short.includes(id)) await api('DELETE', '/api/shortlist/' + encodeURIComponent(id));
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
  HANDOVER_KEYS = DB.short.slice();
  SERVER = {{
    profile: JSON.parse(JSON.stringify(DB.profile)),
    short: DB.short.slice(),
    apps: JSON.parse(JSON.stringify(DB.apps)),
    saved: DB.saved.slice(),
  }};
  const avatar = $('#pAvatar');
  if (avatar && USER.name) avatar.textContent = USER.name.trim().slice(0, 1).toUpperCase();
  run();
}}

let USER = {{}}, ORDER = {{}}, HANDOVER_KEYS = [], SHORT_ROWS = [], COUNSELLOR = null;
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

  const el = document.createElement('div');
  el.className = 'todo-card';
  el.innerHTML =
      '<div class="todo-head"><b>Your file is ' + t.complete + '% complete</b>'
    + '<span>Applications cannot be filed, and a visa cannot be applied for, until it is '
    + 'finished. Nothing here takes long.</span></div>'
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

  const el = document.createElement('div');
  el.className = 'ord-card';
  el.innerHTML = '<b class="ord-h">Your orders</b><ul>'
    + orders.map(o =>
        '<li><span class="ord-l"><b>' + esc3(o.package || 'Order') + '</b>'
        + '<span>' + esc3(o.reference) + ' · ' + when(o.paidAt) + '</span></span>'
        + '<span class="ord-r"><b>' + money(o.grossPaise) + '</b>'
        + '<span class="ord-st">' + esc3(WORD[o.status] || o.status || '') + '</span></span>'
        + '<a class="ord-a" href="/acceptance/' + encodeURIComponent(o.reference) + '">'
        + 'What I accepted</a></li>').join('')
    + '</ul>';
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
    return cat, slim


def data_js():
    cat, countries = catalogue()
    import json
    return (
        "/* Catalogue, joined at build time from the sales site's programme table and\n"
        "   unlocked.json. Inlined rather than fetched so the screen can paint before the\n"
        "   first API round trip finishes. The server holds the same list and is the one\n"
        "   that prices and validates anything the browser asks it to store. */\n"
        f"const CAT = {json.dumps(cat, ensure_ascii=False)};\n"
        f"const COUNTRIES = {json.dumps(countries, ensure_ascii=False)};\n"
        "\n"
        "/* POOL = the catalogue, plus anything on this student's shortlist that is no\n"
        "   longer in it. A programme withdrawn from the catalogue must not vanish from\n"
        "   the shortlist of someone who is already applying to it. Built after the boot\n"
        "   call, because that is when the shortlist arrives. */\n"
        "let POOL = [], byId = {};\n"
        "function buildPool() {\n"
        "  POOL = CAT.slice();\n"
        "  const seen = new Set(CAT.map(p => p.id));\n"
        "  (SHORT_ROWS || []).forEach(r => { if (!seen.has(r.id)) { POOL.push(r); seen.add(r.id); } });\n"
        "  byId = Object.fromEntries(POOL.map(p => [p.id, p]));\n"
        "}\n"
    )


# ---------------------------------------------------------------------- build
def main():
    import portal_profile, portal_documents, portal_universities
    import portal_applications, portal_scholarships, portal_messages

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

    for slug, title, h1, sub, mod in PAGES:
        # Page code runs only once the student and their data have arrived.
        wrapped = DATA + "\nboot(function () {\nbuildPool();\n" + mod.SCRIPT + "\n});\n"
        html = page(slug, title, h1, sub, mod.BODY, wrapped)
        (HERE / f"{slug}.html").write_text(html, encoding="utf-8")
        written.append(f"{slug}.html")

    # The donor page keeps its own body but is re-emitted through the same shell,
    # so its sidebar can never drift from the six pages generated above.
    donor = DONOR.read_text(encoding="utf-8")
    main_html = donor[donor.index('<main class="p-main">'):donor.index("</main>")]
    # drop the shell's own top block; page() supplies it
    inner = main_html.split("</div>", 3)[-1]
    # Trimmed, because this page is its own donor: page() puts a newline either
    # side of what it is given, and next build that newline is part of `inner`
    # again. Two blank lines a build, for as long as anybody keeps building.
    inner = re.sub(r"\A(?:[ \t]*\n)+", "", inner)
    inner = re.sub(r"\s+\Z", "\n", inner)
    visa = page("visa", "Visa &amp; enrollment", "Visa &amp; enrollment",
                "What happens between your offer letter and your first week abroad.",
                inner)
    (HERE / "visa.html").write_text(visa, encoding="utf-8")
    written.append("visa.html (re-shelled)")

    # Dashboard keeps its own markup and scripts; two things are replaced.
    import portal_dashboard_css

    dash = (HERE / "dashboard.html").read_text(encoding="utf-8")

    # 1. the sidebar, so the "Soon" stubs are real links now that the pages exist
    new_nav = re.search(r'<nav class="p-nav">.*?</nav>', sidebar("dashboard"), re.S).group(0)
    dash, n = re.subn(r'<nav class="p-nav">.*?</nav>', new_nav, dash, count=1, flags=re.S)
    if not n:
        sys.exit("dashboard sidebar not found — check the markup before rerunning")

    # 2. the stylesheet for the newer blocks, which shipped with no CSS at all
    marker = "/* ---- injected by build_portal.py"
    if marker in dash:
        dash = re.sub(re.escape(marker) + r".*?</style>", "</style>", dash, count=1, flags=re.S)
    dash = dash.replace("</style>", portal_dashboard_css.CSS + "</style>", 1)

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
    cat, _ = catalogue()
    (HERE / "catalogue.json").write_text(_json.dumps(cat, ensure_ascii=False), encoding="utf-8")
    _, _countries = catalogue()
    (HERE / "countries.json").write_text(_json.dumps(_countries, ensure_ascii=False), encoding="utf-8")
    written.append("catalogue.json + countries.json (seed for the database)")

    print(f"portal built · {len(cat)} programmes in the catalogue")
    for w in written:
        print("  ", w)


if __name__ == "__main__":
    main()
