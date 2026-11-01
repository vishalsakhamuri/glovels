"""Visitors asking questions on the website, and the person answering them."""

BODY = """
    <style>
      /* Patch 217: the screen as an inbox, not a spreadsheet.
         The enquiry book was a five-column table, and one long message (or
         an unbroken string of x's) took the whole width, so the phone number
         and the email broke one character to a line beside it. Every enquiry
         is a card now: who and how to reach them on the left, what they said
         in the middle (clamped, so nothing can widen anything), and how and
         when on the right. The palette is the page's own. */
      .wc-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0 0 18px}
      .wc-kpi{position:relative;display:flex;gap:13px;align-items:center;background:var(--paper);
        border:1px solid var(--line);border-radius:var(--r-lg);padding:15px 16px;box-shadow:var(--sh-1);
        overflow:hidden;min-width:0}
      .wc-kpi::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--acc,var(--gold))}
      .wc-kpi .ic{flex:none;width:40px;height:40px;border-radius:12px;display:grid;place-items:center;
        background:var(--accbg,#fdf6e6);color:var(--acc,var(--gold-deep))}
      .wc-kpi .ic .ico{font-size:19px}
      .wc-kpi b{display:block;font:600 26px/1.05 var(--disp);color:var(--navy-900)}
      .wc-kpi span{display:block;margin-top:4px;font:700 10.4px/1.3 var(--sans);letter-spacing:.09em;
        text-transform:uppercase;color:var(--muted)}
      .wc-kpi.k-open{--acc:#9aa6b4;--accbg:#f2f4f7}
      .wc-kpi.k-open.hot{--acc:#c0392b;--accbg:#fdecea;background:linear-gradient(120deg,#fff 55%,#fdf0ef);
        border-color:#f0cbc7}
      .wc-kpi.k-open.hot b{color:#a3281c}
      .wc-kpi.k-open.hot span{color:#a8514a}
      .wc-kpi.k-today{--acc:var(--blue);--accbg:#eaf0fb}
      .wc-kpi.k-all{--acc:var(--navy-700);--accbg:#e9eef4}
      .wc-kpi.k-enq{--acc:var(--gold-deep);--accbg:#fdf6e6}

      .wc-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 14px}
      .wc-bar .tabs{margin:0}
      .wc-search{position:relative;flex:1 1 240px;min-width:0;max-width:380px;margin-left:auto}
      .wc-search input{width:100%;padding:10px 12px 10px 36px;font:500 13.2px/1.3 var(--sans);
        color:var(--navy-900);background:var(--paper);border:1.5px solid var(--line);border-radius:var(--r-pill)}
      .wc-search input:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px rgba(201,162,75,.18)}
      .wc-search svg{position:absolute;left:13px;top:50%;transform:translateY(-50%);width:15px;height:15px;
        color:var(--muted)}
      .wc-chips{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 14px}
      .wc-chip{display:inline-flex;align-items:center;gap:6px;font:700 12px/1 var(--sans);
        padding:8px 12px;border-radius:var(--r-pill);border:1.5px solid var(--line);background:var(--paper);
        color:var(--navy-800);cursor:pointer}
      .wc-chip i{font-style:normal;font:800 10.4px/1 var(--sans);padding:3px 6px;border-radius:99px;
        background:#eef1f5;color:var(--muted)}
      .wc-chip[aria-pressed="true"]{background:var(--navy-800);border-color:var(--navy-800);color:#fff}
      .wc-chip[aria-pressed="true"] i{background:rgba(255,255,255,.2);color:#fff}
      .wc-chip.c-wait[aria-pressed="false"] i.on{background:#fdecea;color:#a3281c}

      .wc-av{flex:none;width:38px;height:38px;border-radius:50%;display:grid;place-items:center;
        font:700 14px/1 var(--sans);color:#fff;background:var(--avc,var(--navy-700));letter-spacing:.02em}
      .wc-flag{display:inline-flex;align-items:center;gap:5px;max-width:100%;font:600 11.6px/1.2 var(--sans);
        color:var(--navy-800);background:#f4f6f9;border:1px solid #e3e8ee;border-radius:var(--r-pill);
        padding:3px 9px 3px 7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .wc-flag em{font-style:normal;font-size:13px;line-height:1}
      .wc-pills{display:flex;flex-direction:column;gap:6px;min-width:0}
      .wc-pill{display:flex;align-items:center;gap:7px;max-width:100%;min-width:0;align-self:flex-start;
        font:600 12.4px/1.2 var(--sans);color:var(--navy-800);text-decoration:none;
        background:#fff;border:1px solid #dfe4ea;border-radius:var(--r-pill);padding:6px 11px 6px 9px}
      .wc-pill:hover{border-color:var(--navy-700);background:#f4f7fb}
      .wc-pill svg,.wc-pill .ico{flex:none;width:14px;height:14px;font-size:14px;color:var(--gold-deep)}
      .wc-pill span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
      .wc-src{display:inline-block;max-width:100%;font:600 11.4px/1.3 var(--sans);color:#3f5d80;
        background:#eef3fa;border:1px solid #d3e0ef;border-radius:7px;padding:3px 8px;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:middle}
      .wc-how{display:inline-flex;align-items:center;gap:5px;font:800 10px/1 var(--sans);letter-spacing:.08em;
        text-transform:uppercase;padding:5px 9px;border-radius:var(--r-pill);white-space:nowrap}
      .wc-how::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
      .wc-how.h-form{background:#eaf0fb;color:var(--blue-deep)}
      .wc-how.h-chat{background:#eaf6ee;color:#14603a}
      .wc-how.h-book{background:#fdf3dc;color:#8a6410}
      .wc-when{font:600 12px/1.3 var(--sans);color:var(--muted);white-space:nowrap;cursor:help}
      .wc-owner{display:inline-block;font:700 11px/1.3 var(--sans);color:#8a5a1a;background:#fdf6e6;
        border-radius:6px;padding:2px 7px}

      /* The enquiry book. Still a table underneath — other screens and the
         tests count its rows — but every row is laid out as a card. */
      .wc-book{display:block;width:100%;border-collapse:separate;margin:0}
      .wc-book thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
      .wc-book tbody{display:grid;gap:10px}
      .wc-book tr.enq{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.75fr) 150px;
        gap:6px 18px;align-items:start;background:var(--paper);border:1px solid var(--line);
        border-radius:var(--r-lg);padding:15px 17px;box-shadow:var(--sh-1);transition:border-color .15s}
      .wc-book tr.enq:hover{border-color:#d6cfbd}
      .wc-book tr.enq.is-new{box-shadow:inset 3px 0 0 var(--gold),var(--sh-1)}
      .wc-book td{display:block;padding:0;border:0;min-width:0}
      .p-main .wc-book td{border-bottom:0 !important}
      /* The shared staff look draws every .pane as a card; here each row is
         already a card, so the pane itself stays flat rather than framing
         cards inside a card. */
      .p-main #t-live.pane,.p-main #t-enq.pane{background:none;box-shadow:none;border:0 !important;padding:0}
      .wc-who{display:flex;gap:11px;align-items:flex-start;min-width:0}
      .wc-who > div{min-width:0;flex:1}
      .wc-name{display:block;font:700 14.4px/1.3 var(--sans);color:var(--navy-900);
        overflow-wrap:anywhere;margin-bottom:5px}
      .wc-who .wc-pills{margin-top:9px}
      .wc-msg{margin:0;font:400 13.2px/1.6 var(--sans);color:var(--ink);overflow-wrap:anywhere;
        word-break:break-word;white-space:pre-line;display:-webkit-box;-webkit-box-orient:vertical;
        -webkit-line-clamp:3;line-clamp:3;overflow:hidden}
      .wc-msg.none{color:var(--muted);font-style:italic}
      tr.open .wc-msg{display:block;-webkit-line-clamp:unset;line-clamp:none}
      .wc-more{margin-top:5px;background:none;border:0;padding:0;font:700 12px/1 var(--sans);
        color:var(--blue);cursor:pointer}
      .wc-lab{display:block;font:800 9.6px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;
        color:var(--muted);margin-bottom:6px}
      .wc-meta{display:flex;flex-direction:column;align-items:flex-end;gap:7px;text-align:right;min-width:0}
      .wc-empty{display:block;padding:30px 18px;text-align:center;color:var(--muted);font-size:13px;
        background:var(--paper);border:1px dashed #cfd6de;border-radius:var(--r-lg)}
      .wc-book tr.none td{display:block}

      /* The chat list and the open conversation. */
      .wc-list li{cursor:pointer;padding:13px 15px;border-bottom:1px solid var(--line);display:flex;
        gap:11px;align-items:flex-start;position:relative;transition:background .12s}
      .wc-list li:hover{background:#fafbfc}
      .wc-list li.wait{background:#fffaf0}
      .wc-list li.wait::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:#d98a1c}
      .wc-list li.on{background:#eef3fa}
      .wc-list li.on::after{content:"";position:absolute;right:0;top:0;bottom:0;width:3px;background:var(--navy-700)}
      .wc-list .body{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
      .wc-list .top{display:flex;gap:8px;align-items:center;min-width:0}
      .wc-list .top b{font:700 13.4px/1.35 var(--sans);color:var(--navy-900);overflow:hidden;
        text-overflow:ellipsis;white-space:nowrap;min-width:0}
      .wc-list .top .wc-when{margin-left:auto;font-size:11.4px}
      .wc-list .contact{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .wc-list .prev{font-size:12.6px;color:var(--navy-800);line-height:1.5;overflow-wrap:anywhere;
        display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
      .wc-list .prev i{font-style:normal;color:var(--muted);font-weight:600}
      .wc-list .st.wait{flex:none;margin-left:0}

      .wc-head{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding-bottom:14px;
        border-bottom:1px solid var(--line);margin-bottom:12px}
      .wc-head .who{flex:1 1 200px;min-width:0}
      .wc-head .who b{display:block;font:600 18px/1.25 var(--disp);color:var(--navy-900);overflow-wrap:anywhere}
      .wc-head .who small{display:block;font-size:12px;color:var(--muted);margin-top:3px}
      .wc-head .wc-pills{flex-direction:row;flex-wrap:wrap;width:100%}
      .wc-head .acts{display:flex;gap:8px;flex-wrap:wrap}
      #chatThread{display:flex;flex-direction:column;gap:8px;max-height:46vh;overflow-y:auto;
        padding:6px 4px 12px;background:#fbfaf6;border:1px solid #efece3;border-radius:12px}
      .wc-day{align-self:center;font:700 10.4px/1 var(--sans);letter-spacing:.09em;text-transform:uppercase;
        color:var(--muted);background:#fff;border:1px solid var(--line);border-radius:99px;padding:5px 10px;margin:6px 0}
      .wc-bub{max-width:min(78%,560px);padding:9px 13px;border-radius:14px;font-size:13.2px;line-height:1.6;
        white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;min-width:0}
      .wc-bub.staff{align-self:flex-end;background:var(--navy-700);color:#fff;border-bottom-right-radius:5px}
      .wc-bub.visitor{align-self:flex-start;background:#fff;border:1px solid var(--line);
        border-bottom-left-radius:5px;color:var(--ink)}
      .wc-bub small{display:block;margin-top:4px;font-size:11px;opacity:.72}
      #chatForm{display:flex;gap:9px;align-items:flex-end;margin-top:12px}
      #chatBox{flex:1;min-width:0;padding:10px 12px;font:400 13.2px/1.6 var(--sans);border:1.5px solid #d8dde4;
        border-radius:12px;resize:none}
      #chatBox:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px rgba(201,162,75,.18)}
      .wc-blank{text-align:center;padding:26px 10px}
      .wc-blank .ic{width:54px;height:54px;border-radius:16px;margin:0 auto 12px;display:grid;place-items:center;
        background:#fdf6e6;color:var(--gold-deep)}
      .wc-blank .ic .ico{font-size:24px}
      .wc-blank b{display:block;font:600 17px/1.3 var(--disp);color:var(--navy-900);margin-bottom:6px}
      .wc-blank p{margin:0 auto;max-width:46ch;font-size:13px;color:var(--muted);line-height:1.7}

      @media (max-width:1100px){
        .wc-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
        .wc-book tr.enq{grid-template-columns:minmax(0,1fr) auto}
        .wc-book td.c-msg{grid-column:1 / -1;grid-row:2}
      }
      @media (max-width:640px){
        .wc-kpis{gap:9px}
        .wc-kpi{padding:12px 12px;gap:10px}
        .wc-kpi .ic{width:34px;height:34px;border-radius:10px}
        .wc-kpi b{font-size:22px}
        .wc-kpi span{font-size:9.6px}
        .wc-search{max-width:none;margin-left:0;flex-basis:100%}
        .wc-book tr.enq{grid-template-columns:minmax(0,1fr);padding:14px}
        .wc-book td.c-msg{grid-row:auto}
        .wc-meta{flex-direction:row;flex-wrap:wrap;align-items:center;justify-content:flex-start;text-align:left;
          padding-top:9px;border-top:1px dashed var(--line)}
        .wc-meta .wc-when{margin-left:auto}
        .wc-bub{max-width:88%}
      }
    </style>

    <div class="wc-kpis">
      <div class="wc-kpi k-open" id="kOpenTile"><div class="ic"><svg class="ico" aria-hidden="true"><use href="#i-chat"/></svg></div>
        <div><b id="kOpen">&mdash;</b><span>Waiting for a reply</span></div></div>
      <div class="wc-kpi k-today"><div class="ic"><svg class="ico" aria-hidden="true"><use href="#i-clock"/></svg></div>
        <div><b id="kToday">&mdash;</b><span>Started today</span></div></div>
      <div class="wc-kpi k-all"><div class="ic"><svg class="ico" aria-hidden="true"><use href="#i-user"/></svg></div>
        <div><b id="kAll">&mdash;</b><span>Conversations in all</span></div></div>
      <div class="wc-kpi k-enq"><div class="ic"><svg class="ico" aria-hidden="true"><use href="#i-mail"/></svg></div>
        <div><b id="kEnq">&mdash;</b><span>Enquiries in the book</span></div></div>
    </div>

    <div class="wc-bar">
      <div class="tabs">
        <button class="tab" data-t="live" aria-selected="true">Chats
          <span class="n" id="nChat">0</span></button>
        <button class="tab" data-t="enq" aria-selected="false">Enquiry forms
          <span class="n" id="nEnq">0</span></button>
      </div>
      <label class="wc-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"
          aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <input type="search" id="wcSearch" placeholder="Search name, phone, email, message&hellip;"
          aria-label="Search conversations and enquiries" autocomplete="off">
      </label>
    </div>
    <div class="wc-chips" role="group" aria-label="Quick filters">
      <button type="button" class="wc-chip" data-f="all" aria-pressed="true">All <i data-n="all">0</i></button>
      <button type="button" class="wc-chip c-wait" data-f="wait" aria-pressed="false">Waiting <i data-n="wait">0</i></button>
      <button type="button" class="wc-chip" data-f="today" aria-pressed="false">Today <i data-n="today">0</i></button>
      <button type="button" class="wc-chip" data-f="form" aria-pressed="false">Forms <i data-n="form">0</i></button>
      <button type="button" class="wc-chip" data-f="chat" aria-pressed="false">Chats <i data-n="chat">0</i></button>
    </div>

    <section class="pane active" id="t-live">
    <div class="p-cols" style="align-items:start;gap:16px;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr)">
      <div class="p-card" style="padding:0;max-height:74vh;overflow-y:auto;min-width:0">
        <div style="padding:13px 15px;border-bottom:1px solid var(--line);display:flex;
          gap:10px;align-items:center;flex-wrap:wrap;position:sticky;top:0;background:var(--paper);z-index:1">
          <b style="font:700 12.6px/1 var(--sans);letter-spacing:.07em;text-transform:uppercase;
            color:var(--muted)">Conversations</b>
          <label style="margin-left:auto;display:flex;gap:7px;align-items:center;
            font:600 12.4px/1.4 var(--sans);color:var(--navy-800)">
            <input type="checkbox" id="onlyOpen" checked> Only ones needing a reply</label>
        </div>
        <ul class="doclist wc-list" id="chatList" style="gap:0"></ul>
      </div>

      <div class="p-card" id="chatPane" style="min-width:0">
        <div class="wc-blank">
          <div class="ic"><svg class="ico" aria-hidden="true"><use href="#i-chat"/></svg></div>
          <b>Pick a conversation</b>
          <p>These come from the chat box on the website, from people who have not made an account.
          Every one of them left a name and a number, and every one is in the enquiries book too
          &mdash; so a chat nobody gets to in time is still a lead somebody can call.</p>
        </div>
      </div>
    </div>
    </section>

    <!-- ------------------------------------------------------- the forms -->
    <section class="pane" id="t-enq">
      <div class="p-card" style="margin-bottom:14px;display:flex;gap:12px;flex-wrap:wrap;
        align-items:center">
        <div style="flex:1;min-width:220px">
          <b style="display:block;font:700 13.4px/1.45 var(--sans);color:var(--navy-900)">
            These are also in the Leads book, with everything else</b>
          <span style="font-size:12.3px;color:var(--muted);line-height:1.6">
            Facebook, WhatsApp, Google, the blog and the chats, in one list — with who
            owns each one, how many times we have followed up, and why the ones that did
            not convert did not convert.</span>
        </div>
        <a class="btn btn-primary btn-sm" href="leads.html">Open the Leads book</a>
      </div>
      <table class="wc-book">
        <thead><tr><th>Who and how to reach them</th><th>What they said</th>
          <th>How, where from and when</th></tr></thead>
        <tbody id="enqRows"></tbody>
      </table>
      <p style="margin:12px 0 0;font-size:12.2px;color:var(--muted);line-height:1.6">
        Every enquiry form on the website lands here, and so does everyone who starts a chat.
        This list is the reason the forms exist &mdash; before it, the operations site showed
        how many there were and no way to read one.</p>
    </section>
"""

