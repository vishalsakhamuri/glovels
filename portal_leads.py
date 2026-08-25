"""Every enquiry in one place, and what happened to it."""

BODY = """
    <style>
      .out.tiles{grid-template-columns:repeat(var(--tiles,4),1fr)}
      @media (max-width:820px){ .out.tiles{grid-template-columns:repeat(2,1fr)} }
      @media (max-width:430px){ .out.tiles{grid-template-columns:1fr} }

      .lead-cols{display:grid;grid-template-columns:1fr 400px;gap:16px;align-items:start}
      @media (max-width:1180px){ .lead-cols{grid-template-columns:1fr} }

      .filters{display:flex;gap:9px;flex-wrap:wrap;align-items:center;margin:0 0 14px}
      .filters select,.filters input{padding:8px 11px;border:1.5px solid #d8dde4;
        border-radius:9px;font:600 12.6px/1.4 var(--sans);background:#fff;
        color:var(--navy-900)}
      .filters .grow{flex:1;min-width:170px;font-weight:400}

      .src{display:inline-block;padding:2px 9px;border-radius:999px;
        font:700 10.4px/1.75 var(--sans);letter-spacing:.05em;text-transform:uppercase;
        background:#eef2f7;color:var(--navy-700)}
      .src.facebook{background:#e8eefc;color:#1d3f94}
      .src.instagram{background:#fdecf3;color:#a1246c}
      .src.whatsapp{background:#e6f6ec;color:#14603a}
      .src.google{background:#fdf2e3;color:#8a5a0b}
      .src.chat{background:#eaf1fb;color:#13385c}
      .src.blog{background:#f1ecfb;color:#4b2e83}
      .src.phone,.src.walkin{background:#f0f0f2;color:#3d3d46}

      .st{display:inline-block;padding:2px 9px;border-radius:999px;
        font:700 10.4px/1.75 var(--sans);letter-spacing:.05em;text-transform:uppercase}
      .st.new{background:#fdf6e6;color:#8a5a0b}
      .st.contacted{background:#eaf1fb;color:#13385c}
      .st.following{background:#e8eefc;color:#1d3f94}
      .st.converted{background:#e6f4ec;color:#14603a}
      .st.lost{background:#f6eceb;color:#7a2118}

      .lrow{cursor:pointer}
      .lrow.on td{background:#f0f5fb}
      .cold td:first-child{box-shadow:inset 3px 0 0 #c0392b}

      .thread{max-height:34vh;overflow-y:auto;display:flex;flex-direction:column;gap:9px;
        padding:2px 2px 6px}
      .tnote{background:#f7f9fc;border:1px solid var(--line);border-radius:11px;
        padding:9px 12px;font-size:12.9px;line-height:1.6;color:var(--navy-800)}
      .tnote b{display:block;font:700 11.4px/1.5 var(--sans);color:var(--muted);
        letter-spacing:.04em;text-transform:uppercase;margin-bottom:3px}
      .tnote.change{background:#fff;border-style:dashed}
      .tnote.converted{background:#e6f4ec;border-color:#bfe0cc}

      .det .field{margin-bottom:11px}
      .det label{display:block;font:700 12.2px/1.4 var(--sans);color:var(--navy-800);
        margin-bottom:4px}
      .det input,.det select,.det textarea{width:100%;padding:9px 11px;
        border:1.5px solid #d8dde4;border-radius:9px;font:400 13.2px/1.55 var(--sans);
        background:#fff;color:var(--navy-900)}
      .det .two{display:grid;grid-template-columns:1fr 1fr;gap:11px}
      .srcbars{display:grid;gap:7px}
      .srcbar{display:grid;grid-template-columns:110px 1fr 92px;gap:10px;align-items:center;
        font:600 12.2px/1.4 var(--sans)}
      .srcbar i{display:block;height:9px;border-radius:5px;background:#e6ebf2;
        position:relative;overflow:hidden}
      .srcbar i span{position:absolute;inset:0 auto 0 0;background:var(--navy-700);
        border-radius:5px}
      .srcbar i span.won{background:#1f8b4d}
      .srcbar em{font-style:normal;color:var(--muted);font-size:11.8px}
    </style>

    <style>
      /* Five numbers that were five dead rectangles. Somebody reading "5 nobody
         has called" wants the five, and the only route to them was to work out
         which combination of the filters below meant the same thing — so the
         number was a fact about the business that the screen would not act on.
         Each one narrows the book now, and says so. */
      .out .outgo{appearance:none;font:inherit;text-align:center;cursor:pointer;
        transition:border-color .12s, background .12s, transform .12s}
      .out .outgo:hover{border-color:var(--navy-600);background:var(--paper);
        transform:translateY(-1px)}
      .out .outgo:focus-visible{outline:2px solid var(--blue,#1a4fb4);outline-offset:2px}
      .out .outgo span{text-decoration:underline;text-decoration-color:transparent;
        text-underline-offset:3px;transition:text-decoration-color .12s}
      .out .outgo:hover span{text-decoration-color:currentColor}
      .out .outgo.on{border-color:var(--navy-700);background:var(--paper);
        box-shadow:inset 0 0 0 1px var(--navy-700)}
      .out .outgo.on span{text-decoration-color:currentColor}
    </style>

    <div class="out tiles" style="--tiles:5;margin:0 0 18px">
      <button type="button" class="outgo" data-tile="all">
        <b id="kAll">—</b><span>Leads</span></button>
      <button type="button" class="outgo" data-tile="open">
        <b id="kOpen">—</b><span>Still open</span></button>
      <button type="button" class="outgo" data-tile="follow">
        <b id="kFollow">—</b><span>Followed up</span></button>
      <button type="button" class="outgo" data-tile="won">
        <b id="kWon">—</b><span>Converted</span></button>
      <button type="button" class="outgo" data-tile="cold">
        <b id="kCold">—</b><span>Nobody has called</span></button>
    </div>

    <div class="tabs" style="margin-bottom:16px">
      <button class="tab" data-t="book" aria-selected="true">The book
        <span class="n" id="nBook">0</span></button>
      <button class="tab" data-t="where" aria-selected="false">Where they come from</button>
    </div>

    <section class="pane active" id="t-book">
      <div class="filters">
        <select id="fStatus"><option value="">Any status</option></select>
        <select id="fSource"><option value="">Any source</option></select>
        <select id="fOwner"><option value="">Anybody</option>
          <option value="none">Nobody yet</option></select>
        <input class="grow" id="fQ" placeholder="Name, number or email">
        <span style="flex:1"></span>
        <button type="button" class="btn btn-primary btn-sm" id="addLead">+ Log a lead</button>
      </div>

      <!-- Which of the five counters is holding the book down, and the way
           back out. A filter you cannot see is a filter that makes the screen
           look broken ten minutes later. -->
      <button type="button" id="tileChip" hidden class="st wait"
        style="border:0;cursor:pointer;text-transform:none;letter-spacing:0;
        margin:0 0 12px;font:600 12.4px/1.4 var(--sans)"></button>

      <div class="lead-cols">
        <div class="p-card" style="padding:0;overflow-x:auto">
          <table class="tbl" style="margin:0">
            <thead><tr><th>Who</th><th>Source</th><th>Status</th><th>Owner</th>
              <th>Follow-ups</th><th>Came in</th></tr></thead>
            <tbody id="leadRows"></tbody>
          </table>
          <div id="leadPager"></div>
        </div>

        <div class="p-card det" id="leadPane">
          <p style="margin:0;font-size:13px;color:var(--muted);line-height:1.7">
            Pick a lead to see what has been said to them, write down what happened on
            the last call, and set what happens next.<br><br>
            Everything that came through the website, the chat box, a blog post or the
            Apply button is already here. Anything that arrived on somebody's phone
            needs <b>Log a lead</b> — a lead that is not in the book does not get
            followed up.</p>
        </div>
      </div>
    </section>

    <section class="pane" id="t-where">
      <div class="p-card">
        <b style="display:block;font:700 13.6px/1.4 var(--sans);color:var(--navy-900);
          margin-bottom:4px">What each source actually brings</b>
        <p style="margin:0 0 16px;font-size:12.4px;color:var(--muted);line-height:1.6">
          The bar is how many leads. The green part is how many became students. A source
          with a long bar and no green is a source that is spending money.</p>
        <div class="srcbars" id="srcBars"></div>
      </div>

      <div class="p-card" style="margin-top:14px">
        <b style="display:block;font:700 13.6px/1.4 var(--sans);color:var(--navy-900);
          margin-bottom:4px">Why they did not convert</b>
        <p style="margin:0 0 16px;font-size:12.4px;color:var(--muted);line-height:1.6">
          Counted from the reason chosen when a lead was closed. This is the list worth
          reading before deciding what to change.</p>
        <div class="srcbars" id="lostBars"></div>
      </div>
    </section>
"""

