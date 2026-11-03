'use strict';
/**
 * Patch 221 — the lead watch.
 *
 * "Chats and enquiry forms are critical. We need alerts, push notifications
 *  etc. so that someone will call and respond. The Leads book is the one where
 *  we need to monitor closely."
 *
 * Two jobs, and both are about a person on the other end who is waiting.
 *
 * ONE — the moment a lead arrives (an enquiry form, a booked call, a website
 * chat started, a visitor writing in a chat), everybody who could call them
 * hears about it:
 *
 *   a live event to every staff screen that is open ('lead', over /api/live);
 *   a web push to every active counsellor and administrator — to the owner and
 *     the administrators only, when the person already has an owned lead;
 *   an email to the office for chats (forms and bookings already send the
 *     office their own email from the enquiry handler — that one is the
 *     record, with Reply-To set to the enquirer, and is not sent twice).
 *
 *   A burst is combined. The first lead goes out at once and opens a window
 *   (two minutes by default); everything that arrives inside it goes out as
 *   one "3 new leads" notification when it closes. Ten messages from one
 *   visitor are one line, and a visitor chatting with somebody who replied in
 *   the last five minutes buzzes nobody — somebody is already on it.
 *
 * TWO — nobody answered. A lead still "new" with no call, WhatsApp, email,
 * meeting, note or chat reply on it after the first-response time (15 min)
 * re-alerts everybody: "Nobody has called Priya yet — 15 min". At the second
 * threshold (60 min) it escalates to the administrators, by push and email.
 *
 *   Derived from the database, not from memory: the age is the lead's own
 *   created_at, "answered" is its status and its notes. What has already been
 *   said is recorded in the content table (leadAlertState) BEFORE anything is
 *   sent, so a restart — or a mailer that throws — never says it twice.
 *
 *   On the very first sweep after this ships, everything already late is
 *   marked as told rather than told: an office switching this on must not be
 *   woken by sixty notifications about last month.
 *
 *   Leads older than three days are not chased by this — they are the cold
 *   leads the bell and the digest already report.
 *
 * Office hours: the site says "Mon–Sat, 9:30–19:30 IST" in its emails. When an
 * administrator turns "office hours only" on, the clocks count office minutes
 * only and the re-alerts wait for the office to open. Off by default — the
 * owner asked for alerts, and a lead at 22:00 is still a lead.
 */

const KEY_SETTINGS = 'leadSla';
const KEY_STATE = 'leadAlertState';
const KEY_LOG = 'leadAlertLog';
const LOG_MAX = 150;
const FEED_EACH = 6;                   // more overdue leads than this in one sweep is one feed line
const MAX_AGE_DAYS = 3;
const IST = 330;                       // minutes east of UTC; India has no DST

/* A "minute", for the clocks. Real minutes everywhere except the test suite,
   which sets LEAD_MINUTE_MS so a fifteen-minute SLA can be proved in seconds. */
const MIN = Number(process.env.LEAD_MINUTE_MS) > 0 ? Number(process.env.LEAD_MINUTE_MS) : 60000;
const TICK = Number(process.env.LEAD_SLA_TICK_MS) > 0 ? Number(process.env.LEAD_SLA_TICK_MS) : 60000;

