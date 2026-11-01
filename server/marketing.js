'use strict';
/*
 * Patch 204: MARKETING — where every student came from, and what it cost.
 *
 * "We should have an additional marketing role where Google traffic, Insta
 *  traffic, Facebook and other campaigns traffic is monitored. Every click
 *  and opening, if we can capture across different countries … SEOs,
 *  keywords, trending topics … a proper marketing dashboard connected with
 *  different channels to monitor at one place." — Vishal, 1 Nov
 *
 * Three things the page-view log (traffic.js) could not say:
 *
 *  1. WHICH VISIT BECAME A LEAD, A SIGN-UP, A PAYMENT. A visitor's first
 *     arrival — the channel, the campaign, the page they landed on, their
 *     country — is written into one small first-party cookie (`gl_ft`, signed,
 *     90 days, no name and no address in it). A later ad click replaces it,
 *     because the campaign that brought them back is the one being paid for.
 *     When an enquiry, an account or an order is created on a request that
 *     carries it, the touch is copied onto that record (the `attribution`
 *     table). That is what turns "Instagram sent 400 visitors" into
 *     "Instagram sent 400 visitors, 22 leads, 3 paying students, ₹54,000".
 *
 *  2. EVERY CLICK. A beacon on the public pages sends one line per click on a
 *     link or button — WhatsApp, call, sign-up, a package, an outbound link —
 *     and one "engaged" line when somebody stays and reads (15 s visible).
 *
 *  3. WHAT IT COST. Ad spend, typed in per month and channel (or pulled from
 *     Meta when that is connected), so the board can say cost per lead, cost
 *     per paying student and return on ad spend.
 *
 * Nothing here can identify a person: the visitor key is the same daily hash
 * traffic.js uses, and the cookie carries a channel, not a person.
 */
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

const COOKIE = 'gl_ft';
const COOKIE_DAYS = 90;
const KEEP_DAYS = 180;

/* The touch for the request being handled, set by the API dispatcher, read by
   the store when it creates an enquiry, an account or an order. */
const ctx = new AsyncLocalStorage();

/** The channel a hit or a touch belongs to, as a person would name it. */
function channelOf(t) {
  const site = String(t.site || '').trim();
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  switch (t.source) {
    case 'ads': return { channel: (cap(site) || 'Paid') + ' Ads', group: 'paid' };
    case 'search': return { channel: (site || 'Search') + ' search', group: 'search' };
    case 'social': return { channel: site || 'Social', group: 'social' };
    case 'ai': return { channel: (site || 'AI') + ' (AI)', group: 'ai' };
    case 'campaign': return { channel: 'Campaign · ' + (cap(site) || 'tagged'), group: 'campaign' };
    case 'referral': return { channel: site || 'Other websites', group: 'referral' };
    default: return { channel: 'Direct', group: 'direct' };
  }
}

const b64 = s => Buffer.from(s).toString('base64url');
const unb64 = s => { try { return Buffer.from(String(s), 'base64url').toString('utf8'); } catch (e) { return ''; } };

function cookieOf(req, name) {
  const raw = String((req && req.headers && req.headers.cookie) || '');
  const m = raw.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : '';
}

