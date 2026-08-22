"""Visitors asking questions on the website, and the person answering them."""

BODY = """
    <div class="out" style="grid-template-columns:repeat(3,1fr);margin:0 0 18px">
      <div><b id="kOpen">—</b><span>Waiting for a reply</span></div>
      <div><b id="kToday">—</b><span>Started today</span></div>
      <div><b id="kAll">—</b><span>Conversations in all</span></div>
    </div>

    <div class="tabs" style="margin-bottom:16px">
      <button class="tab" data-t="live" aria-selected="true">Chats
        <span class="n" id="nChat">0</span></button>
      <button class="tab" data-t="enq" aria-selected="false">Enquiry forms
        <span class="n" id="nEnq">0</span></button>
    </div>

    <section class="pane active" id="t-live">
    <div class="p-cols" style="align-items:start;gap:16px">
      <div class="p-card" style="padding:0;max-height:74vh;overflow-y:auto">
        <div style="padding:13px 15px;border-bottom:1px solid var(--line);display:flex;
          gap:10px;align-items:center;flex-wrap:wrap">
          <b style="font:700 12.6px/1 var(--sans);letter-spacing:.07em;text-transform:uppercase;
            color:var(--muted)">Conversations</b>
          <label style="margin-left:auto;display:flex;gap:7px;align-items:center;
            font:600 12.4px/1.4 var(--sans);color:var(--navy-800)">
            <input type="checkbox" id="onlyOpen" checked> Only ones needing a reply</label>
        </div>
        <ul class="doclist" id="chatList" style="gap:0"></ul>
      </div>

      <div class="p-card" id="chatPane">
        <p style="margin:0;font-size:13px;color:var(--muted);line-height:1.7">
          Pick a conversation on the left.<br><br>
          These come from the chat box on the website, from people who have not made an account.
          Every one of them left a name and a number, and every one is in the enquiries book too
          — so a chat nobody gets to in time is still a lead somebody can call.</p>
      </div>
    </div>
    </section>

    <!-- ------------------------------------------------------- the forms -->
    <section class="pane" id="t-enq">
      <div class="p-card" style="padding:0;overflow-x:auto">
        <table class="tbl" style="margin:0">
          <thead><tr><th>Who</th><th>How to reach them</th><th>Where from</th>
            <th>How</th><th>When</th></tr></thead>
          <tbody id="enqRows"></tbody>
        </table>
      </div>
      <p style="margin:12px 0 0;font-size:12.2px;color:var(--muted);line-height:1.6">
        Every enquiry form on the website lands here, and so does everyone who starts a chat.
        This list is the reason the forms exist &mdash; before it, the operations site showed
        how many there were and no way to read one.</p>
    </section>
"""