SCRIPT = r"""
let CHATS = [], ENQS = [], openId = null, FILTER = 'all', QUERY = '';

const fmtWhen = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString('en-IN', {hour: 'numeric', minute: '2-digit'})
    : d.toLocaleDateString('en-IN', {day: 'numeric', month: 'short'});
};
/* "2 days ago" to read at a glance; the exact date and time in the tooltip. */
const fullWhen = iso => iso ? new Date(iso).toLocaleString('en-IN',
  {day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit'}) : '';
const ago = iso => {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return m + ' min ago';
  const h = Math.floor(m / 60); if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return d + ' days ago';
  if (d < 35) { const w = Math.floor(d / 7); return w + (w === 1 ? ' week ago' : ' weeks ago'); }
  return fmtWhen(iso);
};
const whenTag = iso => iso
  ? '<time class="wc-when" datetime="' + esc(iso) + '" title="' + esc(fullWhen(iso)) + '">' +
    esc(ago(iso)) + '</time>' : '';
const isToday = iso => !!iso && new Date(iso).toDateString() === new Date().toDateString();

/* An initial in a circle, its colour picked from the name so the same person
   is the same colour every time. */
const AVC = ['#13385c', '#1c4d78', '#1a4fb4', '#1f7a4d', '#b98f34', '#7a4f9a', '#a3462d', '#2f6f73'];
const avatar = name => {
  const n = String(name || '').trim();
  const parts = n.split(/\s+/).filter(Boolean);
  const ini = ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  let h = 0; for (const ch of n) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return '<span class="wc-av" aria-hidden="true" style="--avc:' + AVC[h % AVC.length] + '">' +
    esc(ini) + '</span>';
};
const flagOf = code => /^[A-Z]{2}$/.test(String(code || ''))
  ? String.fromCodePoint(...[...code].map(c => 0x1F1A5 + c.charCodeAt(0))) : '';
const destChip = (code, name) => {
  if (!code && !name) return '';
  const label = name || code;
  const f = flagOf(code);
  return '<span class="wc-flag" title="' + esc(label) + '">' +
    (f ? '<em aria-hidden="true">' + f + '</em>' : '<svg class="ico" aria-hidden="true"><use href="#i-globe"/></svg>') +
    esc(label) + '</span>';
};

const PHONE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 ' +
  '19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 ' +
  '1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>';
const telHref = p => 'tel:' + String(p || '').replace(/[^\d+]/g, '');
const pills = (phone, email) =>
  (phone ? '<a class="wc-pill" href="' + esc(telHref(phone)) + '" title="Call ' + esc(phone) + '">' +
    PHONE_SVG + '<span>' + esc(phone) + '</span></a>' : '') +
  (email ? '<a class="wc-pill" href="mailto:' + esc(email) + '" title="Email ' + esc(email) + '">' +
    '<svg class="ico" aria-hidden="true"><use href="#i-mail"/></svg><span>' + esc(email) + '</span></a>' : '');

/* "/find-university?x=1" reads as "Find university"; the raw path is in the
   tooltip for whoever needs it. A campaign label is shown as it was given. */
const PAGE_NAMES = { '/': 'Home page', '/index': 'Home page', '/home': 'Home page',
  '/find-university': 'Find university', '/contact-us': 'Contact us', '/about-us': 'About us' };
const pageLabel = raw => {
  const p = String(raw || '').trim();
  if (!p) return '';
  if (p[0] !== '/') return p;
  const path = p.split(/[?#]/)[0].replace(/\.html$/, '').replace(/\/+$/, '') || '/';
  if (PAGE_NAMES[path]) return PAGE_NAMES[path];
  const segs = path.split('/').filter(Boolean);
  const last = decodeURIComponent(segs[segs.length - 1] || '').replace(/[-_]+/g, ' ').trim();
  const nice = last ? last[0].toUpperCase() + last.slice(1) : path;
  return (segs[0] === 'post' || segs[0] === 'blog') && segs.length > 1 ? 'Blog: ' + nice : nice;
};
const SOURCE_NAMES = { google: 'Google', facebook: 'Facebook', instagram: 'Instagram', whatsapp: 'WhatsApp',
  blog: 'Blog', 'no-match': 'No match found', linkedin: 'LinkedIn', youtube: 'YouTube', other: 'Elsewhere' };

const howOf = e => /^Call booked for/.test(e.note || '') ? 'book' : (e.how === 'chat' ? 'chat' : 'form');
const HOW_LABEL = { form: 'Form', chat: 'Chat', book: 'Booking' };

/* "Needs a reply" is the last message being theirs, not the status flag: a
   conversation somebody marked done and the visitor then wrote into again is
   exactly the one that must not disappear off this list. */
const needsReply = c => c.lastFrom === 'me' || c.unseen > 0;
const hay = parts => parts.map(x => String(x || '')).join(' \u0001 ').toLowerCase();
const matches = text => !QUERY || QUERY.split(/\s+/).every(w => text.includes(w));
const chatMatch = c => matches(hay([c.name, c.phone, c.email, c.preview]));
const enqMatch = e => matches(hay([e.name, e.phone, e.email, e.note, e.destination, e.destinationName,
  e.page, pageLabel(e.page), e.owner, e.campaign, HOW_LABEL[howOf(e)]]));
/* The quick filters, one rule per chip. Waiting is a chat whose last word is
   the visitor's, or an enquiry nobody has touched yet. */
const chatPass = (c, f) => f === 'all' || f === 'chat' || (f === 'wait' && needsReply(c))
  || (f === 'today' && isToday(c.at));
const enqPass = (e, f) => f === 'all' || (f === 'wait' && (e.status || 'new') === 'new')
  || (f === 'today' && isToday(e.at)) || (f === 'form' && howOf(e) !== 'chat')
  || (f === 'chat' && howOf(e) === 'chat');
const currentTab = () => (($('.tab[aria-selected="true"]') || {}).dataset || {}).t || 'live';

function paintChips() {
  const enq = currentTab() === 'enq';
  ['all', 'wait', 'today', 'form', 'chat'].forEach(f => {
    const n = enq ? ENQS.filter(e => enqMatch(e) && enqPass(e, f)).length
      : (f === 'form' ? ENQS.filter(e => enqMatch(e) && enqPass(e, 'form')).length
        : CHATS.filter(c => chatMatch(c) && chatPass(c, f)).length);
    const i = $('.wc-chip i[data-n="' + f + '"]');
    if (i) { i.textContent = n; i.classList.toggle('on', f === 'wait' && n > 0); }
  });
  $$('.wc-chip[data-f]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === FILTER)));
}

function paintList() {
  const onlyOpen = $('#onlyOpen').checked;
  const waiting = CHATS.filter(needsReply).length;
  $('#kOpen').textContent = waiting;
  $('#kOpenTile').classList.toggle('hot', waiting > 0);
  $('#kAll').textContent = CHATS.length;
  $('#nChat').textContent = CHATS.length;
  $('#kToday').textContent = CHATS.filter(c => isToday(c.at)).length;

  const f = FILTER === 'form' ? 'all' : FILTER;
  const list = CHATS.filter(c => (!onlyOpen || needsReply(c)) && chatPass(c, f) && chatMatch(c));

  $('#chatList').innerHTML = list.map(c => {
    const wait = needsReply(c);
    return '<li data-chat="' + Number(c.id) + '" class="' + (wait ? 'wait' : '') +
        (c.id === openId ? ' on' : '') + '">' + avatar(c.name) +
      '<span class="body"><span class="top"><b>' + esc(c.name) + '</b>' +
        (wait ? '<span class="st wait">Needs a reply</span>' : '') + whenTag(c.lastAt) + '</span>' +
      '<span class="contact">' + esc(c.phone || c.email || 'no number given') + '</span>' +
      (c.preview ? '<span class="prev">' + (c.lastFrom === 'me' ? '' : '<i>You: </i>') +
        esc(c.preview) + '</span>' : '') +
      '</span></li>';
  }).join('')
    || '<li style="padding:22px 15px;color:var(--muted);font-size:12.8px;cursor:default;display:block">' +
       (QUERY || f !== 'all' ? 'Nothing matches that search or filter.'
         : onlyOpen ? 'Nothing waiting. Untick the box to see the rest.'
                    : 'No conversations yet.') + '</li>';
  paintChips();
}

function paintChat(c) {
  let lastDay = '';
  /* The open conversation carries its messages, not the list's summary, so
     "waiting" is read off the last one. */
  const lastMsg = c.messages[c.messages.length - 1];
  const waiting = !!lastMsg && lastMsg.who !== 'them';
  const bubble = m => {
    const day = m.at ? new Date(m.at).toDateString() : '';
    const sep = day && day !== lastDay
      ? '<div class="wc-day">' + esc(isToday(m.at) ? 'Today'
          : new Date(m.at).toLocaleDateString('en-IN', {weekday: 'short', day: 'numeric', month: 'short'})) + '</div>'
      : '';
    lastDay = day || lastDay;
    return sep + '<div class="wc-bub ' + (m.who === 'them' ? 'staff' : 'visitor') + '">' + esc(m.t) +
      '<small title="' + esc(fullWhen(m.at)) + '">' +
        (m.who === 'them' ? esc(m.name || 'Glovels') : esc(c.name)) + ' · ' + esc(fmtWhen(m.at)) +
      '</small></div>';
  };

  $('#chatPane').innerHTML =
      '<div class="wc-head">' + avatar(c.name) +
        '<div class="who"><b>' + esc(c.name) + '</b>' +
          '<small>Started ' + whenTag(c.at) + (waiting ? ' · <span class="st wait">Needs a reply</span>' : '') +
          '</small></div>' +
        '<div class="acts">' +
          (c.phone ? '<a class="btn btn-ghost btn-sm" href="' + esc(telHref(c.phone)) + '">Call</a>' : '') +
          '<button type="button" class="btn btn-ghost btn-sm" id="chatDone">' +
            (c.status === 'open' ? 'Mark done' : 'Reopen') + '</button>' +
        '</div>' +
        '<div class="wc-pills">' + pills(c.phone, c.email) + '</div>' +
      '</div>' +
      '<div id="chatThread">' + c.messages.map(bubble).join('') + '</div>' +
      '<form id="chatForm">' +
        '<textarea id="chatBox" rows="2" placeholder="Write back… (Enter to send, Shift+Enter for a new line)"></textarea>' +
        '<button type="submit" class="btn btn-primary">Send</button>' +
      '</form>' +
      '<p style="margin:10px 0 0;font-size:11.8px;color:var(--muted);line-height:1.55">' +
        'They see this on the website straight away, if the tab is still open. If it is not, ' +
        'call the number — that is what it is there for.</p>';

  const th = $('#chatThread');
  th.scrollTop = th.scrollHeight;
  $('#chatBox').focus();
}

async function openChat(id) {
  openId = id;
  paintList();
  const r = await api('GET', '/api/staff/chat/' + id);
  paintChat(r.chat);
  await loadList();
}

async function loadList() {
  const r = await api('GET', '/api/staff/chats');
  CHATS = r.chats;
  paintList();
}

document.addEventListener('click', async e => {
  const row = e.target.closest('[data-chat]');
  if (row) return openChat(Number(row.dataset.chat));

  if (e.target.closest('#chatDone')) {
    await api('POST', '/api/staff/chat/' + openId + '/close', {});
    await openChat(openId);
    return;
  }

  const more = e.target.closest('.wc-more');
  if (more) {
    const tr = more.closest('tr');
    const open = !tr.classList.contains('open');
    tr.classList.toggle('open', open);
    more.textContent = open ? 'Show less' : 'Show more';
    more.setAttribute('aria-expanded', String(open));
    return;
  }

  const chip = e.target.closest('.wc-chip[data-f]');
  if (chip) {
    FILTER = chip.dataset.f;
    /* Forms only live on the enquiry tab, so asking for them goes there. */
    if (FILTER === 'form' && currentTab() !== 'enq') showTab('enq');
    paintList(); paintEnquiries();
  }
});

document.addEventListener('change', e => {
  if (e.target.id === 'onlyOpen') paintList();
});

let searchTimer = null;
document.addEventListener('input', e => {
  if (e.target.id !== 'wcSearch') return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    QUERY = e.target.value.trim().toLowerCase();
    paintList(); paintEnquiries();
  }, 120);
});

document.addEventListener('submit', async e => {
  if (e.target.id !== 'chatForm') return;
  e.preventDefault();
  const box = $('#chatBox');
  const body = box.value.trim();
  if (!body || !openId) return;
  box.value = '';
  try {
    const r = await api('POST', '/api/staff/chat/' + openId + '/reply', {body});
    paintChat(r.chat);
    await loadList();
  } catch (err) { toast(err.message); box.value = body; }
});

document.addEventListener('keydown', e => {
  if (e.target.id === 'chatBox' && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('#chatForm').requestSubmit();
  }
});

/* A new chat, or a new message in one, arrives on the same stream the rest of
   the operations site uses. Without this the screen is a list you have to
   remember to refresh, which is not what anybody means by live chat. */
connectLive({
  chat: async () => {
    await loadList();
    /* A chat is written into the enquiries book too, so the count on the tab
       goes stale the moment one arrives unless it is read again here. */
    loadEnquiries();
    if (openId) {
      const r = await api('GET', '/api/staff/chat/' + openId);
      paintChat(r.chat);
    }
  },
});

function enqRow(e) {
  const how = howOf(e);
  const note = String(e.note || '');
  const src = e.source && !/^(website|chat)$/.test(e.source)
    ? '<span class="wc-src" title="' + esc(e.campaign ? e.source + ' · ' + e.campaign : e.source) + '">' +
      esc(SOURCE_NAMES[e.source] || e.source) + '</span>' : '';
  const page = e.page
    ? '<span class="wc-src" title="' + esc(e.page) + '">' + esc(pageLabel(e.page)) + '</span>' : '';
  return '<tr class="enq' + ((e.status || 'new') === 'new' ? ' is-new' : '') + '">' +
    '<td class="c-who"><div class="wc-who">' + avatar(e.name) + '<div>' +
      '<b class="wc-name">' + esc(e.name || 'no name') + '</b>' +
      destChip(e.destination, e.destinationName) +
      /* WHOSE LEAD THIS IS. This list shows every enquiry in the building,
         which is the office's decision — the desk answers whoever writes in.
         But it said nothing about ownership, so two counsellors could ring
         the same person on the same afternoon and neither would know. */
      (e.owner && !e.mine ? ' <span class="wc-owner">' + esc(e.owner) + '’s lead</span>' : '') +
      '<div class="wc-pills">' + (pills(e.phone, e.email)
        || '<span style="font-size:12px;color:var(--muted)">nothing given</span>') + '</div>' +
    '</div></div></td>' +
    '<td class="c-msg"><span class="wc-lab">What they said</span>' +
      (note ? '<p class="wc-msg">' + esc(note) + '</p>' +
        (note.length > 120 || (note.match(/\n/g) || []).length > 2
          ? '<button type="button" class="wc-more" aria-expanded="false">Show more</button>' : '')
        : '<p class="wc-msg none">' + (how === 'chat'
            ? 'Started a chat on the website — read it on the Chats tab.'
            : 'No message — just their details.') + '</p>') +
    '</td>' +
    '<td class="c-meta"><div class="wc-meta">' +
      '<span class="wc-how h-' + how + '">' + HOW_LABEL[how] + '</span>' +
      whenTag(e.at) + page + src +
    '</div></td>' +
  '</tr>';
}

function paintEnquiries() {
  const list = ENQS.filter(e => enqPass(e, FILTER) && enqMatch(e));
  $('#enqRows').innerHTML = list.map(enqRow).join('')
    || '<tr class="none"><td><span class="wc-empty">' +
       (ENQS.length ? 'Nothing matches that search or filter.' : 'Nothing yet.') + '</span></td></tr>';
  paintChips();
  fitMore();
}

/* "Show more" only where the three lines actually cut something off. Measured
   after painting; a hidden tab measures zero, so it is checked again when the
   tab is opened. */
function fitMore() {
  requestAnimationFrame(() => $$('#enqRows tr.enq:not(.open) .wc-msg + .wc-more').forEach(b => {
    const m = b.previousElementSibling;
    if (m.clientHeight > 0) b.hidden = m.scrollHeight <= m.clientHeight + 2;
  }));
}

async function loadEnquiries() {
  const r = await api('GET', '/api/staff/enquiries');
  ENQS = r.enquiries || [];
  $('#nEnq').textContent = ENQS.length;
  $('#kEnq').textContent = ENQS.length;
  paintEnquiries();
}

function showTab(t) {
  $$('.tab[data-t]').forEach(x => x.setAttribute('aria-selected', String(x.dataset.t === t)));
  $$('.pane').forEach(x => x.classList.toggle('active', x.id === 't-' + t));
  /* Forms has no meaning on the chats tab, so leaving the enquiries goes back to All. */
  if (t === 'live' && FILTER === 'form') FILTER = 'all';
  paintList(); paintEnquiries();
}
window.addEventListener('resize', () => fitMore());

document.addEventListener('click', e => {
  const t = e.target.closest('.tab[data-t]');
  if (!t) return;
  showTab(t.dataset.t);
});

/* Arriving from the Enquiries counter on the Organisation screen. The hash is
   how one screen hands off to a tab on another without inventing a router. */
if (location.hash === '#enquiries') {
  const tab = $('.tab[data-t="enq"]');
  if (tab) {
    $$('.tab[data-t]').forEach(x => x.setAttribute('aria-selected', String(x === tab)));
    $$('.pane').forEach(x => x.classList.toggle('active', x.id === 't-enq'));
  }
}

/* The relative times ("3 min ago") are kept honest while the screen sits open. */
setInterval(() => { $$('time.wc-when[datetime]').forEach(t => { t.textContent = ago(t.getAttribute('datetime')); }); }, 60000);

/* Through staffBoot, like every other office screen: it is what writes the
   name and the role into the sidebar and takes the screens this account
   cannot open OFF the menu. This page called its own loaders straight and
   skipped it, so a counsellor on Website chat saw "— / —" and the
   administrator's seven-item menu. */
staffBoot(async () => { await Promise.all([loadList(), loadEnquiries()]); });
"""
