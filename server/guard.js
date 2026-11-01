'use strict';
/*
 * Patch 208: THE GUARD — nobody copies the catalogue, no robot searches or
 * fills in a form, and after 30 searches a visitor signs in.
 *
 * "We can't let anyone scrape our data and copy all the 30k or 50k unis we
 *  have. Copying or doing anything should be difficult. After doing 30
 *  searches they have to log in for sure — so we know the user and can
 *  monitor the activities once logged in. Robots and bots doing searches or
 *  submitting the contact form should not be possible. 150 a day is ok."
 *  — Vishal, 1 Nov
 *
 * Nothing on a public website can be made impossible to copy. What this
 * does is make it slow, signed-in and visible:
 *
 *  1. ALLOWANCE. A guest has 30 different searches a day; then the answer is
 *     "sign in to keep searching". A signed-in account has 150 a day. Anyone
 *     has 40 an hour. Staff have no limit. A guest is known by a random
 *     first-party id (`gl_v`, a security cookie) AND by their network, so
 *     clearing cookies does not reset the day (the network allowance is
 *     larger, because a college or a phone carrier shares one address).
 *
 *  2. PATTERN. Somebody walking the catalogue — many destinations × fields
 *     × levels in a few minutes — is blocked for 24 hours, and listed for
 *     the administrators with what they did.
 *
 *  3. ROBOTS. Crawlers, scripts and headless browsers get nothing from the
 *     search API or the forms. A page served carries a short-lived signed
 *     token; the site's own script sends it with every search and form, so a
 *     script calling the API directly — without loading a page — is refused,
 *     and a form sent within three seconds of the page loading is refused.
 *
 * On (GUARD=on) in production; off by default on a laptop and in the test
 * suites, which search hundreds of times on purpose. GUARD=off turns it off.
 */
const crypto = require('crypto');

const DAY_MS = 86400000;
const HOUR_MS = 3600000;

