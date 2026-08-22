"""Messages — the student side of the student <-> counsellor thread."""

BODY = """
    <div class="p-cols" style="grid-template-columns:270px 1fr;align-items:start">
      <div class="p-card" style="padding:16px">
        <div style="display:flex;gap:11px;align-items:center;margin-bottom:14px">
          <span style="width:42px;height:42px;border-radius:50%;flex:none;display:grid;
            place-items:center;color:#fff;font:700 14px/1 var(--sans);
            background:linear-gradient(160deg,var(--navy-600),var(--navy-800))">KM</span>
          <div><b style="display:block;font-size:14.4px;color:var(--navy-900);line-height:1.3" id="cName">Your counsellor</b>
            <span style="font-size:11.8px;color:var(--muted)">Your counsellor · Germany desk</span></div>
        </div>
        <!-- No "replies within N hours" here. That is a service promise nobody is
             measuring yet, and the one screen where a student will hold us to it. -->
        <ul class="doclist" style="margin-bottom:14px">
          <li><svg class="ico" aria-hidden="true"><use href="#i-clock"/></svg>
            <span>Working hours</span><span class="st none">Mon–Sat 9:30–19:30 IST</span></li>
          <li><svg class="ico" aria-hidden="true"><use href="#i-check"/></svg>
            <span>Every message</span><span class="st ok">On your file</span></li>
        </ul>
        <p style="margin:0;font-size:12.2px;color:var(--muted);line-height:1.6">Anything you send
          here is on your file, so your counsellor is never working from memory. For something
          urgent, WhatsApp is faster.</p>
        <a class="btn btn-green btn-sm" style="margin-top:12px;width:100%;justify-content:center"
           href="https://wa.me/917093314089" target="_blank" rel="noopener">WhatsApp instead</a>
      </div>

      <div class="p-card" style="display:flex;flex-direction:column;height:min(640px,72vh);padding:0">
        <div style="padding:15px 18px;border-bottom:1px solid var(--line);display:flex;
          align-items:center;gap:10px">
          <b style="font-size:14.4px;color:var(--navy-900)" id="cName2">Your counsellor</b>
          <span class="sla" id="liveDot" style="margin-left:auto">connecting…</span>
        </div>
        <div id="thread" style="flex:1;overflow-y:auto;padding:18px;display:flex;
          flex-direction:column;gap:12px"></div>
        <div id="typing" style="height:17px;padding:0 18px;font:400 11.6px/1.4 var(--sans);
          color:var(--muted)"></div>
        <form id="composer" style="border-top:1px solid var(--line);padding:13px 14px;display:flex;
          gap:9px;align-items:flex-end">
          <textarea id="box" rows="1" placeholder="Ask your counsellor anything…" style="flex:1;
            resize:none;max-height:120px;padding:11px 12px;font:400 13.4px/1.5 var(--sans);
            color:var(--navy-900);border:1.5px solid #d8dde4;border-radius:12px"></textarea>
          <button type="button" class="btn btn-ghost btn-sm" id="clip" title="Attach a file">
            <svg class="ico" aria-hidden="true"><use href="#i-file"/></svg></button>
          <button type="submit" class="btn btn-primary btn-sm">Send</button>
        </form>
        <div id="hint" style="min-height:16px;padding:0 18px 12px;font:400 11.6px/1.4 var(--sans);
          color:var(--green-deep)"></div>
      </div>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">
      <span style="font:800 10.4px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;
        color:var(--muted);align-self:center">Quick questions</span>
      <button type="button" class="btn btn-ghost btn-sm" data-q="Which universities can I get into with my profile?">Which universities fit me?</button>
      <button type="button" class="btn btn-ghost btn-sm" data-q="What does the APS certificate involve and how long does it take?">About the APS</button>
      <button type="button" class="btn btn-ghost btn-sm" data-q="How much money do I need in the blocked account?">Blocked account</button>
      <button type="button" class="btn btn-ghost btn-sm" data-q="When is the deadline for the winter intake?">Deadlines</button>
    </div>
"""