function open({ db, fx, log = console }) {
  let secret = '';
  try {
    const t = db.content('traffic') || {};
    if (!t.salt) { t.salt = crypto.randomBytes(16).toString('hex'); db.setContent('traffic', t, 'system'); }
    secret = t.salt;
  } catch (e) { secret = crypto.randomBytes(16).toString('hex'); }
  const sign = v => crypto.createHmac('sha256', secret + '|ft').update(v).digest('base64url').slice(0, 12);

  /** The touch a request carries, or null. Forged or broken cookies are null. */
  function touchOf(req) {
    const raw = cookieOf(req, COOKIE);
    if (!raw) return null;
    const [body, sig] = raw.split('.');
    if (!body || !sig || sign(body) !== sig) return null;
    try {
      const t = JSON.parse(unb64(body));
      return t && typeof t === 'object' ? t : null;
    } catch (e) { return null; }
  }

  /**
   * After a public page is recorded: the Set-Cookie value to send, or ''.
   * Written on the first visit, and replaced when a paid or tagged campaign
   * brings the same browser back.
   */
  /* EU / EEA / UK / Switzerland: a cookie that is not strictly necessary
     needs consent there (TTDSG §25, ePrivacy), and the site asks for none —
     so no attribution cookie. Their visits, clicks and searches are still
     counted; only the link from visit to lead is not made. */
  const CONSENT_FIRST = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV',
    'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH']);
  function cookieFor(req, row) {
    if (!row || row.kind !== 'page') return '';
    if (CONSENT_FIRST.has(String(row.country || '').toUpperCase())) return '';
    const had = touchOf(req);
    const paid = row.source === 'ads' || row.source === 'campaign' || !!row.campaign;
    if (had && !paid) return '';
    const t = {
      s: row.source || 'direct', w: row.site || '', c: row.campaign || '', m: row.medium || '',
      l: String(row.path || '/').slice(0, 120), g: row.country || '', d: row.day,
    };
    const body = b64(JSON.stringify(t));
    const secure = /https/i.test(String(req.headers['x-forwarded-proto'] || '')) ? '; Secure' : '';
    return COOKIE + '=' + body + '.' + sign(body) + '; Path=/; Max-Age=' + (COOKIE_DAYS * 86400) + '; SameSite=Lax; HttpOnly' + secure;
  }

  /** Run `fn` with this request's touch in reach of the store. */
  function within(req, fn) {
    const t = touchOf(req);
    return t ? ctx.run(t, fn) : fn();
  }

  /** Called by the store when it creates a record: copy the touch onto it. */
  function stamp(subject, id) {
    const t = ctx.getStore();
    if (!t || id == null) return;
    try { db.addAttribution(subject, id, t); } catch (e) { log.error('  marketing ✗ stamp ' + (e && e.message)); }
  }

  /** The same daily visitor key traffic.js writes on a page view. */
  function visitorOf(req) {
    const ua = String(req.headers['user-agent'] || '');
    const ip = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim()
      || (req.socket && req.socket.remoteAddress) || '';
    const day = new Date().toISOString().slice(0, 10);
    return crypto.createHmac('sha256', secret).update(ip + '|' + ua + '|' + day).digest('hex').slice(0, 16);
  }

  /* ----------------------------------------------------------- searches */
  const recentSearch = new Map();
  let lastSearchPrune = '';
  /** One search run on the site, with how many it found. Repeats of the same
      search by the same visitor within ten minutes count once. */
  function search(req, x, country) {
    try {
      const visitor = visitorOf(req);
      const sig = visitor + '|' + x.kind + '|' + [x.q, x.dest, x.level, x.field, x.filters].join('|').toLowerCase();
      const at = Date.now();
      const prevAt = recentSearch.get(sig);
      recentSearch.set(sig, at);
      if (recentSearch.size > 20000) recentSearch.clear();
      if (prevAt && at - prevAt < 600000) return;
      if (!x.q && !x.dest && !x.level && !x.field && !x.filters) return;
      const t = touchOf(req) || {};
      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      db.addSearch(Object.assign({}, x, {
        day, ts: now.toISOString(), visitor,
        q: String(x.q || '').trim().slice(0, 80), dest: String(x.dest || '').slice(0, 40),
        level: String(x.level || '').slice(0, 40), field: String(x.field || '').slice(0, 80),
        filters: String(x.filters || '').slice(0, 300),
        country: country || t.g || '', channel: channelOf({ source: t.s, site: t.w }).channel,
      }));
      if (day !== lastSearchPrune) {
        lastSearchPrune = day;
        db.pruneSearches(new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString().slice(0, 10));
      }
    } catch (e) { log.error('  marketing ✗ search ' + (e && e.message)); }
  }

  /* ------------------------------------------------------------- events */
  const NAMES = /^[a-z][a-z0-9_]{0,39}$/;
  const perMinute = new Map();
  let lastPrune = '';
  /** One click or "engaged" line from the page beacon. */
  function event(req, b, visitor, country, device) {
    const name = String((b && b.n) || '').toLowerCase();
    if (!NAMES.test(name)) return false;
    const minute = Math.floor(Date.now() / 60000);
    const key = visitor + '|' + minute;
    const n = (perMinute.get(key) || 0) + 1;
    perMinute.set(key, n);
    if (perMinute.size > 5000) perMinute.clear();
    if (n > 60) return false;
    const t = touchOf(req) || {};
    const ch = channelOf({ source: t.s, site: t.w });
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    db.addEvent({
      day, ts: now.toISOString(), visitor,
      path: String((b && b.p) || '/').split('?')[0].slice(0, 160),
      name, label: String((b && b.l) || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      target: String((b && b.t) || '').slice(0, 160),
      channel: ch.channel, campaign: t.c || '', country: country || t.g || '', device: device || '',
    });
    if (day !== lastPrune) {
      lastPrune = day;
      db.pruneEvents(new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString().slice(0, 10));
    }
    return true;
  }

  /* -------------------------------------------------------------- money */
  const inrPerUnit = cur => {
    cur = String(cur || 'INR').toUpperCase();
    if (cur === 'INR') return 1;
    try { const r = fx && fx.marketRate ? fx.marketRate(cur) : 0; if (r > 0) return r; } catch (e) {}
    return ({ EUR: 90, USD: 83, GBP: 105, AED: 22.6, AUD: 55, CAD: 61 })[cur] || 0;
  };
  /* A month's spend, the share of it that falls inside [since, until]. */
  function spendInside(row, since, until) {
    const [y, mo] = String(row.month).split('-').map(Number);
    if (!y || !mo) return 0;
    const first = new Date(Date.UTC(y, mo - 1, 1));
    const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    let inside = 0;
    for (let i = 0; i < days; i++) {
      const d = new Date(first.getTime() + i * 86400000).toISOString().slice(0, 10);
      if (d >= since && d <= until) inside++;
    }
    return (Number(row.amount_minor) / 100) * inrPerUnit(row.currency) * (inside / days);
  }

  /* ------------------------------------------------------------- report */
  const dayAdd = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

  /**
   * The marketing board for the last `days` days (and the same span before,
   * for the change arrows). `f.country` and `f.channel` narrow everything.
   */
  function report(days, f) {
    days = Math.max(1, Math.min(180, Number(days) || 30));
    f = f || {};
    const until = new Date().toISOString().slice(0, 10);
    const since = dayAdd(until, -(days - 1));
    const prevSince = dayAdd(since, -days);
    const prevUntil = dayAdd(since, -1);

    const wantC = String(f.country || '').toUpperCase();
    const wantCh = String(f.channel || '');
    const keep = (country, channel) => (!wantC || country === wantC) && (!wantCh || channel === wantCh);

    const hits = db.hitsSince(prevSince).filter(h => h.kind === 'page');
    const events = db.eventsSince(prevSince);
    const attr = db.attributionAll();
    const attrOf = {};
    attr.forEach(a => { attrOf[a.subject + ':' + a.subject_id] = a; });

    const blank = () => ({ visitors: new Set(), views: 0, engaged: new Set(), clicks: 0, ctas: new Set(),
      leads: 0, signups: 0, payers: new Set(), revenue: 0, spend: 0 });
    const cur = blank(), prev = blank();
    const by = { channel: {}, country: {}, campaign: {}, landing: {}, device: {} };
    const row = (map, k, extra) => map[k] || (map[k] = Object.assign(blank(), extra || {}));
    const byDay = {};
    for (let i = 0; i < days; i++) { const d = dayAdd(since, i); byDay[d] = { day: d, visitors: new Set(), leads: 0, signups: 0, paid: 0, clicks: 0 }; }

    /* Visits. */
    hits.forEach(h => {
      const ch = channelOf(h);
      const country = h.country || '';
      if (!keep(country, ch.channel)) return;
      const inNow = h.day >= since;
      const T = inNow ? cur : prev;
      T.visitors.add(h.visitor); T.views++;
      if (!inNow) return;
      byDay[h.day] && byDay[h.day].visitors.add(h.visitor);
      const c = row(by.channel, ch.channel, { group: ch.group }); c.visitors.add(h.visitor); c.views++;
      const k = row(by.country, country || '??'); k.visitors.add(h.visitor); k.views++;
      if (h.campaign) { const g = row(by.campaign, h.campaign, { channel: ch.channel }); g.visitors.add(h.visitor); g.views++; }
      const l = row(by.landing, h.path); l.visitors.add(h.visitor); l.views++;
      const dv = row(by.device, h.device || 'desktop'); dv.visitors.add(h.visitor);
    });

    /* Clicks and engagement. */
    const CTA = new Set(['whatsapp', 'call', 'email', 'signup', 'package', 'cta', 'apply', 'enquire', 'begin_checkout', 'generate_lead']);
    const clicksBy = {}, kinds = {};
    events.forEach(e => {
      if (!keep(e.country || '', e.channel)) return;
      const inNow = e.day >= since;
      const T = inNow ? cur : prev;
      if (e.name === 'engaged') { T.engaged.add(e.visitor); }
      else { T.clicks++; if (CTA.has(e.name)) T.ctas.add(e.visitor); }
      if (!inNow) return;
      if (byDay[e.day] && e.name !== 'engaged') byDay[e.day].clicks++;
      const c = row(by.channel, e.channel, { group: channelOf({ source: '' }).group });
      if (e.name === 'engaged') c.engaged.add(e.visitor); else c.clicks++;
      const k = row(by.country, e.country || '??');
      if (e.name === 'engaged') k.engaged.add(e.visitor); else k.clicks++;
      if (e.name !== 'engaged') {
        const key = e.name + '|' + (e.label || e.target || '');
        const x = clicksBy[key] || (clicksBy[key] = { name: e.name, label: e.label || e.target || '', target: e.target, count: 0, visitors: new Set(), pages: {} });
        x.count++; x.visitors.add(e.visitor); x.pages[e.path] = (x.pages[e.path] || 0) + 1;
        kinds[e.name] = (kinds[e.name] || 0) + 1;
      }
    });

    /* Leads, sign-ups, payments — each with the touch it was stamped with. */
    const touch = a => a ? Object.assign({ country: a.country || '', landing: a.landing || '', campaign: a.campaign || '' }, channelOf({ source: a.source, site: a.site })) : Object.assign({ country: '', landing: '', campaign: '' }, channelOf({ source: 'direct' }), { channel: 'Not tracked', group: 'none' });
    const put = (when, t, fn) => {
      if (!keep(t.country, t.channel)) return;
      const d = String(when).slice(0, 10);
      if (d < prevSince || d > until) return;
      const inNow = d >= since;
      fn(inNow ? cur : prev, inNow, d);
      if (!inNow) return;
      fn(row(by.channel, t.channel, { group: t.group }), true, d);
      fn(row(by.country, t.country || '??'), true, d);
      if (t.campaign) fn(row(by.campaign, t.campaign, { channel: t.channel }), true, d);
      if (t.landing) fn(row(by.landing, t.landing), true, d);
    };
    const enquiries = (db.allEnquiriesEver || db.allEnquiries)();
    const enqByEmail = {};
    enquiries.forEach(e => {
      const t = touch(attrOf['enquiry:' + e.id]);
      if (e.email) enqByEmail[String(e.email).toLowerCase()] = t;
      put(e.created_at, t, (T, now, d) => { T.leads++; if (now && T === cur && byDay[d]) byDay[d].leads++; });
    });
    const studentT = {};
    db.allStudentsLite().forEach(s => {
      const a = attrOf['student:' + s.id];
      const t = a ? touch(a) : (enqByEmail[String(s.email || '').toLowerCase()] || touch(null));
      studentT[s.id] = t;
      put(s.created_at, t, (T, now, d) => { T.signups++; if (now && T === cur && byDay[d]) byDay[d].signups++; });
    });
    const orders = {};
    db.allOrders().forEach(o => { orders[o.reference] = o; });
    db.allPaymentsLite().forEach(p => {
      const o = orders[p.order_ref] || {};
      const a = attrOf['order:' + o.id];
      const t = a ? touch(a) : studentT[o.student_id || p.student_id]
        || enqByEmail[String(o.email || '').toLowerCase()] || touch(null);
      const who = o.student_id || p.student_id || o.email || p.order_ref;
      const amt = (p.kind === 'refund' ? -1 : 1) * Number(p.paise || 0) / 100;
      put(p.at || p.created_at, t, (T, now, d) => {
        T.revenue += amt;
        if (p.kind !== 'refund') { if (!T.payers.has(who) && now && T === cur && byDay[d]) byDay[d].paid++; T.payers.add(who); }
      });
    });

    /* Spend. */
    const spendRows = db.adSpend();
    spendRows.forEach(s => {
      const ch = s.channel;
      const country = String(s.country || '').toUpperCase();
      if (wantCh && ch !== wantCh) return;
      if (wantC && country && country !== wantC) return;
      cur.spend += spendInside(s, since, until);
      prev.spend += spendInside(s, prevSince, prevUntil);
      const inr = spendInside(s, since, until);
      if (inr > 0) {
        row(by.channel, ch, { group: 'paid' }).spend += inr;
        if (s.campaign) row(by.campaign, s.campaign, { channel: ch }).spend += inr;
        if (country) row(by.country, country).spend += inr;
      }
    });

    const out = T => {
      const v = T.visitors.size, payers = T.payers.size;
      return {
        visitors: v, views: T.views, engaged: T.engaged.size, clicks: T.clicks, ctaVisitors: T.ctas.size,
        leads: T.leads, signups: T.signups, payers, revenue: Math.round(T.revenue), spend: Math.round(T.spend),
        leadRate: v ? +(100 * T.leads / v).toFixed(2) : null,
        payRate: T.leads ? +(100 * payers / T.leads).toFixed(1) : null,
        cpl: T.spend && T.leads ? Math.round(T.spend / T.leads) : null,
        cac: T.spend && payers ? Math.round(T.spend / payers) : null,
        roas: T.spend ? +(T.revenue / T.spend).toFixed(2) : null,
      };
    };
    const list = (map, extra) => Object.entries(map).map(([name, T]) => Object.assign({ name }, extra ? extra(T, name) : {}, out(T)));
    const ISO = require('./countries.js');
    const rank = (a, b) => b.revenue - a.revenue || b.payers - a.payers || b.leads - a.leads || b.visitors - a.visitors;

    return {
      days, since, until, filter: { country: wantC, channel: wantCh },
      totals: out(cur), previous: out(prev),
      byDay: Object.values(byDay).map(d => ({ day: d.day, visitors: d.visitors.size, leads: d.leads, signups: d.signups, paid: d.paid, clicks: d.clicks })),
      funnel: (() => { const t = out(cur); return [
        { key: 'visitors', label: 'Visitors', n: t.visitors },
        { key: 'engaged', label: 'Stayed and read', n: t.engaged },
        { key: 'cta', label: 'Clicked to talk or buy', n: t.ctaVisitors },
        { key: 'leads', label: 'Became a lead', n: t.leads },
        { key: 'signups', label: 'Made an account', n: t.signups },
        { key: 'payers', label: 'Paid', n: t.payers },
      ]; })(),
      channels: list(by.channel, T => ({ group: T.group || 'direct' })).sort(rank),
      countries: list(by.country, (T, code) => {
        const c = code === '??' ? null : ISO.byCode(code);
        return { code, label: c ? c.name : 'Not known', flag: c ? ISO.flagOf(code) : '' };
      }).sort(rank).slice(0, 60),
      campaigns: list(by.campaign, T => ({ channel: T.channel || '' })).sort(rank).slice(0, 40),
      landing: list(by.landing).sort((a, b) => b.leads - a.leads || b.visitors - a.visitors).slice(0, 25),
      /* What they open and browse: every page, the site's sections, and what
         they typed into the site's own search boxes. */
      pages: pagesOf(hits.filter(h => h.day >= since && keep(h.country || '', channelOf(h).channel)), byDayKeys(since, days)),
      sections: sectionsOf(hits.filter(h => h.day >= since && keep(h.country || '', channelOf(h).channel))),
      searches: searchReport(db.searchesSince(since).filter(x => keep(x.country || '', x.channel))),
      devices: list(by.device).sort((a, b) => b.visitors - a.visitors),
      clicks: Object.values(clicksBy).map(x => ({ name: x.name, label: x.label, target: x.target, count: x.count, visitors: x.visitors.size,
        page: Object.entries(x.pages).sort((a, b) => b[1] - a[1])[0][0] })).sort((a, b) => b.count - a.count).slice(0, 30),
      clickKinds: Object.entries(kinds).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      spend: spendRows.slice(0, 200).map(s => ({ id: s.id, month: s.month, channel: s.channel, campaign: s.campaign, country: s.country,
        amount: Number(s.amount_minor) / 100, currency: s.currency, note: s.note, by: s.by_name })),
      currency: 'INR',
    };
  }

  /**
   * The product team's list (patch 204): every search that found nothing,
   * as one line per thing asked for — how often, by how many people, from
   * where, how many then left their details on the "no match" form — with the
   * team's own status and note on it, and a flag once the catalogue answers it.
   */
  const GAP_STATUS = ['new', 'adding', 'partner', 'added', 'wont'];
  function gaps(days) {
    days = Math.max(7, Math.min(180, Number(days) || 90));
    const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
    const rows = db.searchesSince(since);
    const keyOf = r => [String(r.q || '').toLowerCase().trim(), String(r.dest || '').toUpperCase(), String(r.level || '').toLowerCase(), String(r.field || '').toLowerCase()].join('|');
    const lastFound = {};
    rows.forEach(r => { if (Number(r.results) > 0) { const k = keyOf(r); if (!lastFound[k] || r.ts > lastFound[k].ts) lastFound[k] = r; } });
    const saved = (db.content('demandGaps') || {}).items || {};
    const leads = (db.allEnquiriesEver || db.allEnquiries)().filter(e => e.source === 'no-match' && String(e.created_at).slice(0, 10) >= since);
    const list = searchReport(rows.filter(r => !Number(r.results))).noResults.map(g => {
      const key = [String(g.q || '').toLowerCase().trim(), String(g.dest || '').toUpperCase(), String(g.level || '').toLowerCase(), String(g.field || '').toLowerCase()].join('|');
      const st = saved[key] || {};
      const found = lastFound[key];
      const words = [g.q, g.field].filter(Boolean).map(w => String(w).toLowerCase());
      const asked = leads.filter(e => (!g.dest || String(e.destination || '').toUpperCase() === String(g.dest).toUpperCase())
        && (!words.length || words.some(w => String((e.message || '') + ' ' + (e.note || '')).toLowerCase().includes(w)))).length;
      return Object.assign({}, g, { key, status: GAP_STATUS.includes(st.status) ? st.status : 'new', note: st.note || '',
        by: st.by || '', updatedAt: st.at || '', leads: asked,
        nowFinds: found && found.ts > g.last ? Number(found.results) : 0 });
    });
    const count = k => list.filter(g => g.status === k).length;
    return { days, since, total: list.length, open: list.filter(g => g.status !== 'added' && g.status !== 'wont').length,
      byStatus: GAP_STATUS.map(k => ({ key: k, n: count(k) })), items: list };
  }
  function setGap(key, status, note, by) {
    if (!GAP_STATUS.includes(status)) return false;
    const c = db.content('demandGaps') || {};
    c.items = c.items || {};
    c.items[String(key).slice(0, 300)] = { status, note: String(note || '').slice(0, 300), by: String(by || ''), at: new Date().toISOString() };
    db.setContent('demandGaps', c, by || 'staff');
    return true;
  }

  return { touchOf, cookieFor, within, stamp, event, search, visitorOf, report, gaps, setGap, GAP_STATUS, channelOf, inrPerUnit };
}