function open({ db, enabled, log = console, limits }) {
  const L = Object.assign({ guest: 30, guestNet: 90, member: 150, hourly: 40,
    patternCombos: 18, patternMinutes: 10, blockHours: 24, formMinSeconds: 3, tokenHours: 12 }, limits || {});
  let secret = '';
  try {
    const t = db.content('traffic') || {};
    secret = t.salt || crypto.randomBytes(16).toString('hex');
  } catch (e) { secret = crypto.randomBytes(16).toString('hex'); }
  const sign = v => crypto.createHmac('sha256', secret + '|guard').update(String(v)).digest('base64url').slice(0, 16);

  /* ------------------------------------------------------------ who */
  /* Patch 214: the visitor, not the Cloudflare edge every guest shares. */
  const ipOf = req => require('./geo').clientIpOf(req);
  const netKey = req => 'n:' + crypto.createHmac('sha256', secret).update(ipOf(req) + '|' + new Date().toISOString().slice(0, 10)).digest('hex').slice(0, 16);
  function cookieOf(req, name) {
    const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
    return m ? m[1] : '';
  }
  /** The guest's id, or a new one (with the Set-Cookie to send). */
  function guestOf(req) {
    const raw = cookieOf(req, 'gl_v');
    if (raw) {
      const [id, sig] = raw.split('.');
      if (id && sig === sign(id)) return { id: 'g:' + id, set: '' };
    }
    const id = crypto.randomBytes(9).toString('base64url');
    const secure = /https/i.test(String(req.headers['x-forwarded-proto'] || '')) ? '; Secure' : '';
    return { id: 'g:' + id, set: 'gl_v=' + id + '.' + sign(id) + '; Path=/; Max-Age=' + (365 * 86400) + '; SameSite=Lax; HttpOnly' + secure };
  }

  /* ------------------------------------------------------------ token */
  /** The token a public page carries: when it was served, signed. */
  function pageToken() { const t = Date.now().toString(36); return t + '.' + sign('t' + t); }
  function tokenAge(req) {
    const raw = String(req.headers['x-glv-t'] || '');
    const [t, sig] = raw.split('.');
    if (!t || sig !== sign('t' + t)) return null;
    const age = Date.now() - parseInt(t, 36);
    return age >= -60000 && age <= L.tokenHours * HOUR_MS ? age : null;
  }

  /* ------------------------------------------------------------ robots */
  const BOT_UA = /bot|crawl|spider|slurp|scrapy|python|curl\/|wget|httpclient|go-http|java\/|okhttp|axios|node-fetch|undici|libwww|perl|ruby|php\/|headless|phantom|puppeteer|playwright|selenium|scraper|httrack|postman|insomnia/i;
  function robot(req) {
    const ua = String(req.headers['user-agent'] || '');
    if (!ua || ua.length < 20) return 'no browser';
    if (BOT_UA.test(ua)) return 'automated client';
    if (!req.headers['accept-language']) return 'no browser language';
    return '';
  }

  /* ------------------------------------------------------------ counts */
  const day = () => new Date().toISOString().slice(0, 10);
  const counts = new Map();      // key → { day, keys:Set, hour:[ts], combos:[{at,c}] }
  const blocks = new Map();      // key → { until, why, who, at, sample }
  function rec(key) {
    let r = counts.get(key);
    if (!r || r.day !== day()) { r = { day: day(), keys: new Set(), hour: [], combos: [] }; counts.set(key, r); }
    return r;
  }
  if (counts.size > 50000) counts.clear();

  /** Is this actor blocked? */
  function blockedNow(keys) {
    for (const k of keys) { const b = blocks.get(k); if (b && b.until > Date.now()) return b; }
    return null;
  }

  /**
   * One search. `actor` = { staff, userId, name, email, req }. `sig` is the
   * search as a string (the same search again is free); `combo` is its
   * destination|field|level, for the pattern check.
   * Returns { ok:true, setCookie } or { ok:false, status, body, setCookie }.
   */
  function search(req, actor, sig, combo) {
    if (!enabled) return { ok: true };
    if (actor && actor.staff) return { ok: true };
    const bot = robot(req);
    if (bot) return { ok: false, status: 403, body: { error: 'Searches are for people using a browser.', robot: true } };
    if (tokenAge(req) == null) return { ok: false, status: 403, body: { error: 'Please reload the page and search again.', reload: true } };
    const g = actor && actor.userId ? { id: 'u:' + actor.userId, set: '' } : guestOf(req);
    const net = netKey(req);
    const keys = actor && actor.userId ? [g.id] : [g.id, net];
    const b = blockedNow(keys);
    if (b) return { ok: false, status: 429, setCookie: g.set, body: { error: 'Searching is paused for this connection until ' + new Date(b.until).toISOString().slice(11, 16) + ' UTC. Write to us if you need help.', blocked: true } };
    const me = rec(g.id), nw = rec(net);
    const now = Date.now();
    me.hour = me.hour.filter(t => now - t < HOUR_MS);
    const repeat = me.keys.has(sig);
    if (!repeat) {
      const limit = actor && actor.userId ? L.member : L.guest;
      if (me.keys.size >= limit || (!(actor && actor.userId) && nw.keys.size >= L.guestNet)) {
        return actor && actor.userId
          ? { ok: false, status: 429, setCookie: g.set, body: { error: 'You have used today\'s ' + L.member + ' searches. They start again tomorrow — or message your counsellor.', limitReached: true } }
          : { ok: false, status: 401, setCookie: g.set, body: { error: 'You have used your ' + L.guest + ' free searches for today. Sign in or create a free account to keep searching.', loginRequired: true, used: me.keys.size } };
      }
      if (me.hour.length >= L.hourly) return { ok: false, status: 429, setCookie: g.set, body: { error: 'That is a lot of searching in an hour — take a breather and try again shortly.', slowDown: true } };
      me.keys.add(sig); nw.keys.add(sig); me.hour.push(now);
      if (combo) {
        me.combos = me.combos.filter(x => now - x.at < L.patternMinutes * 60000);
        if (!me.combos.some(x => x.c === combo)) me.combos.push({ at: now, c: combo });
        if (me.combos.length >= L.patternCombos) {
          const until = now + L.blockHours * HOUR_MS;
          const why = me.combos.length + ' different destination/subject combinations in ' + L.patternMinutes + ' minutes';
          const entry = { until, why, at: new Date(now).toISOString(), who: actor && actor.userId ? (actor.name + ' <' + actor.email + '>') : 'Guest', key: g.id,
            sample: me.combos.slice(-6).map(x => x.c) };
          keys.forEach(k => blocks.set(k, entry));
          try { db.log('guard', 'blocked for copying', entry.who + ' — ' + why); } catch (e) {}
          log.error('  guard ✗ blocked ' + entry.who + ': ' + why);
          return { ok: false, status: 429, setCookie: g.set, body: { error: 'Searching is paused for this connection for 24 hours.', blocked: true } };
        }
      }
    }
    return { ok: true, setCookie: g.set, used: me.keys.size, of: actor && actor.userId ? L.member : L.guest };
  }

  /** A form sent from a public page: a person, not a script, and not instantly. */
  function form(req) {
    if (!enabled) return { ok: true };
    const bot = robot(req);
    if (bot) return { ok: false, status: 403, body: { error: 'Please send this from your browser.', robot: true } };
    const age = tokenAge(req);
    if (age == null) return { ok: false, status: 403, body: { error: 'Please reload the page and send it again.', reload: true } };
    if (age < L.formMinSeconds * 1000) return { ok: false, status: 429, body: { error: 'That was quick — please check your details and send again.' } };
    return { ok: true };
  }

  function status() {
    const now = Date.now();
    return {
      enabled, limits: { guest: L.guest, member: L.member, hourly: L.hourly },
      blocked: [...new Set([...blocks.values()].filter(b => b.until > now))].map(b => ({ key: b.key, who: b.who, why: b.why, at: b.at, until: new Date(b.until).toISOString(), sample: b.sample })),
    };
  }
  function unblock(key) { let n = 0; for (const [k, b] of blocks) if (b.key === key) { blocks.delete(k); n++; } return n; }

  return { search, form, pageToken, robot, status, unblock, enabled };
}

module.exports = { open };