const DEFAULTS = {
  on: true,
  firstMins: 15,         // a new lead gets its first call within this
  escalateMins: 60,      // ...or the administrators are told
  burstMins: 2,          // arrivals inside this window go out as one notification
  emailOffice: true,     // chats and escalations email the office address
  officeHoursOnly: false,
  days: [1, 2, 3, 4, 5, 6],   // Mon–Sat
  from: '09:30', to: '19:30', // IST
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function clean(saved) {
  const s = Object.assign({}, DEFAULTS, saved || {});
  const n = (v, lo, hi, d) => { const x = Number(v); return Number.isFinite(x) && x >= lo && x <= hi ? Math.round(x) : d; };
  const out = {
    on: s.on !== false,
    firstMins: n(s.firstMins, 1, 1440, DEFAULTS.firstMins),
    escalateMins: n(s.escalateMins, 2, 2880, DEFAULTS.escalateMins),
    burstMins: n(s.burstMins, 0, 30, DEFAULTS.burstMins),
    emailOffice: s.emailOffice !== false,
    officeHoursOnly: !!s.officeHoursOnly,
    days: (Array.isArray(s.days) ? s.days : DEFAULTS.days).map(Number).filter(d => d >= 0 && d <= 6)
      .filter((d, i, a) => a.indexOf(d) === i).sort(),
    from: HHMM.test(String(s.from)) ? String(s.from) : DEFAULTS.from,
    to: HHMM.test(String(s.to)) ? String(s.to) : DEFAULTS.to,
  };
  if (out.escalateMins <= out.firstMins) out.escalateMins = out.firstMins + 1;
  if (!out.days.length) out.days = DEFAULTS.days.slice();
  return out;
}

/** Validate an administrator's change. Returns {error} or {settings}. */
function validate(cur, b) {
  const next = Object.assign({}, cur);
  const num = (k, lo, hi, what) => {
    if (b[k] === undefined || b[k] === '') return null;
    const x = Number(b[k]);
    if (!Number.isFinite(x) || x < lo || x > hi) return what;
    next[k] = Math.round(x);
    return null;
  };
  const bad = num('firstMins', 1, 1440, 'The first-response time is between 1 minute and 24 hours.')
    || num('escalateMins', 2, 2880, 'The escalation time is between 2 minutes and 48 hours.')
    || num('burstMins', 0, 30, 'Combine alerts within 0 to 30 minutes.');
  if (bad) return { error: bad };
  if (next.escalateMins <= next.firstMins) return { error: 'Escalation has to come after the first-response time.' };
  ['on', 'emailOffice', 'officeHoursOnly'].forEach(k => { if (b[k] !== undefined) next[k] = !!b[k]; });
  if (b.from !== undefined) { if (!HHMM.test(String(b.from))) return { error: 'Office opens at a time like 09:30.' }; next.from = String(b.from); }
  if (b.to !== undefined) { if (!HHMM.test(String(b.to))) return { error: 'Office closes at a time like 19:30.' }; next.to = String(b.to); }
  if (next.from >= next.to) return { error: 'The office has to open before it closes.' };
  if (b.days !== undefined) {
    const d = (Array.isArray(b.days) ? b.days : String(b.days).split(',')).map(Number).filter(x => Number.isInteger(x) && x >= 0 && x <= 6);
    if (!d.length) return { error: 'Pick at least one office day.' };
    next.days = d.filter((x, i, a) => a.indexOf(x) === i).sort();
  }
  return { settings: clean(next) };
}

/* ------------------------------------------------------------ office minutes */

const hm = s => { const m = HHMM.exec(s); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };

/** Milliseconds between a and b that fall inside office hours (IST). */
function officeMs(a, b, S) {
  if (!(b > a)) return 0;
  const off = IST * 60000, D = 864e5;
  let day = Math.floor((a + off) / D);                 // IST day number
  const last = Math.floor((b + off) / D);
  const open = hm(S.from) * 60000, close = hm(S.to) * 60000;
  let total = 0;
  for (; day <= last && day - Math.floor((a + off) / D) < 400; day++) {
    const start = day * D - off;                       // IST midnight, in UTC ms
    const wd = new Date(start + off).getUTCDay();
    if (!S.days.includes(wd)) continue;
    const lo = Math.max(a, start + open), hi = Math.min(b, start + close);
    if (hi > lo) total += hi - lo;
  }
  return total;
}

function inOffice(t, S) {
  const off = IST * 60000;
  const d = new Date(t + off);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return S.days.includes(d.getUTCDay()) && mins >= hm(S.from) && mins < hm(S.to);
}

/* ------------------------------------------------------------------- shapes */

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** How a lead reached us: form, chat, booking, finder or logged by staff. */
function channelOf(e, booked) {
  if (!e) return 'form';
  if (String(e.consent || '') === 'chat') return 'chat';
  if (String(e.consent || '') === 'staff') return 'staff';
  if ((booked && booked.has(Number(e.id))) || /^Call booked for /.test(String(e.note || ''))) return 'booking';
  if (String(e.source || '') === 'no-match') return 'finder';
  return 'form';
}
const CHANNEL_LABEL = {
  form: 'enquiry form', chat: 'website chat', 'chat-msg': 'chat message', booking: 'booked call',
  finder: 'finder (no match)', staff: 'logged by staff',
};

/* A note that is somebody in the office answering. The website's own
   "enquired again" line and "added by hand" are not. */
/* Patch 241: handing a lead to somebody is not answering it — a change note
   counts only when it moved the lead's status. */
const isTouch = n => String(n.who || '') !== 'website' && !['enquiry', 'added'].includes(String(n.kind || ''))
  && !(String(n.kind || '') === 'change' && !/Moved to /.test(String(n.body || '')));

function open({ db, live, push, mail, emails, siteUrl, log }) {
  const say = log || console;
  const site = siteUrl || '';
  let timer = null;

  const settings = () => { let s = null; try { s = db.content(KEY_SETTINGS); } catch (e) { s = null; } return clean(s); };
  const save = (b, who) => {
    const v = validate(settings(), b || {});
    if (v.error) return v;
    db.setContent(KEY_SETTINGS, v.settings, who || 'system');
    return v;
  };

  /** Minutes on the clock between an ISO time and now (office-hours aware). */
  const waitMins = (fromIso, now, S) => {
    const a = new Date(fromIso).getTime();
    if (!Number.isFinite(a)) return 0;
    const b = now == null ? Date.now() : now;
    const ms = (S || settings()).officeHoursOnly ? officeMs(a, b, S || settings()) : Math.max(0, b - a);
    return Math.floor(ms / MIN);
  };

  /* --------------------------------------------------------------- who */
  const active = p => p && (p.status || 'active') === 'active';
  function team() {
    const seen = new Map();
    (db.activeCaseworkers() || []).forEach(p => seen.set(Number(p.id), p));
    (db.staffByRole('admin') || []).filter(active).forEach(p => seen.set(Number(p.id), p));
    return [...seen.values()];
  }
  const admins = () => (db.staffByRole('admin') || []).filter(active);
  /** Everybody who may see this lead: its owner and the administrators, or the
      whole team when nobody owns it (the Leads book's own rule). */
  function audience(e) {
    if (e && e.owner_id) {
      const out = new Map(admins().map(a => [Number(a.id), a]));
      const o = db.studentById(Number(e.owner_id));
      if (active(o)) out.set(Number(o.id), o);
      return [...out.values()];
    }
    return team();
  }

  /* ------------------------------------------------------------- the log */
  let seq = 0;
  function readLog() { let l = null; try { l = db.content(KEY_LOG); } catch (e) { l = null; } return Array.isArray(l) ? l : []; }
  function record(entry) {
    const list = readLog();
    seq = Math.max(seq, list.length ? Number(list[0].n || 0) : 0) + 1;
    const row = Object.assign({ n: seq, at: new Date().toISOString() }, entry);
    list.unshift(row);
    try { db.setContent(KEY_LOG, list.slice(0, LOG_MAX), 'system'); } catch (e) { /* the alert still went */ }
    return row;
  }

  /* ------------------------------------------------------------ sending */
  function pushTo(ids, payload) {
    if (!push) return [];
    const tried = [];
    ids.forEach(id => {
      tried.push(Number(id));
      try { Promise.resolve(push.toPerson(Number(id), payload)).catch(() => {}); } catch (e) { /* never fatal */ }
    });
    return tried;
  }
  function liveTo(people, data) {
    if (!live) return;
    try {
      if (!people) live.toAllStaff('lead', data);
      else people.forEach(p => live.toStaff(Number(p.id), 'lead', data));
    } catch (e) { /* a closed socket is not a lost lead */ }
  }
  function emailTo(to, subject, lines, link) {
    if (!mail || !to) return false;
    const html = (emails && emails.shell ? emails.shell : (t, b) => '<h1>' + esc(t) + '</h1>' + b)(subject,
      '<ul style="padding-left:18px;margin:0 0 14px;font:400 14px/1.6 Helvetica,Arial,sans-serif;color:#0e1a24">'
      + lines.map(l => '<li>' + esc(l) + '</li>').join('') + '</ul>'
      + '<p style="margin:18px 0"><a href="' + esc(link) + '" style="display:inline-block;background:#1a4fb4;color:#fff;font:700 14px/1 Helvetica,Arial,sans-serif;text-decoration:none;padding:13px 20px;border-radius:10px">Open the Leads command centre</a></p>');
    try {
      Promise.resolve(mail.send({ to, subject, text: lines.join('\n') + '\n\n' + link, html })).catch(() => {});
      return true;
    } catch (e) { return false; }
  }

  const first = n => String(n || 'Somebody').trim().split(/\s+/)[0];
  const destOf = e => String((e && e.destination) || '').trim();
  const contactOf = e => String((e && (e.phone || e.email)) || '');
  const leadUrl = id => site + '/leads?lead=' + id;

  /* ------------------------------------------------------- 1. arrivals */
  let windowUntil = 0, pending = [], flushTimer = null;

  function deliver(list, logged) {
    const S = settings();
    /* One line per lead: a chat started and three messages from the same
       person in one window are one person waiting. */
    const by = new Map();
    list.forEach(ev => {
      const k = ev.leadId ? 'l' + ev.leadId : 'c' + (ev.chatId || Math.random());
      const was = by.get(k);
      if (!was) by.set(k, Object.assign({ count: 1 }, ev));
      else { was.count++; if (ev.text) was.text = ev.text; }
    });
    const evs = [...by.values()];
    const perPerson = new Map();
    evs.forEach(ev => audience(ev.row).forEach(p => {
      if (!perPerson.has(Number(p.id))) perPerson.set(Number(p.id), []);
      perPerson.get(Number(p.id)).push(ev);
    }));
    const pushedBy = new Map();
    perPerson.forEach((mine, id) => {
      let payload;
      if (mine.length === 1) {
        const ev = mine[0];
        const ch = CHANNEL_LABEL[ev.kind] || ev.kind;
        payload = ev.kind === 'chat-msg'
          ? { title: (ev.name || 'A visitor') + ' wrote in website chat',
              body: '“' + String(ev.text || '').slice(0, 110) + '” — tap to reply' + (ev.count > 1 ? ' (' + ev.count + ' messages)' : ''),
              url: ev.leadId ? leadUrl(ev.leadId) : site + '/chat', tag: 'lead-' + (ev.leadId || ev.chatId) }
          : { title: 'New lead: ' + (ev.name || 'Somebody') + ' (' + ch + ')',
              body: [destOf(ev.row) || 'Destination not given', contactOf(ev.row)].filter(Boolean).join(' · ') + ' — tap to call',
              url: ev.leadId ? leadUrl(ev.leadId) : site + '/leads-command', tag: 'lead-' + (ev.leadId || ev.chatId) };
      } else {
        payload = { title: mine.length + ' new leads waiting',
          body: mine.slice(0, 4).map(ev => first(ev.name) + ' (' + (CHANNEL_LABEL[ev.kind] || ev.kind) + (destOf(ev.row) ? ', ' + destOf(ev.row) : '') + ')').join(' · ')
            + (mine.length > 4 ? ' and ' + (mine.length - 4) + ' more' : '') + ' — tap to call',
          url: site + '/leads-command', tag: 'lead-burst' };
      }
      pushTo([id], payload);
      mine.forEach(ev => { const k = ev.leadId || ev.chatId; if (!pushedBy.has(k)) pushedBy.set(k, []); pushedBy.get(k).push(id); });
    });
    /* The office's email — for chats. Forms and bookings already had theirs. */
    const chats = evs.filter(ev => ev.kind === 'chat' || ev.kind === 'chat-msg');
    let emailed = false;
    if (S.emailOffice && chats.length && mail && mail.office) {
      emailed = emailTo(mail.office,
        chats.length === 1 ? 'Website chat: ' + (chats[0].name || 'a visitor') + ' is waiting' : chats.length + ' website chats waiting',
        chats.map(ev => (ev.name || 'A visitor') + ' — ' + (ev.kind === 'chat' ? 'started a chat' : 'wrote: “' + String(ev.text || '').slice(0, 160) + '”')
          + (contactOf(ev.row) ? ' · ' + contactOf(ev.row) : '')),
        site + '/leads-command');
    }
    if (logged) {
      /* Already in the feed since it arrived; now say who was told. */
      const list2 = readLog();
      list.forEach(ev => {
        const row = list2.find(r => r.n === ev.logN);
        if (row) { row.pushed = pushedBy.get(ev.leadId || ev.chatId) || []; row.combined = list.length > 1; row.pending = false;
          row.emailed = emailed && (ev.kind === 'chat' || ev.kind === 'chat-msg'); }
      });
      try { db.setContent(KEY_LOG, list2, 'system'); } catch (e) {}
      /* The arrivals past FEED_EACH, as one line (see arrived). */
      const rest = evs.filter(ev => !list.some(x => x.logN && (x.leadId || x.chatId) === (ev.leadId || ev.chatId)));
      if (rest.length) {
        const kinds = [...new Set(rest.map(ev => CHANNEL_LABEL[ev.kind] || ev.kind))].join(', ');
        record({ kind: rest.length === 1 ? rest[0].kind : 'form', leadId: rest.length === 1 ? rest[0].leadId : null, chatId: rest.length === 1 ? rest[0].chatId : null,
          name: rest.length === 1 ? rest[0].name : rest.length + ' more leads', count: rest.length, combined: true,
          text: rest.length === 1 ? '' : rest.slice(0, 4).map(ev => first(ev.name)).join(', ') + ' and ' + Math.max(0, rest.length - 4) + ' more (' + kinds + ')',
          pushed: [...new Set(rest.flatMap(ev => pushedBy.get(ev.leadId || ev.chatId) || []))], emailed: emailed && rest.some(ev => ev.kind === 'chat' || ev.kind === 'chat-msg') });
      }
      return;
    }
    evs.forEach(ev => {
      const k = ev.leadId || ev.chatId;
      record({ kind: ev.kind, leadId: ev.leadId || null, chatId: ev.chatId || null, name: ev.name || '',
        destination: destOf(ev.row), ownerId: ev.row && ev.row.owner_id ? Number(ev.row.owner_id) : null,
        text: ev.kind === 'chat-msg' ? String(ev.text || '').slice(0, 160) : '',
        count: ev.count, pushed: pushedBy.get(k) || [], emailed: emailed && (ev.kind === 'chat' || ev.kind === 'chat-msg'),
        combined: list.length > 1 });
    });
  }

  function flush() {
    flushTimer = null;
    const list = pending; pending = [];
    if (!list.length) return;
    windowUntil = Date.now() + settings().burstMins * MIN;
    try { deliver(list, true); } catch (e) { say.error && say.error('  [leads] alert failed: ' + (e && e.message)); }
  }

  /**
   * A lead arrived. `row` is the enquiries row it lives on (fileEnquiry's
   * answer), `kind` one of form | booking | finder | chat | chat-msg.
   */
  function arrived({ kind, row, chatId, name, text, quiet }) {
    try {
      const S = settings();
      let internal = false;
      try { internal = row ? db.internalEnquiryTest()(row) : false; } catch (e) { internal = false; }
      const k = kind || channelOf(row);
      const ev = { kind: k, row: row || null, leadId: row && row.id ? Number(row.id) : null, chatId: chatId || null,
        name: name || (row && row.name) || '', text: text || '', at: new Date().toISOString(),
        returning: !!(row && row.attached) };
      /* The screens hear about everything, at once — that is what keeps the
         queue on the command centre honest. Scoped like the book: an owned
         lead goes to its owner and the administrators. */
      liveTo(row && row.owner_id ? audience(row) : null, {
        kind: k, leadId: ev.leadId, chatId: ev.chatId, name: ev.name, destination: destOf(row),
        channel: CHANNEL_LABEL[k] || k, text: String(ev.text).slice(0, 160), at: ev.at, returning: ev.returning, internal,
      });
      /* The office's own test enquiries raise no alert (round 175). */
      if (internal || quiet || !S.on) return { queued: false };
      if (!pending.length && Date.now() >= windowUntil) {
        windowUntil = Date.now() + S.burstMins * MIN;
        deliver([ev]);
        return { queued: false, sent: true };
      }
      /* In the feed now; the combined push follows when the window closes.
         Go-live spam test (3 Nov): past FEED_EACH arrivals in one window the
         rest are not written one by one — the feed keeps 150 lines and a
         flood of three hundred would push every real arrival out of it. They
         go in as one "N new leads" line when the window closes (deliver). */
      if (pending.length < FEED_EACH) {
        ev.logN = record({ kind: ev.kind, leadId: ev.leadId, chatId: ev.chatId, name: ev.name, destination: destOf(row),
          ownerId: row && row.owner_id ? Number(row.owner_id) : null, text: ev.kind === 'chat-msg' ? String(ev.text || '').slice(0, 160) : '',
          count: 1, pushed: [], emailed: false, pending: true }).n;
      }
      pending.push(ev);
      if (!flushTimer) {
        flushTimer = setTimeout(flush, Math.max(0, windowUntil - Date.now()));
        if (flushTimer.unref) flushTimer.unref();
      }
      return { queued: true };
    } catch (e) {
      say.error && say.error('  [leads] arrival alert failed: ' + (e && e.message));
      return { queued: false };
    }
  }

  /** Somebody answered — every screen takes it off the queue. */
  function responded(row, who, how) {
    if (!row) return;
    liveTo(null, { kind: 'responded', leadId: Number(row.id), name: row.name || '', by: who || '', how: how || '', at: new Date().toISOString() });
    record({ kind: 'responded', leadId: Number(row.id), name: row.name || '', by: who || '', how: how || '',
      ownerId: row.owner_id ? Number(row.owner_id) : null, pushed: [] });
  }

  /* ------------------------------------------------------ 2. escalation */
  function readState() { let s = null; try { s = db.content(KEY_STATE); } catch (e) { s = null; } return s && typeof s === 'object' ? { first: s.first || {}, esc: s.esc || {}, mailed: s.mailed || {}, mailAt: s.mailAt || '', seeded: s.seeded || '' } : { first: {}, esc: {}, mailed: {}, mailAt: '', seeded: '' }; }
  /* Go-live spam test (3 Nov): one escalation EMAIL per administrator per
     ESC_MAIL_GAP minutes at most. A drip of spam — one made-up lead a
     minute from rotating addresses — escalated one at a time, and each sweep
     emailed every administrator: sixty emails an hour, all day. The pushes
     still go each sweep (one, combined, replacing itself on the lock screen);
     the email waits and then names everything escalated since the last one. */
  const ESC_MAIL_GAP = 10;

  /** Leads still waiting for anybody to answer: new, no touch, not internal,
      not logged by staff (somebody is already holding those). */
  function waitingLeads(now) {
    const touched = new Set();
    (db.allLeadNotes ? db.allLeadNotes() : []).forEach(n => { if (isTouch(n)) touched.add(Number(n.lead_id)); });
    const counts = db.leadNoteCounts();
    const internal = db.internalEnquiryTest();
    return db.allEnquiries().filter(e => (e.status || 'new') === 'new' && String(e.consent || '') !== 'staff'
      && !touched.has(Number(e.id)) && !((counts[String(e.id)] || {}).n) && !internal(e));
  }

  function sweep(nowArg) {
    const now = nowArg || Date.now();
    const S = settings();
    if (!S.on) return { first: [], escalated: [] };
    const state = readState();
    const waiting = waitingLeads(now).filter(e => now - new Date(e.created_at).getTime() < MAX_AGE_DAYS * 864e5);
    const ids = new Set(waiting.map(e => String(e.id)));
    /* What resolved is forgotten; what is still waiting keeps its stamps. */
    Object.keys(state.first).forEach(k => { if (!ids.has(k)) delete state.first[k]; });
    Object.keys(state.esc).forEach(k => { if (!ids.has(k)) delete state.esc[k]; });
    Object.keys(state.mailed).forEach(k => { if (!ids.has(k)) delete state.mailed[k]; });
    const stamp = new Date(now).toISOString();
    if (!state.seeded) {
      waiting.forEach(e => {
        const m = waitMins(e.created_at, now, S);
        if (m >= S.firstMins) state.first[e.id] = stamp;
        if (m >= S.escalateMins) state.esc[e.id] = stamp;
      });
      state.seeded = stamp;
      db.setContent(KEY_STATE, state, 'system');
      return { first: [], escalated: [], seeded: true };
    }
    const firstList = [], escList = [];
    if (!S.officeHoursOnly || inOffice(now, S)) {
      waiting.forEach(e => {
        const m = waitMins(e.created_at, now, S);
        if (m >= S.escalateMins && !state.esc[e.id]) { escList.push({ e, m }); state.esc[e.id] = stamp; state.first[e.id] = state.first[e.id] || stamp; }
        else if (m >= S.firstMins && !state.first[e.id]) { firstList.push({ e, m }); state.first[e.id] = stamp; }
      });
    }
    /* Marked BEFORE sent (sla.js's rule). */
    db.setContent(KEY_STATE, state, 'system');

    if (firstList.length) {
      const perPerson = new Map();
      firstList.forEach(x => audience(x.e).forEach(p => {
        if (!perPerson.has(Number(p.id))) perPerson.set(Number(p.id), []);
        perPerson.get(Number(p.id)).push(x);
      }));
      const pushed = new Map();
      perPerson.forEach((mine, id) => {
        const x = mine[0];
        pushTo([id], mine.length === 1
          ? { title: 'Nobody has called ' + first(x.e.name) + ' yet — ' + x.m + ' min',
              body: [CHANNEL_LABEL[channelOf(x.e)], destOf(x.e), contactOf(x.e)].filter(Boolean).join(' · ') + ' — tap to call',
              url: leadUrl(x.e.id), tag: 'lead-' + x.e.id }
          : { title: mine.length + ' leads nobody has called',
              body: mine.slice(0, 4).map(y => first(y.e.name) + ' ' + y.m + ' min').join(' · ') + ' — tap to call',
              url: site + '/leads-command', tag: 'lead-overdue' });
        mine.forEach(y => { if (!pushed.has(y.e.id)) pushed.set(y.e.id, []); pushed.get(y.e.id).push(id); });
      });
      firstList.forEach(x => {
        liveTo(x.e.owner_id ? audience(x.e) : null, { kind: 'overdue', leadId: Number(x.e.id), name: x.e.name, minutes: x.m,
          destination: destOf(x.e), channel: CHANNEL_LABEL[channelOf(x.e)], at: stamp });
      });
      /* Go-live spam test (3 Nov): a flood is one line in the feed, not three
         hundred — the feed keeps 150 lines, and three hundred "nobody has
         called" rows pushed every real arrival out of it. Up to FEED_EACH
         leads are written one by one; more than that is one combined line. */
      if (firstList.length <= FEED_EACH) {
        firstList.forEach(x => record({ kind: 'overdue', leadId: Number(x.e.id), name: x.e.name || '', minutes: x.m, destination: destOf(x.e),
          ownerId: x.e.owner_id ? Number(x.e.owner_id) : null, pushed: pushed.get(x.e.id) || [] }));
      } else {
        record({ kind: 'overdue', leadId: null, name: firstList.length + ' leads', count: firstList.length,
          minutes: Math.max(...firstList.map(x => x.m)), text: firstList.slice(0, 4).map(x => first(x.e.name)).join(', ') + ' and ' + (firstList.length - Math.min(4, firstList.length)) + ' more',
          pushed: [...new Set([...pushed.values()].flat())], combined: true });
      }
    }
    /* The escalation email: everything escalated and not yet emailed — this
       sweep's and any held back since the last email — in one message, when
       ESC_MAIL_GAP has passed since the last one. Marked before sent, like
       the rest of this file. Runs whether or not anything escalated THIS
       sweep, so leads held back are not forgotten. */
    let escMailed = null;
    const escMail = () => {
      if (escMailed != null) return escMailed;
      escMailed = false;
      if (!S.emailOffice) return false;
      const lastMail = state.mailAt ? new Date(state.mailAt).getTime() : 0;
      if (now - lastMail < ESC_MAIL_GAP * MIN) return false;
      const due = waiting.filter(e => state.esc[e.id] && !state.mailed[e.id]);
      if (!due.length) return false;
      const lines = due.map(e => (e.name || 'Somebody') + ' — waited ' + waitMins(e.created_at, now, S) + ' min, nobody has called · '
        + [CHANNEL_LABEL[channelOf(e)], destOf(e), contactOf(e)].filter(Boolean).join(' · '));
      const subject = due.length === 1 ? 'Escalation: nobody has called ' + (due[0].name || 'a lead') + ' in ' + waitMins(due[0].created_at, now, S) + ' min'
        : 'Escalation: ' + due.length + ' leads nobody has called';
      due.forEach(e => { state.mailed[e.id] = stamp; });
      state.mailAt = stamp;
      db.setContent(KEY_STATE, state, 'system');
      admins().filter(a => a.email).forEach(a => { escMailed = emailTo(a.email, subject, lines, site + '/leads-command') || escMailed; });
      return escMailed;
    };
    if (!escList.length) escMail();
    if (escList.length) {
      const to = admins();
      const ids2 = to.map(a => Number(a.id));
      const x = escList[0];
      pushTo(ids2, escList.length === 1
        ? { title: 'Escalation: ' + (x.e.name || 'a lead') + ' has waited ' + x.m + ' min',
            body: 'No call, no reply. ' + [CHANNEL_LABEL[channelOf(x.e)], destOf(x.e), contactOf(x.e)].filter(Boolean).join(' · ') + ' — tap to call',
            url: leadUrl(x.e.id), tag: 'lead-esc-' + x.e.id }
        : { title: 'Escalation: ' + escList.length + ' leads past ' + S.escalateMins + ' min',
            body: escList.slice(0, 4).map(y => first(y.e.name) + ' ' + y.m + ' min').join(' · ') + ' — nobody has called',
            url: site + '/leads-command', tag: 'lead-esc' });
      const emailed = escMail();
      escList.forEach(y => {
        liveTo(null, { kind: 'escalated', leadId: Number(y.e.id), name: y.e.name, minutes: y.m, destination: destOf(y.e), at: stamp });
      });
      if (escList.length <= FEED_EACH) {
        escList.forEach(y => record({ kind: 'escalated', leadId: Number(y.e.id), name: y.e.name || '', minutes: y.m, destination: destOf(y.e),
          ownerId: y.e.owner_id ? Number(y.e.owner_id) : null, pushed: ids2, emailed }));
      } else {
        record({ kind: 'escalated', leadId: null, name: escList.length + ' leads', count: escList.length,
          minutes: Math.max(...escList.map(y => y.m)), text: escList.slice(0, 4).map(y => first(y.e.name)).join(', ') + ' and ' + (escList.length - Math.min(4, escList.length)) + ' more',
          pushed: ids2, emailed, combined: true });
      }
      try { db.log('system', 'lead escalated', escList.map(y => (y.e.name || '#' + y.e.id) + ' ' + y.m + ' min').join(', ')); } catch (e) {}
    }
    return { first: firstList.map(x => x.e.id), escalated: escList.map(x => x.e.id) };
  }

  function start() {
    if (timer) return stop;
    const run = () => { try { sweep(); } catch (e) { say.error && say.error('  [leads] sweep failed: ' + (e && e.message)); } };
    timer = setInterval(run, TICK);
    if (timer.unref) timer.unref();
    setTimeout(run, Math.min(TICK, 3000)).unref();
    return stop;
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  return {
    settings, save, defaults: Object.assign({}, DEFAULTS), minuteMs: MIN,
    waitMins, arrived, responded, sweep, start, stop, team, audience,
    log: readLog, channelOf, CHANNEL_LABEL, isTouch,
    officeOpen: now => inOffice(now || Date.now(), settings()),
  };
}

module.exports = { open, clean, validate, officeMs, inOffice, channelOf, CHANNEL_LABEL, isTouch, DEFAULTS };