SCRIPT = r"""
/* The thread is live. A message goes to the server, the server pushes it to the
   counsellor's open workspace, and their reply comes back down the same stream
   — no polling, no refresh, and no invented answers.

   The canned replies that used to live here are gone. A counsellor answers, or
   nobody does and they get an email about it; a bot that sounds like a person
   is worse than an honest wait. */

DB.msgs = DB.msgs || [];

/* The counsellor is a real account now, so use their name rather than a
   placeholder. Unassigned is stated plainly instead of being papered over. */
(function () {
  const name = COUNSELLOR ? COUNSELLOR.name : null;
  const initials = name ? name.trim().split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase() : 'GC';
  ['#cName', '#cName2'].forEach(sel => {
    const el = $(sel);
    if (el) el.textContent = name || 'Counsellor not assigned yet';
  });
  const av = document.querySelector('.p-card span[style*="border-radius:50%"]');
  if (av && name) av.textContent = initials;
})();

function bubble(m) {
  const mine = m.who === 'me';
  return '<div style="display:flex;gap:10px;' + (mine ? 'flex-direction:row-reverse' : '') + '">' +
    '<span style="width:32px;height:32px;border-radius:50%;flex:none;display:grid;place-items:center;' +
      'color:#fff;font:700 11.5px/1 var(--sans);background:' +
      (mine ? 'linear-gradient(160deg,var(--blue),var(--blue-deep))'
            : 'linear-gradient(160deg,var(--navy-600),var(--navy-800))') + '">' +
      (mine ? 'You' : 'GC') + '</span>' +
    '<div style="max-width:74%">' +
      '<div style="background:' + (mine ? '#eaf1fd' : 'var(--cream)') +
      ';border:1px solid ' + (mine ? '#c2d6f5' : 'var(--line)') + ';border-radius:14px;' +
      'padding:11px 13px;font-size:13.2px;line-height:1.6;color:var(--navy-800)">' +
      (m.file ? '<div style="display:flex;align-items:center;gap:7px;font-weight:600;' +
        'color:var(--blue-deep);margin-bottom:' + (m.t ? '6px' : '0') + '">' +
        ico('file') + esc(m.file) + '</div>' : '') +
      (m.t ? esc(m.t) : '') + '</div>' +
      '<div style="font:400 10.4px/1.6 var(--sans);color:var(--muted);margin-top:3px;' +
        (mine ? 'text-align:right' : '') + '">' + stamp(m.at) + '</div>' +
    '</div></div>';
}

function stamp(iso) {
  if (!iso) return 'just now';
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return new Date(iso).toLocaleDateString('en-GB', {day:'numeric', month:'short'});
}

function paint() {
  const th = $('#thread');
  th.innerHTML = DB.msgs.map(bubble).join('');
  th.scrollTop = th.scrollHeight;
}

async function send(text, file) {
  if (!text && !file) return;

  /* Drawn immediately. Waiting for a round trip before your own message appears
     is what makes a chat feel broken. */
  const optimistic = {who: 'me', t: text, file, at: new Date().toISOString()};
  DB.msgs.push(optimistic);
  paint();

  try {
    const r = await api('POST', '/api/messages', {body: text || '', file: file || ''});
    DB.msgs = r.msgs;
    paint();
    hint('Sent. Your counsellor sees it on their screen straight away.');
  } catch (e) {
    DB.msgs = DB.msgs.filter(m => m !== optimistic);
    paint();
    toast('That message was not sent: ' + e.message);
  }
}

/* A quiet line under the composer, for things that are information rather than
   errors — a toast for every sent message would be noise. */
function hint(text) {
  const el = $('#hint');
  if (!el) return;
  el.textContent = text;
  clearTimeout(el._h);
  el._h = setTimeout(() => { el.textContent = ''; }, 4000);
}

$('#composer').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('#box').value.trim();
  if (!v) return;
  $('#box').value = '';
  $('#box').style.height = 'auto';
  send(v);
});

let lastPing = 0;
$('#box').addEventListener('input', e => {
  e.target.style.height = 'auto';
  e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px';
  const now = Date.now();
  if (now - lastPing > 1500) { lastPing = now; api('POST', '/api/typing').catch(() => {}); }
});
$('#box').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); }
});

const picker = document.createElement('input');
picker.type = 'file';
picker.style.display = 'none';
document.body.appendChild(picker);
picker.addEventListener('change', () => {
  if (picker.files[0]) send($('#box').value.trim(), picker.files[0].name);
  $('#box').value = '';
  picker.value = '';
});
$('#clip').addEventListener('click', () => picker.click());

document.addEventListener('click', e => {
  const q = e.target.closest('[data-q]');
  if (q) send(q.dataset.q);
});

/* ------------------------------------------------------------------- live */

if (ONLINE) {
  const es = new EventSource('/api/live');
  const dot = $('#liveDot');
  es.addEventListener('hello', () => { dot.textContent = 'live'; dot.className = 'sla'; });
  es.onerror = () => { dot.textContent = 'reconnecting\u2026'; dot.className = 'sla late'; };

  es.addEventListener('message', ev => {
    const d = JSON.parse(ev.data);
    if (d.msg.who !== 'them') return;          // our own message is already drawn
    DB.msgs.push(d.msg);
    paint();
    hint('New reply from your counsellor.');
    api('POST', '/api/messages/read').catch(() => {});
  });

  es.addEventListener('typing', () => {
    const el = $('#typing');
    if (!el) return;
    el.textContent = 'Your counsellor is typing\u2026';
    clearTimeout(el._h);
    el._h = setTimeout(() => { el.textContent = ''; }, 2500);
  });

  api('POST', '/api/messages/read').catch(() => {});
} else {
  const dot = $('#liveDot');
  if (dot) { dot.textContent = 'offline'; dot.className = 'sla late'; }
}

paint();
"""