SCRIPT = r"""
let LEADS = [], SUM = {}, PEOPLE = [], STATUSES = [], REASONS = [], openId = null;

const SOURCE_LABEL = {
  website: 'Website', blog: 'Blog', chat: 'Chat box', facebook: 'Facebook',
  instagram: 'Instagram', whatsapp: 'WhatsApp', google: 'Google', bing: 'Bing',
  youtube: 'YouTube', linkedin: 'LinkedIn', x: 'X', quora: 'Quora', reddit: 'Reddit',
  phone: 'Phone', 'walk-in': 'Walk-in', referral: 'Referral', other: 'Other',
};
const STATUS_LABEL = {
  new: 'New', contacted: 'Contacted', following: 'Following up',
  converted: 'Converted', lost: 'Not converting',
};
const REASON_LABEL = {
  budget: 'Cost', 'went-elsewhere': 'Went to somebody else', deferred: 'Postponed',
  'not-eligible': 'Not eligible', 'no-response': 'Stopped replying',
  'changed-plan': 'Changed their plan', other: 'Something else',
};
const KIND_LABEL = {
  call: 'Called', whatsapp: 'WhatsApp', email: 'Emailed', meeting: 'Met',
  note: 'Note', change: 'Changed', added: 'Added', converted: 'Converted',
};

const fmtWhen = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
               : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const daysAgo = iso => {
  const d = new Date(iso);
  return isNaN(d) ? 0 : Math.floor((Date.now() - d.getTime()) / 86400000);
};
const srcClass = s => 'src ' + String(s || '').replace(/[^a-z]/g, '');

function fill(sel, items, keep) {
  const el = $(sel);
  const was = keep === undefined ? el.value : keep;
  const first = el.querySelectorAll('option');
  const head = [...first].filter(o => !o.dataset.dyn).map(o => o.outerHTML).join('');
  el.innerHTML = head + items.map(i =>
    '<option data-dyn="1" value="' + esc(i.v) + '">' + esc(i.t) + '</option>').join('');
  el.value = was;
}

/* Which counter tile is held down, '' for none. */
let tile = '';

/* The five counters, as tests a lead either passes or does not. Written once
   so the number printed on a tile and the rows revealed by pressing it cannot
   drift apart — a tile saying 5 that opens 4 rows is worse than no tile. */
const TILES = {
  all:    { test: () => true, say: '' },
  open:   { test: l => l.status !== 'converted' && l.status !== 'lost',
            say: 'Still open' },
  follow: { test: l => !!l.followUps, say: 'Followed up' },
  won:    { test: l => l.status === 'converted', say: 'Converted' },
  cold:   { test: l => !l.followUps && l.status !== 'converted' && l.status !== 'lost'
                       && daysAgo(l.at) >= 1,
            say: 'Nobody has called' },
};

function shown() {
  const st = $('#fStatus').value, sr = $('#fSource').value, ow = $('#fOwner').value;
  const q = $('#fQ').value.trim().toLowerCase();
  const t = TILES[tile];
  return LEADS.filter(l => {
    if (t && !t.test(l)) return false;
    if (st && l.status !== st) return false;
    if (sr && l.source !== sr) return false;
    if (ow === 'none' && l.ownerId) return false;
    if (ow && ow !== 'none' && String(l.ownerId) !== ow) return false;
    if (q && !((l.name || '') + ' ' + (l.phone || '') + ' ' + (l.email || ''))
      .toLowerCase().includes(q)) return false;
    return true;
  });
}

function ownerCell(l) {
  const has = l.ownerId != null && l.ownerId !== '';
  const opts = ['<option value="">— nobody yet —</option>'].concat(
    PEOPLE.map(p => '<option value="' + p.id + '"' +
      (String(p.id) === String(l.ownerId) ? ' selected' : '') +
      '>' + esc(p.name) + '</option>')
  ).join('');
  return '<select class="assign' + (has ? '' : ' none') + '" data-own="' + l.id + '">' +
    opts + '</select>';
}

async function setOwner(id, value) {
  try {
    await api('PUT', '/api/staff/lead/' + id, { ownerId: value || null });
    const l = LEADS.find(x => x.id === id);
    const p = PEOPLE.find(x => String(x.id) === String(value));
    const was = l ? l.owner : '';
    if (l) { l.ownerId = p ? p.id : null; l.owner = p ? p.name : ''; }
    toast(p ? 'Given to ' + p.name : 'Taken off ' + (was || 'everybody'));
    paint();
  } catch (e) { toast(e.message); await load(); }
}

function paint() {
  /* Counted off the book itself rather than off the summary the server sends,
     because pressing a tile has to open exactly the rows it counted. The two
     used to differ in one place that mattered: "Follow-ups logged" was every
     note ever written, so two notes against one lead read as two leads. */
  Object.keys(TILES).forEach(k => {
    const el = $('#k' + k[0].toUpperCase() + k.slice(1));
    if (el) el.textContent = LEADS.filter(TILES[k].test).length;
  });

  $$('.outgo').forEach(b => b.classList.toggle('on', b.dataset.tile === tile));
  const chip = $('#tileChip');
  chip.hidden = !tile || tile === 'all';
  if (!chip.hidden) chip.textContent = TILES[tile].say + ' only ×';

  const rows = shown();
  $('#nBook').textContent = rows.length;
  $('#leadPager').innerHTML = pagerHtml('lead', rows.length, 'enquiries', paint);
  $('#leadRows').innerHTML = paged('lead', rows).map(l => {
    /* Nobody has said a word to them and they came in yesterday or before.
       This is the row that should catch somebody's eye. */
    const cold = !l.followUps && l.status !== 'converted' && l.status !== 'lost'
      && daysAgo(l.at) >= 1;
    return '<tr class="lrow' + (l.id === openId ? ' on' : '') + (cold ? ' cold' : '')
      + '" data-lead="' + l.id + '">'
      + '<td><b>' + esc(l.name || 'no name') + '</b>'
        + (l.note ? '<br><span style="font-size:11.6px;color:var(--muted)">'
          + esc(l.note.slice(0, 70)) + '</span>' : '')
        + '<br><span style="font-size:11.6px;color:var(--muted)">'
        + esc(l.phone || l.email || 'nothing given') + '</span></td>'
      + '<td><span class="' + srcClass(l.source) + '">'
        + esc(SOURCE_LABEL[l.source] || l.source) + '</span>'
        + (l.campaign ? '<br><span style="font-size:11.2px;color:var(--muted)">'
          + esc(l.campaign) + '</span>' : '') + '</td>'
      + '<td><span class="st ' + esc(l.status) + '">'
        + esc(STATUS_LABEL[l.status] || l.status) + '</span>'
        + (l.status === 'lost' && l.lostReason
          ? '<br><span style="font-size:11.2px;color:var(--muted)">'
            + esc(REASON_LABEL[l.lostReason] || l.lostReason) + '</span>' : '') + '</td>'
      /* Whose it is, and a way to make it somebody's. This control did exist —
         inside the panel that opens when a lead is clicked, four fields down,
         next to a Save button. Handing out a morning's enquiries meant opening
         each one, setting a name and saving, and the column that should have
         made that a ten-second job printed the answer in red and offered
         nothing. It writes on change now, from the row. */
      + '<td>' + ownerCell(l) + '</td>'
      + '<td style="font-size:12.4px">' + (l.followUps
        ? l.followUps + '<br><span style="font-size:11.2px;color:var(--muted)">last '
          + fmtWhen(l.lastTouch) + '</span>'
        : '<span style="color:#b03a2e;font-weight:700">none</span>') + '</td>'
      + '<td style="font-size:12.4px;white-space:nowrap">' + fmtWhen(l.at) + '</td></tr>';
  }).join('')
    || '<tr><td colspan="6" style="padding:22px;color:var(--muted)">'
       + (LEADS.length ? 'Nothing matches those filters.' : 'Nothing yet.') + '</td></tr>';

  bars();
}

function bars() {
  const by = (SUM && SUM.bySource) || {};
  const keys = Object.keys(by).sort((a, b) => by[b].leads - by[a].leads);
  const max = Math.max(1, ...keys.map(k => by[k].leads));
  $('#srcBars').innerHTML = keys.map(k => {
    const r = by[k];
    const pct = Math.round((r.leads / max) * 100);
    const won = r.leads ? Math.round((r.converted / r.leads) * 100) : 0;
    return '<div class="srcbar"><span>' + esc(SOURCE_LABEL[k] || k) + '</span>'
      + '<i><span style="width:' + pct + '%"></span>'
        + '<span class="won" style="width:' + Math.round(pct * (won / 100)) + '%"></span></i>'
      + '<em>' + r.leads + ' &middot; ' + r.converted + ' won</em></div>';
  }).join('') || '<p style="margin:0;color:var(--muted);font-size:12.6px">Nothing yet.</p>';

  const lost = (SUM && SUM.byReason) || {};
  const lk = Object.keys(lost).sort((a, b) => lost[b] - lost[a]);
  const lmax = Math.max(1, ...lk.map(k => lost[k]));
  $('#lostBars').innerHTML = lk.map(k =>
    '<div class="srcbar"><span>' + esc(REASON_LABEL[k] || k) + '</span>'
    + '<i><span style="width:' + Math.round((lost[k] / lmax) * 100) + '%;'
      + 'background:#b03a2e"></span></i><em>' + lost[k] + '</em></div>').join('')
    || '<p style="margin:0;color:var(--muted);font-size:12.6px">'
       + 'Nothing closed yet — which is either very good news or nobody is closing them.</p>';
}

/* ------------------------------------------------------------- one lead */

function paintLead(lead, notes) {
  openId = lead.id;
  const opt = (v, t, on) => '<option value="' + esc(v) + '"' + (on ? ' selected' : '')
    + '>' + esc(t) + '</option>';

  $('#leadPane').innerHTML =
      '<div style="display:flex;gap:9px;align-items:flex-start;flex-wrap:wrap;'
        + 'padding-bottom:12px;border-bottom:1px solid var(--line);margin-bottom:14px">'
      + '<div><b style="font:700 15px/1.3 var(--disp,inherit);color:var(--navy-900)">'
        + esc(lead.name || 'no name') + '</b>'
      + '<span style="display:block;font-size:12.3px;color:var(--muted);margin-top:3px">'
        + esc(lead.phone || '') + (lead.phone && lead.email ? ' · ' : '')
        + esc(lead.email || '') + '</span></div>'
      + '<span style="flex:1"></span>'
      + (lead.phone ? '<a class="btn btn-ghost btn-sm" href="tel:' + esc(lead.phone)
        + '">Call</a>' : '')
      + (lead.phone ? '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" '
        + 'href="https://wa.me/' + esc(String(lead.phone).replace(/\D/g, ''))
        + '">WhatsApp</a>' : '')
      + '</div>'

    + '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px">'
      + '<span class="' + srcClass(lead.source) + '">'
        + esc(SOURCE_LABEL[lead.source] || lead.source) + '</span>'
      + (lead.campaign ? '<span class="src">' + esc(lead.campaign) + '</span>' : '')
      + (lead.page ? '<span class="src">' + esc(lead.page) + '</span>' : '')
      + '</div>'
    + (lead.note ? '<p style="margin:0 0 14px;font-size:13px;line-height:1.65;'
      + 'color:var(--navy-800)">' + esc(lead.note) + '</p>' : '')

    /* ---- what has been said ---- */
    + '<b style="display:block;font:700 12.4px/1 var(--sans);letter-spacing:.07em;'
      + 'text-transform:uppercase;color:var(--muted);margin-bottom:9px">'
      + (notes.length ? notes.filter(n => n.kind !== 'change').length + ' follow-up'
          + (notes.filter(n => n.kind !== 'change').length === 1 ? '' : 's')
        : 'Nobody has spoken to them') + '</b>'
    + '<div class="thread" id="thread">'
      + (notes.map(n =>
          '<div class="tnote ' + esc(n.kind) + '"><b>' + esc(KIND_LABEL[n.kind] || n.kind)
          + ' · ' + esc(n.who) + ' · ' + fmtWhen(n.at) + '</b>' + esc(n.body) + '</div>')
        .join('') || '<p style="margin:0;color:var(--muted);font-size:12.6px">'
          + 'Write down the first call here and it stops being a name on a list.</p>')
    + '</div>'

    + '<div style="display:grid;grid-template-columns:120px 1fr;gap:9px;margin:13px 0 6px">'
      + '<select id="nKind">'
        + opt('call', 'Called') + opt('whatsapp', 'WhatsApp') + opt('email', 'Emailed')
        + opt('meeting', 'Met') + opt('note', 'Note')
      + '</select>'
      + '<input id="nBody" placeholder="What happened? What did they say?">'
    + '</div>'
    + '<button type="button" class="btn btn-primary btn-sm" id="nGo" '
      + 'style="width:100%">Record it</button>'

    /* ---- where it stands ---- */
    + '<div style="margin-top:20px;padding-top:15px;border-top:1px solid var(--line)">'
    + '<div class="two">'
      + '<div class="field"><label for="dStatus">Where it stands</label>'
        + '<select id="dStatus">'
        + STATUSES.map(v => opt(v, STATUS_LABEL[v] || v, v === lead.status)).join('')
        + '</select></div>'
      + '<div class="field"><label for="dOwner">Whose it is</label>'
        + '<select id="dOwner"><option value="">Nobody</option>'
        + PEOPLE.map(p => opt(p.id, p.name, String(p.id) === String(lead.ownerId))).join('')
        + '</select></div>'
    + '</div>'
    + '<div class="field" id="whyWrap" ' + (lead.status === 'lost' ? '' : 'hidden') + '>'
      + '<label for="dWhy">Why it did not convert</label>'
      + '<select id="dWhy"><option value="">Pick one</option>'
      + REASONS.map(v => opt(v, REASON_LABEL[v] || v, v === lead.lostReason)).join('')
      + '</select></div>'
    + '<div class="two">'
      + '<div class="field"><label for="dNext">Next follow-up</label>'
        + '<input id="dNext" type="date" value="' + esc((lead.nextAt || '').slice(0, 10))
        + '"></div>'
      + '<div class="field"><label for="dSource">Where they came from</label>'
        + '<select id="dSource">'
        + Object.keys(SOURCE_LABEL).map(v =>
            opt(v, SOURCE_LABEL[v], v === lead.source)).join('')
        + '</select></div>'
    + '</div>'
    + '<p id="dErr" role="alert" style="display:none;margin:0 0 10px;padding:10px 12px;'
      + 'border-radius:9px;font:600 12.6px/1.5 var(--sans);background:#fdf3f2;'
      + 'border:1px solid #f0c8c4;color:#7a2118"></p>'
    + '<div style="display:flex;gap:9px;flex-wrap:wrap;align-items:center">'
      + '<button type="button" class="btn btn-ghost btn-sm" id="dSave">Save</button>'
      /* A duplicate, a test row, somebody who typed nonsense into the form.
         Once a lead has become an account it is not deleted from here — the
         account is the thing that exists now, and removing the enquiry behind
         it loses where they came from, which is the one number the marketing
         spend is judged on. */
      + (lead.status === 'converted' ? ''
          : '<button type="button" class="btn btn-ghost btn-sm" id="dDel" '
            + 'style="color:#b03a2e">Delete</button>')
      + (lead.status === 'converted'
          ? '<span style="font:600 12.4px/2.2 var(--sans);color:#14603a">'
            + 'They have an account'
            + (lead.studentId ? ' &middot; <a href="counsellor.html">open their file</a>' : '')
            + '</span>'
          : '<button type="button" class="btn btn-primary btn-sm" id="dWin">'
            + 'They said yes — make their login</button>')
    + '</div></div>';

  $('#dStatus').onchange = () => {
    $('#whyWrap').hidden = $('#dStatus').value !== 'lost';
  };
  $('#nGo').onclick = () => note(lead);
  $('#nBody').addEventListener('keydown', e => { if (e.key === 'Enter') note(lead); });
  $('#dSave').onclick = () => saveLead(lead);
  if ($('#dWin')) $('#dWin').onclick = () => convert(lead);
  if ($('#dDel')) $('#dDel').onclick = () => removeLead(lead);
  const th = $('#thread');
  th.scrollTop = th.scrollHeight;
}

const say = m => {
  const el = $('#dErr');
  if (!el) return;
  el.textContent = m;
  el.style.display = m ? 'block' : 'none';
};

async function note(lead) {
  const body = $('#nBody').value.trim();
  if (!body) return;
  $('#nBody').value = '';
  const r = await api('POST', '/api/staff/lead/' + lead.id + '/note',
    { kind: $('#nKind').value, body });
  await load();
  paintLead(r.lead, r.notes);
}

async function saveLead(lead) {
  say('');
  try {
    const r = await api('PUT', '/api/staff/lead/' + lead.id, {
      status: $('#dStatus').value,
      lostReason: $('#dWhy') ? $('#dWhy').value : '',
      ownerId: $('#dOwner').value || null,
      nextAt: $('#dNext').value,
      source: $('#dSource').value,
    });
    await load();
    paintLead(r.lead, r.notes);
    toast('Saved');
  } catch (e) { say(e.message); }
}

async function removeLead(lead) {
  say('');
  if (!confirm('Delete ' + (lead.name || 'this enquiry') + '?\n\n'
    + 'The follow-ups written against it go too, and this cannot be undone.')) return;
  try {
    await api('DELETE', '/api/staff/lead/' + lead.id);
    openId = null;
    await load();
    $('#leadPane').innerHTML = '<p style="margin:0;color:var(--muted);font-size:12.8px">'
      + 'Deleted. Pick another from the book.</p>';
    toast('Deleted');
  } catch (e) { say(e.message); }
}

async function convert(lead) {
  say('');
  try {
    const r = await api('POST', '/api/staff/lead/' + lead.id + '/convert', {});
    await load();
    paintLead(r.lead, r.notes);
    /* The password is shown once and nowhere else. A counsellor on the phone
       with the student can read it out; email is the normal route and the
       normal failure. */
    const where = $('#leadPane');
    const box = document.createElement('div');
    box.style.cssText = 'margin-top:14px;padding:13px 15px;border-radius:11px;'
      + 'background:#e6f4ec;border:1px solid #bfe0cc;color:#14603a;'
      + 'font:600 12.9px/1.65 var(--sans)';
    box.innerHTML = r.accountCreated
      ? 'Account made for <b>' + esc(r.student.email) + '</b> and the sign-in details '
        + 'emailed.<br>First password: <b style="font:700 14px/1.6 ui-monospace,monospace">'
        + esc(r.password) + '</b><br>They have to change it the first time they sign in. '
        + 'This is the only time it is shown.'
      : 'They already had an account on <b>' + esc(r.student.email) + '</b>, so the lead '
        + 'is tied to it rather than making a second one.';
    where.appendChild(box);
  } catch (e) { say(e.message); }
}

/* ------------------------------------------------------- logging one by hand */

function addForm() {
  openId = null;
  paint();
  const opt = (v, t) => '<option value="' + esc(v) + '">' + esc(t) + '</option>';
  $('#leadPane').innerHTML =
      '<b style="display:block;font:700 15px/1.3 var(--disp,inherit);color:var(--navy-900);'
      + 'margin-bottom:4px">Log a lead</b>'
    + '<p style="margin:0 0 15px;font-size:12.6px;color:var(--muted);line-height:1.6">'
      + 'Somebody who messaged your phone, called the office, or walked in. It goes in the '
      + 'same book as everything else, so it gets followed up like everything else.</p>'
    + '<div class="field"><label for="aName">Name</label><input id="aName"></div>'
    + '<div class="two">'
      + '<div class="field"><label for="aPhone">Mobile</label>'
        + '<input id="aPhone" inputmode="numeric" placeholder="10 digits"></div>'
      + '<div class="field"><label for="aMail">Email</label><input id="aMail" type="email">'
      + '</div>'
    + '</div>'
    + '<div class="two">'
      + '<div class="field"><label for="aSource">Where from</label><select id="aSource">'
        + ['whatsapp', 'phone', 'facebook', 'instagram', 'google', 'walk-in', 'referral',
           'other'].map(v => opt(v, SOURCE_LABEL[v] || v)).join('') + '</select></div>'
      + '<div class="field"><label for="aDest">Destination</label>'
        + '<input id="aDest" placeholder="Germany, Canada…"></div>'
    + '</div>'
    + '<div class="field"><label for="aNote">What they want</label>'
      + '<textarea id="aNote" rows="2"></textarea></div>'
    + '<p id="dErr" role="alert" style="display:none;margin:0 0 10px;padding:10px 12px;'
      + 'border-radius:9px;font:600 12.6px/1.5 var(--sans);background:#fdf3f2;'
      + 'border:1px solid #f0c8c4;color:#7a2118"></p>'
    + '<button type="button" class="btn btn-primary" id="aGo" style="width:100%">'
      + 'Add to the book</button>';

  $('#aGo').onclick = async () => {
    say('');
    try {
      const r = await api('POST', '/api/staff/leads', {
        name: $('#aName').value.trim(),
        phone: $('#aPhone').value.trim(),
        email: $('#aMail').value.trim(),
        source: $('#aSource').value,
        destination: $('#aDest').value.trim(),
        note: $('#aNote').value.trim(),
      });
      await load();
      if (r.lead) open_(r.lead.id);
    } catch (e) { say(e.message); }
  };
  $('#aName').focus();
}

async function open_(id) {
  const r = await api('GET', '/api/staff/lead/' + id);
  paintLead(r.lead, r.notes);
  paint();
}

async function load() {
  const r = await api('GET', '/api/staff/leads');
  LEADS = r.leads;
  SUM = r.summary;
  PEOPLE = r.counsellors;
  STATUSES = r.statuses;
  REASONS = r.reasons;

  fill('#fStatus', STATUSES.map(v => ({ v, t: STATUS_LABEL[v] || v })));
  fill('#fSource', [...new Set(LEADS.map(l => l.source))]
    .map(v => ({ v, t: SOURCE_LABEL[v] || v })));
  fill('#fOwner', PEOPLE.map(p => ({ v: String(p.id), t: p.name })));
  paint();
}

document.addEventListener('click', e => {
  /* The owner select lives inside a row whose job is to open the lead. Without
     this, choosing a name would also swap the panel out from under the hand
     that was choosing it. */
  if (e.target.closest('[data-own]')) return;

  const t2 = e.target.closest('[data-tile]');
  if (t2) {
    /* Pressing the tile that is already down clears it, which is the only
       thing anybody tries when they want the whole book back. */
    tile = (tile === t2.dataset.tile || t2.dataset.tile === 'all') ? '' : t2.dataset.tile;
    PAGE_AT.lead = 0;
    return paint();
  }
  if (e.target.closest('#tileChip')) { tile = ''; PAGE_AT.lead = 0; return paint(); }

  const row = e.target.closest('[data-lead]');
  if (row) return open_(Number(row.dataset.lead));
  if (e.target.closest('#addLead')) addForm();
  const t = e.target.closest('.tab[data-t]');
  if (t) {
    $$('.tab[data-t]').forEach(x => x.setAttribute('aria-selected', String(x === t)));
    $$('.pane').forEach(x => x.classList.toggle('active', x.id === 't-' + t.dataset.t));
  }
});
/* Any change to the filters puts them back on the first page. Narrowing a
   list while standing on page five and being shown an empty table is the
   commonest way paging goes wrong. */
['#fStatus', '#fSource', '#fOwner'].forEach(s =>
  document.addEventListener('change', e => {
    if (e.target.matches(s)) { PAGE_AT.lead = 0; paint(); }
  }));
document.addEventListener('input', e => {
  if (e.target.id === 'fQ') { PAGE_AT.lead = 0; paint(); }
});

document.addEventListener('change', e => {
  const sel = e.target.closest('[data-own]');
  if (sel) setOwner(Number(sel.dataset.own), sel.value);
});

/* A lead arriving while somebody is looking at the book should appear in it. */
connectLive({ chat: () => load() });

load();
"""