SCRIPT = r"""
let CHATS = [], openId = null;

const fmtWhen = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString('en-IN', {hour: 'numeric', minute: '2-digit'})
    : d.toLocaleDateString('en-IN', {day: 'numeric', month: 'short'});
};

function paintList() {
  const onlyOpen = $('#onlyOpen').checked;
  /* "Needs a reply" is the last message being theirs, not the status flag: a
     conversation somebody marked done and the visitor then wrote into again is
     exactly the one that must not disappear off this list. */
  const needsReply = c => c.lastFrom === 'me' || c.unseen > 0;
  const list = CHATS.filter(c => !onlyOpen || needsReply(c));

  $('#kOpen').textContent = CHATS.filter(needsReply).length;
  $('#kAll').textContent = CHATS.length;
  $('#nChat').textContent = CHATS.length;
  const today = new Date().toDateString();
  $('#kToday').textContent = CHATS.filter(c => new Date(c.at).toDateString() === today).length;

  $('#chatList').innerHTML = list.map(c =>
    '<li data-chat="' + c.id + '" style="cursor:pointer;padding:13px 15px;border-bottom:' +
      '1px solid var(--line);align-items:flex-start;gap:4px;flex-direction:column;' +
      (c.id === openId ? 'background:#f4f7fb' : '') + '">' +
    '<span style="display:flex;width:100%;gap:9px;align-items:center">' +
      '<b style="font:700 13.2px/1.4 var(--sans);color:var(--navy-900)">' + esc(c.name) + '</b>' +
      (needsReply(c) ? '<span class="st wait">Needs a reply</span>' : '') +
      '<span style="margin-left:auto;font-size:11.6px;color:var(--muted)">' +
        fmtWhen(c.lastAt) + '</span></span>' +
    '<span style="font-size:12.2px;color:var(--muted);line-height:1.5">' +
      esc(c.phone || c.email || 'no number given') + '</span>' +
    (c.preview ? '<span style="font-size:12.4px;color:var(--navy-800);line-height:1.5">' +
      (c.lastFrom === 'me' ? '' : 'You: ') + esc(c.preview) + '</span>' : '') +
    '</li>').join('')
    || '<li style="padding:20px 15px;color:var(--muted);font-size:12.8px">' +
       (onlyOpen ? 'Nothing waiting. Untick the box to see the rest.'
                 : 'No conversations yet.') + '</li>';
}

function paintChat(c) {
  const bubble = m =>
    '<div style="max-width:78%;padding:9px 13px;border-radius:13px;font-size:13.2px;' +
      'line-height:1.65;white-space:pre-wrap;' +
      (m.who === 'them'
        ? 'align-self:flex-end;background:var(--navy-700);color:#fff;border-bottom-right-radius:5px"'
        : 'align-self:flex-start;background:#fff;border:1px solid var(--line);border-bottom-left-radius:5px"') +
    '>' + esc(m.t) +
    '<small style="display:block;margin-top:4px;font-size:11px;opacity:.7">' +
      (m.who === 'them' ? esc(m.name || 'Glovels') : esc(c.name)) + ' · ' + fmtWhen(m.at) +
    '</small></div>';

  $('#chatPane').innerHTML =
      '<div style="display:flex;gap:11px;align-items:flex-start;flex-wrap:wrap;' +
        'padding-bottom:13px;border-bottom:1px solid var(--line);margin-bottom:14px">' +
        '<div><b style="font:700 15px/1.3 var(--disp,inherit);color:var(--navy-900)">' +
          esc(c.name) + '</b>' +
        '<span style="display:block;font-size:12.4px;color:var(--muted);margin-top:3px">' +
          esc(c.phone || '') + (c.phone && c.email ? ' · ' : '') + esc(c.email || '') +
          ' · started ' + fmtWhen(c.at) + '</span></div>' +
        (c.phone ? '<a class="btn btn-ghost btn-sm" style="margin-left:auto" href="tel:' +
          esc(c.phone) + '">Call</a>' : '') +
        '<button type="button" class="btn btn-ghost btn-sm" id="chatDone">' +
          (c.status === 'open' ? 'Mark done' : 'Reopen') + '</button>' +
      '</div>' +
      '<div id="chatThread" style="display:flex;flex-direction:column;gap:9px;max-height:44vh;' +
        'overflow-y:auto;padding:4px 2px 12px">' + c.messages.map(bubble).join('') + '</div>' +
      '<form id="chatForm" style="display:flex;gap:9px;align-items:flex-end;margin-top:12px">' +
        '<textarea id="chatBox" rows="2" placeholder="Write back…" style="flex:1;padding:10px 12px;' +
          'font:400 13.2px/1.6 var(--sans);border:1.5px solid #d8dde4;border-radius:10px;' +
          'resize:none"></textarea>' +
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
  await async function loadEnquiries() {
  const r = await api('GET', '/api/staff/enquiries');
  $('#nEnq').textContent = r.enquiries.length;
  $('#enqRows').innerHTML = r.enquiries.map(e =>
    '<tr>' +
      '<td><b>' + esc(e.name || 'no name') + '</b>' +
        (e.destination ? '<br><span style="font-size:11.6px;color:var(--muted)">' +
          esc(e.destination) + '</span>' : '') + '</td>' +
      '<td>' + (e.phone ? '<a href="tel:' + esc(e.phone) + '">' + esc(e.phone) + '</a>' : '') +
        (e.phone && e.email ? '<br>' : '') +
        (e.email ? '<a href="mailto:' + esc(e.email) + '">' + esc(e.email) + '</a>' : '') +
        (!e.phone && !e.email ? '<span style="color:var(--muted)">nothing given</span>' : '') +
      '</td>' +
      '<td style="font-size:12.4px;color:var(--muted)">' + esc(e.page || '—') + '</td>' +
      '<td>' + (e.how === 'chat' ? '<span class="st ok">Chat</span>'
                                 : '<span class="st none">Form</span>') + '</td>' +
      '<td style="font-size:12.4px;white-space:nowrap">' + fmtWhen(e.at) + '</td>' +
    '</tr>').join('')
    || '<tr><td colspan="5" style="padding:22px;color:var(--muted)">Nothing yet.</td></tr>';
}

document.addEventListener('click', e => {
  const t = e.target.closest('.tab[data-t]');
  if (!t) return;
  $$('.tab[data-t]').forEach(x => x.setAttribute('aria-selected', String(x === t)));
  $$('.pane').forEach(x => x.classList.toggle('active', x.id === 't-' + t.dataset.t));
});

loadList();
loadEnquiries();
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
});

document.addEventListener('change', e => {
  if (e.target.id === 'onlyOpen') paintList();
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
    await async function loadEnquiries() {
  const r = await api('GET', '/api/staff/enquiries');
  $('#nEnq').textContent = r.enquiries.length;
  $('#enqRows').innerHTML = r.enquiries.map(e =>
    '<tr>' +
      '<td><b>' + esc(e.name || 'no name') + '</b>' +
        (e.destination ? '<br><span style="font-size:11.6px;color:var(--muted)">' +
          esc(e.destination) + '</span>' : '') + '</td>' +
      '<td>' + (e.phone ? '<a href="tel:' + esc(e.phone) + '">' + esc(e.phone) + '</a>' : '') +
        (e.phone && e.email ? '<br>' : '') +
        (e.email ? '<a href="mailto:' + esc(e.email) + '">' + esc(e.email) + '</a>' : '') +
        (!e.phone && !e.email ? '<span style="color:var(--muted)">nothing given</span>' : '') +
      '</td>' +
      '<td style="font-size:12.4px;color:var(--muted)">' + esc(e.page || '—') + '</td>' +
      '<td>' + (e.how === 'chat' ? '<span class="st ok">Chat</span>'
                                 : '<span class="st none">Form</span>') + '</td>' +
      '<td style="font-size:12.4px;white-space:nowrap">' + fmtWhen(e.at) + '</td>' +
    '</tr>').join('')
    || '<tr><td colspan="5" style="padding:22px;color:var(--muted)">Nothing yet.</td></tr>';
}

document.addEventListener('click', e => {
  const t = e.target.closest('.tab[data-t]');
  if (!t) return;
  $$('.tab[data-t]').forEach(x => x.setAttribute('aria-selected', String(x === t)));
  $$('.pane').forEach(x => x.classList.toggle('active', x.id === 't-' + t.dataset.t));
});

loadList();
loadEnquiries();
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
    await async function loadEnquiries() {
  const r = await api('GET', '/api/staff/enquiries');
  $('#nEnq').textContent = r.enquiries.length;
  $('#enqRows').innerHTML = r.enquiries.map(e =>
    '<tr>' +
      '<td><b>' + esc(e.name || 'no name') + '</b>' +
        (e.destination ? '<br><span style="font-size:11.6px;color:var(--muted)">' +
          esc(e.destination) + '</span>' : '') + '</td>' +
      '<td>' + (e.phone ? '<a href="tel:' + esc(e.phone) + '">' + esc(e.phone) + '</a>' : '') +
        (e.phone && e.email ? '<br>' : '') +
        (e.email ? '<a href="mailto:' + esc(e.email) + '">' + esc(e.email) + '</a>' : '') +
        (!e.phone && !e.email ? '<span style="color:var(--muted)">nothing given</span>' : '') +
      '</td>' +
      '<td style="font-size:12.4px;color:var(--muted)">' + esc(e.page || '—') + '</td>' +
      '<td>' + (e.how === 'chat' ? '<span class="st ok">Chat</span>'
                                 : '<span class="st none">Form</span>') + '</td>' +
      '<td style="font-size:12.4px;white-space:nowrap">' + fmtWhen(e.at) + '</td>' +
    '</tr>').join('')
    || '<tr><td colspan="5" style="padding:22px;color:var(--muted)">Nothing yet.</td></tr>';
}

document.addEventListener('click', e => {
  const t = e.target.closest('.tab[data-t]');
  if (!t) return;
  $$('.tab[data-t]').forEach(x => x.setAttribute('aria-selected', String(x === t)));
  $$('.pane').forEach(x => x.classList.toggle('active', x.id === 't-' + t.dataset.t));
});

loadList();
loadEnquiries();
    if (openId) {
      const r = await api('GET', '/api/staff/chat/' + openId);
      paintChat(r.chat);
    }
  },
});

async function loadEnquiries() {
  const r = await api('GET', '/api/staff/enquiries');
  $('#nEnq').textContent = r.enquiries.length;
  $('#enqRows').innerHTML = r.enquiries.map(e =>
    '<tr>' +
      '<td><b>' + esc(e.name || 'no name') + '</b>' +
        (e.destination ? '<br><span style="font-size:11.6px;color:var(--muted)">' +
          esc(e.destination) + '</span>' : '') + '</td>' +
      '<td>' + (e.phone ? '<a href="tel:' + esc(e.phone) + '">' + esc(e.phone) + '</a>' : '') +
        (e.phone && e.email ? '<br>' : '') +
        (e.email ? '<a href="mailto:' + esc(e.email) + '">' + esc(e.email) + '</a>' : '') +
        (!e.phone && !e.email ? '<span style="color:var(--muted)">nothing given</span>' : '') +
      '</td>' +
      '<td style="font-size:12.4px;color:var(--muted)">' + esc(e.page || '—') + '</td>' +
      '<td>' + (e.how === 'chat' ? '<span class="st ok">Chat</span>'
                                 : '<span class="st none">Form</span>') + '</td>' +
      '<td style="font-size:12.4px;white-space:nowrap">' + fmtWhen(e.at) + '</td>' +
    '</tr>').join('')
    || '<tr><td colspan="5" style="padding:22px;color:var(--muted)">Nothing yet.</td></tr>';
}

document.addEventListener('click', e => {
  const t = e.target.closest('.tab[data-t]');
  if (!t) return;
  $$('.tab[data-t]').forEach(x => x.setAttribute('aria-selected', String(x === t)));
  $$('.pane').forEach(x => x.classList.toggle('active', x.id === 't-' + t.dataset.t));
});

loadList();
loadEnquiries();
"""
