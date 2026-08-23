#!/usr/bin/env python3
"""
Services, on the student's own screen.

"Add other services and show these services so that student can avail these."

The a-la-carte grid — thirty-six services, every price on the front of the
card — lived only on the public home page. A student who had signed in and
paid for a package had no way to see it. If they wanted APS handling or an
IELTS batch, the route was: sign out of the portal, find the marketing site,
scroll to the right tab, and hope the price they remembered was still right.

So this is the same catalogue, on the same data, inside the portal. Two things
it does that the public grid cannot, because it knows who is reading:

  what they have already bought is marked as bought, from their own orders,
  rather than offered to them a second time;

  and next to every price is "Ask my counsellor", which writes to the person
  already handling their file instead of starting a fresh enquiry from a
  stranger. Most of these are a conversation before they are a purchase.

Nothing is priced here. The card shows what the office set in Home page →
Services, fetched at load, because a price frozen into a portal screen is the
same bug this application has now fixed three times.
"""

BODY = r"""
    <div class="p-cols" style="margin-bottom:20px">
      <div class="p-card">
        <h3 style="margin:0 0 7px;font-size:15px">Everything we do, priced</h3>
        <p style="margin:0;font-size:12.8px;color:var(--muted);line-height:1.6">
          Your package covers what it covers. These are the things you can add to it — one
          at a time, at the price on the card. Anything you are unsure about, ask your
          counsellor first; several of these are cheaper as part of something else.</p>
      </div>
      <div class="p-card">
        <h3 style="margin:0 0 7px;font-size:15px">Already on your account</h3>
        <ul class="doclist" id="svcMine" style="margin:0"></ul>
      </div>
    </div>

    <div class="tabs" id="svcTabs" style="margin-bottom:16px"></div>
    <div class="sl-grid" id="svcList"></div>
    <p id="svcEmpty" hidden style="color:var(--muted);font-size:13px">
      Nothing in this group yet.</p>
"""

SCRIPT = r"""
/* The services the office is actually selling today, not a copy frozen into
   this page at build time. Same endpoint the home page reads. */
let SVC = [], SVC_TABS = [], svcCat = '';

/* Every service id on any order this student has placed. An order that predates
   itemised orders has no items and simply contributes nothing — it does not
   guess, and it does not claim they bought something they did not. */
const BOUGHT = new Set();
((DB.orders || (DB.user && DB.user.orders) || []).concat(
  (typeof ORDERS !== 'undefined' && Array.isArray(ORDERS)) ? ORDERS : []))
  .forEach(function (o) {
    (o && o.items || []).forEach(function (it) {
      if (it && it.id) BOUGHT.add(String(it.id));
    });
  });

const svcMoney = s => s.isFree ? 'Free'
  : s.priceLabel ? esc(s.priceLabel)
  : (s.priceInr || s.priceInr === 0)
    ? '₹' + Number(s.priceInr).toLocaleString('en-IN')
    : 'Price on request';

function svcCard(s) {
  const bought = BOUGHT.has(String(s.id));
  const levels = (s.levels || []).length
    ? '<div class="sl-meta" style="margin-top:8px;color:var(--muted)">'
      + s.levels.map(l => esc(l.code) + ' · ₹'
        + Number(l.priceInr || 0).toLocaleString('en-IN')).join(' &nbsp;·&nbsp; ')
      + '</div>'
    : '';
  return '<article class="sl" data-svc="' + esc(s.id) + '" style="gap:0">'
    + '<div style="display:flex;align-items:flex-start;gap:9px;margin-bottom:6px">'
      + '<h3 style="margin:0;flex:1">' + esc(s.name) + '</h3>'
      + (bought ? '<span class="st ok" style="white-space:nowrap">On your account</span>' : '')
    + '</div>'
    + '<div class="city" style="line-height:1.6">' + esc(s.desc || '') + '</div>'
    + (s.meta ? '<div class="sl-meta" style="margin-top:9px;color:var(--muted)">'
        + ico('clock') + ' ' + esc(s.meta) + '</div>' : '')
    + levels
    + '<div class="sl-meta" style="margin-top:10px"><b>' + svcMoney(s) + '</b></div>'
    + '<div class="sl-go" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">'
      + (bought
          ? '<a class="btn btn-ghost btn-sm" href="messages.html">Ask about it</a>'
          : '<a class="btn btn-primary btn-sm" href="index.html#service-' + esc(s.id) + '">'
            + 'Book this ' + ico('arrow') + '</a>'
            + '<button type="button" class="btn btn-ghost btn-sm" data-svcask="' + esc(s.id)
            + '">Ask my counsellor</button>')
    + '</div></article>';
}

function svcPaint() {
  const list = SVC.filter(s => (s.cats || []).includes(svcCat))
    .sort((a, b) => (a.posTop || 99) - (b.posTop || 99));
  $('#svcList').innerHTML = list.map(svcCard).join('');
  $('#svcEmpty').hidden = list.length > 0;

  $('#svcTabs').innerHTML = SVC_TABS.map(t => {
    const n = SVC.filter(s => (s.cats || []).includes(t.key)).length;
    if (!n) return '';                     /* a tab with nothing behind it is a dead end */
    return '<button type="button" class="tab" data-svccat="' + esc(t.key) + '"'
      + ' aria-selected="' + (t.key === svcCat ? 'true' : 'false') + '">'
      + esc(t.label) + ' <span class="n">' + n + '</span></button>';
  }).join('');

  const mine = SVC.filter(s => BOUGHT.has(String(s.id)));
  $('#svcMine').innerHTML = mine.length
    ? mine.map(s => '<li>' + ico('check') + ' <span>' + esc(s.name) + '</span>'
        + '<span class="st ok">booked</span></li>').join('')
    : '<li style="color:var(--muted);font-size:12.6px">Nothing yet beyond your package.</li>';
}

async function svcLoad() {
  try {
    const r = await fetch('/api/content', { credentials: 'same-origin' });
    if (!r.ok) throw new Error('content');
    const d = await r.json();
    const svc = (d && d.services) || {};
    SVC = (svc.items || []).filter(x => x.active !== false);
    SVC_TABS = svc.tabs || [];
    /* Open on the first group that has anything in it, rather than on a
       hard-coded "top" that an office is free to empty. */
    const first = SVC_TABS.find(t => SVC.some(s => (s.cats || []).includes(t.key)));
    svcCat = first ? first.key : '';
    svcPaint();
  } catch (e) {
    $('#svcList').innerHTML = '<div class="sl-empty"><b>Could not load the services</b>'
      + '<p>The server did not answer. Reload the page, or ask your counsellor.</p></div>';
  }
}

document.addEventListener('click', async e => {
  const tab = e.target.closest('[data-svccat]');
  if (tab) { svcCat = tab.dataset.svccat; svcPaint(); return; }

  /* "Ask my counsellor" writes into the thread they already have. A separate
     enquiry form would arrive as a stranger, in a different screen, from
     somebody the counsellor is already talking to. */
  const ask = e.target.closest('[data-svcask]');
  if (ask) {
    const s = SVC.find(x => String(x.id) === ask.dataset.svcask);
    if (!s) return;
    ask.disabled = true;
    const was = ask.textContent;
    ask.textContent = 'Sending…';
    try {
      await api('POST', '/api/messages',
        { body: 'I would like to know more about ' + s.name + '.' });
      ask.textContent = 'Asked — see Messages';
      toast('Sent to your counsellor. Their reply is in Messages.');
    } catch (err) {
      ask.disabled = false;
      ask.textContent = was;
      toast('That did not send: ' + err.message);
    }
  }
});

svcLoad();
"""