/* ------------------------------------------------- what they browse */
const SECTIONS = [
  [/^\/$|^\/index|^\/home/, 'Home page'],
  [/^\/university\//, 'University pages'],
  [/^\/(find-university|universities|university$)/, 'University finder'],
  [/^\/study-in-/, 'Destination pages'],
  [/^\/(blog|post\/)/, 'Blog'],
  [/^\/(services|visa-processing|visa)/, 'Packages and services'],
  [/^\/(test-|language-)/, 'Tests and languages'],
  [/^\/(work-|migrate-)/, 'Work and migration'],
  [/^\/scholarships/, 'Scholarships'],
  [/^\/success-stories/, 'Success stories'],
  [/^\/(contact-us|about-us|careers|refer|glossary)/, 'About and contact'],
  [/^\/(terms|privacy|refunds|grievance|disclaimers)/, 'Legal'],
  [/^\/(login|reset)/, 'Sign in'],
];
const sectionOf = p => { for (const [re, name] of SECTIONS) if (re.test(p)) return name; return 'Other pages'; };
const byDayKeys = (since, days) => Array.from({ length: days }, (_, i) =>
  new Date(Date.parse(since + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10));
function pagesOf(hits, dayKeys) {
  const m = {};
  hits.forEach(h => {
    const x = m[h.path] || (m[h.path] = { path: h.path, section: sectionOf(h.path), views: 0, visitors: new Set(), countries: {}, days: {} });
    x.views++; x.visitors.add(h.visitor);
    if (h.country) x.countries[h.country] = (x.countries[h.country] || 0) + 1;
    x.days[h.day] = (x.days[h.day] || 0) + 1;
  });
  return Object.values(m).sort((a, b) => b.views - a.views).slice(0, 60).map(x => ({
    path: x.path, section: x.section, views: x.views, visitors: x.visitors.size,
    topCountry: (Object.entries(x.countries).sort((a, b) => b[1] - a[1])[0] || [''])[0],
    trend: dayKeys.map(d => x.days[d] || 0),
  }));
}
function sectionsOf(hits) {
  const m = {};
  hits.forEach(h => {
    const k = sectionOf(h.path);
    const x = m[k] || (m[k] = { name: k, views: 0, visitors: new Set() });
    x.views++; x.visitors.add(h.visitor);
  });
  return Object.values(m).map(x => ({ name: x.name, views: x.views, visitors: x.visitors.size })).sort((a, b) => b.views - a.views);
}
/* What visitors searched for, and — the part the product team asked for —
   what found nothing: grouped by the words and the boxes they set, most
   asked first, so the top of the list is the next programme to add. */
function searchReport(rows) {
  const ISO = require('./countries.js');
  const destName = c => { const x = c && ISO.byCode(String(c).toUpperCase()); return x ? x.name : c; };
  const label = r => [r.q ? '"' + r.q + '"' : '', r.dest ? destName(r.dest) : '', r.level, r.field].filter(Boolean).join(' · ') || 'Filters only';
  const group = (list) => {
    const m = {};
    list.forEach(r => {
      const k = [String(r.q).toLowerCase(), r.dest, r.level, r.field].join('|');
      const x = m[k] || (m[k] = { label: label(r), q: r.q, dest: r.dest, destName: r.dest ? destName(r.dest) : '', level: r.level, field: r.field,
        count: 0, visitors: new Set(), zero: 0, results: 0, last: '', countries: {} });
      x.count++; x.visitors.add(r.visitor); if (!Number(r.results)) x.zero++; x.results = Number(r.results) || 0;
      if (r.ts > x.last) x.last = r.ts;
      if (r.country) x.countries[r.country] = (x.countries[r.country] || 0) + 1;
    });
    return Object.values(m).map(x => ({ label: x.label, q: x.q, dest: x.dest, destName: x.destName, level: x.level, field: x.field,
      count: x.count, visitors: x.visitors.size, zero: x.zero, results: x.results, last: x.last,
      from: Object.entries(x.countries).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c) }));
  };
  const zero = rows.filter(r => !Number(r.results));
  const words = {};
  rows.forEach(r => String(r.q || '').toLowerCase().split(/[^a-z0-9äöüßéèàç+#]+/i).filter(w => w.length > 2)
    .forEach(w => { words[w] = (words[w] || 0) + 1; }));
  const tally = key => { const m = {}; rows.forEach(r => { const v = r[key]; if (v) m[v] = (m[v] || 0) + 1; });
    return Object.entries(m).map(([name, count]) => ({ name: key === 'dest' ? destName(name) : name, code: name, count })).sort((a, b) => b.count - a.count).slice(0, 12); };
  return {
    total: rows.length, zeroTotal: zero.length,
    visitors: new Set(rows.map(r => r.visitor)).size,
    top: group(rows).sort((a, b) => b.count - a.count).slice(0, 40),
    noResults: group(zero).sort((a, b) => b.visitors - a.visitors || b.count - a.count).slice(0, 60),
    keywords: Object.entries(words).map(([w, n]) => ({ w, n })).sort((a, b) => b.n - a.n).slice(0, 40),
    destinations: tally('dest'), levels: tally('level'), fields: tally('field'),
  };
}
function searchesOf(events) {
  const m = {};
  events.forEach(e => {
    const q = String(e.label || '').toLowerCase().trim();
    if (!q) return;
    const x = m[q] || (m[q] = { q, count: 0, visitors: new Set(), countries: {} });
    x.count++; x.visitors.add(e.visitor);
    if (e.country) x.countries[e.country] = (x.countries[e.country] || 0) + 1;
  });
  return Object.values(m).sort((a, b) => b.count - a.count).slice(0, 40).map(x => ({ q: x.q, count: x.count, visitors: x.visitors.size,
    topCountry: (Object.entries(x.countries).sort((a, b) => b[1] - a[1])[0] || [''])[0] }));
}

/* The channels spend can be booked against, matching what the board shows. */
const SPEND_CHANNELS = ['Google Ads', 'Facebook Ads', 'Instagram Ads', 'Meta Ads', 'YouTube Ads', 'LinkedIn Ads',
  'Bing Ads', 'Snapchat Ads', 'TikTok Ads', 'Influencers', 'Events and fairs', 'Other'];

module.exports = { open, channelOf, ctx, COOKIE, SPEND_CHANNELS };
