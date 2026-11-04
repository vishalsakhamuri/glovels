'use strict';
/*
 * Patch 265: the translator — Claude translates, and a second Claude pass
 * checks every line before it is used.
 *
 * "machine translates and claude validates" — Vishal, 4 Nov 2026.
 *
 * Two queues, one worker per language, three languages at a time:
 *
 *   units  The dictionary of server/i18n.js. A unit arrives 'pending' when a
 *          page is served in a language for the first time (or a script in
 *          the browser reports a line it drew), is translated in batches of
 *          thirty, checked in the same batch by a reviewer prompt, and saved
 *          as 'checked' — or 'flagged' when the check could not make it
 *          carry the source's placeholders, in which case the English shows
 *          and the Languages screen lists it for a person.
 *
 *   posts  A published post is translated whole — title, excerpt, the two
 *          meta lines and the Markdown body — then checked, and saved against
 *          a hash of the English it came from, so an edited post is
 *          translated again and an untouched one never is.
 *
 *   ANTHROPIC_API_KEY  on Render → Environment. Without it nothing is
 *                      translated and the Languages screen says so.
 *   I18N_MODEL         optional; the model that translates (default
 *                      claude-sonnet-5-5). I18N_CHECK_MODEL for the reviewer.
 *   I18N=off           switches the worker off (the pages still serve what
 *                      has been translated so far).
 */
const https = require('https');
const http = require('http');
const I18N = require('./i18n.js');

/* Patch 269: 2,500 calls a day was an hour's work on a 5,800-line site in
   eight languages (two calls per batch of 30). 20,000 covers the whole site
   and the blog in a day; I18N_PER_DAY on the server overrides. A stored
   2,500 — the old default — reads as unset. */
/* Patch 270 (owner, 4 Nov: "the maximum limit for a day can be until it
   is translated"): 100,000 — the ceiling the office screen allows — so the
   limit is a runaway guard, not a schedule. */
const PER_DAY = (() => { const n = Number(process.env.I18N_PER_DAY); return Number.isFinite(n) && n >= 100 ? n : 100000; })();
/* Patch 270 (owner: "two languages a day, and make each live once it is
   complete"): the translator works on FOCUS languages at a time, in the
   office's order, and a language reaches the public site — the header
   picker, /xx/ addresses, hreflang, the sitemap, students' emails — only
   once its lines and posts are done. I18N_GATE=off serves every switched-on
   language at once (the old behaviour; the test suites use it). */
const GATE = String(process.env.I18N_GATE || '').toLowerCase() !== 'off';
const DEFAULTS = { on: true, langs: I18N.OTHER.slice(), live: [], held: [], focus: 2, blog: true, perDay: PER_DAY, batch: 30, tokens: { in: 0, out: 0 }, calls: 0, lastRun: '', lastError: '', errors: 0 };
const settingsOf = raw => {
  const s = Object.assign({}, DEFAULTS, raw || {});
  s.langs = (Array.isArray(s.langs) ? s.langs : DEFAULTS.langs).filter(l => I18N.OTHER.includes(l));
  s.on = s.on !== false; s.blog = s.blog !== false;
  s.perDay = Math.max(100, Math.min(100000, ([2500, 20000].includes(Number(s.perDay)) ? PER_DAY : Number(s.perDay)) || PER_DAY));
  s.live = (Array.isArray(s.live) ? s.live : []).filter(l => s.langs.includes(l));
  s.held = (Array.isArray(s.held) ? s.held : []).filter(l => s.langs.includes(l));
  s.focus = Math.max(1, Math.min(8, Number(s.focus) || 2));
  s.batch = Math.max(5, Math.min(60, Number(s.batch) || 30));
  s.tokens = Object.assign({ in: 0, out: 0 }, s.tokens || {});
  return s;
};

function post(href, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(href);
    const lib = u.protocol === 'http:' ? http : https;
    const data = JSON.stringify(body);
    const req = lib.request(u, { method: 'POST', timeout: 300000, headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, headers) }, res => {
      let out = ''; res.on('data', c => { out += c; }); res.on('end', () => {
        let j = {}; try { j = JSON.parse(out); } catch (e) { j = { raw: out.slice(0, 300) }; }
        resolve({ status: res.statusCode, data: j });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.write(data); req.end();
  });
}

const KEEP = 'Glovels; the names of universities, programmes, degrees, cities and people (they stay in English letters exactly as written); product and scheme names — Offer Letter, Boarding Pass, Opportunity Card, EU Blue Card, Express Entry, APS, uni-assist, Studienkolleg, Anerkennung, IELTS, TOEFL, PTE, Duolingo, GRE, GMAT, SAT, SOP, LOR, CV, CGPA, ECTS, PR, DAAD, VPD, MOI, WhatsApp, Razorpay, Stripe; currency symbols and codes (₹, €, $, INR, EUR, USD); email addresses, phone numbers and web addresses';

const TRANSLATE = (lang, n) => `You translate the website of Glovels (glovels.com), a study-abroad and work-abroad consultancy, from English into ${lang}. Readers are students and professionals who want to study or work in Germany, Canada, the UK, Ireland, France, Poland, Spain, Italy, the USA or Australia.

Write natural, warm, plain ${lang} as a native professional website translator would — not word for word, but exactly the same meaning, the same tone and the same register: a button label stays a short imperative, a heading stays a heading, a legal paragraph stays precise. A country name is translated. Prices, dates and facts are never changed.

Placeholders. Keep every placeholder exactly as it is, in the place the words need it: <1>…</1> pairs enclose the same words in your translation that they enclose in English (a link, bold text); <2/> alone stands for an icon, a picture or a line break; {1} stands for a number. Never add, drop, merge or renumber a placeholder. Keep HTML entities (&amp; &nbsp; &rarr; &middot; …) as they are, and write no HTML tags of your own.

Do not translate: ${KEEP}.

You will receive a JSON array of ${n} English strings. Answer with ONLY a JSON array of ${n} strings — the translations, in the same order, one for each input, nothing else.`;

const CHECK = (lang, n) => `You review translations into ${lang} for the website of Glovels (glovels.com), a study-abroad and work-abroad consultancy. You will receive a JSON array of ${n} pairs: {"en": the English, "t": the proposed translation}.

For each pair check that the translation (1) says exactly what the English says — nothing added, nothing missing, no fact, number, price or date changed; (2) reads like natural ${lang} written by a native professional, in the same register (a button label is a short imperative, a heading a heading); (3) keeps every placeholder exactly — <1>…</1> pairs around the same words, <2/> in place, {1} in place, none added or dropped — and keeps HTML entities as they are with no HTML tags of its own; (4) leaves these untranslated: ${KEEP}.

Answer with ONLY a JSON array of ${n} strings, in the same order: the string "ok" when the translation passes, otherwise the full corrected translation.`;

const POST_TRANSLATE = lang => `You translate blog posts of Glovels (glovels.com), a study-abroad and work-abroad consultancy, from English into ${lang}, for students and professionals who want to study or work abroad.

Translate the whole post into natural, warm, plain ${lang} as a native professional translator would — the same meaning, the same facts, figures, dates and prices, the same structure. The body is Markdown: keep every heading level (##, ###), list, numbered step, table (| a | b | with the |---| row), **bold**, and every link exactly as [translated words](same URL) — the URL never changes. Keep the "## Sources" section with its links. Keep HTML entities as they are; write no HTML.

Do not translate: ${KEEP}.

You will receive a JSON object {"title","excerpt","metaTitle","metaDesc","body"}. Answer with ONLY a JSON object with the same five keys, each translated (the title under 70 characters, metaTitle under 60, metaDesc under 155 where the English is), nothing else.`;

const POST_CHECK = lang => `You review a blog post translated into ${lang} for Glovels (glovels.com), a study-abroad and work-abroad consultancy. You will receive {"en": the English post, "t": the translation}, each an object {"title","excerpt","metaTitle","metaDesc","body"} with a Markdown body.

Check that the translation says exactly what the English says with nothing added or missing and no fact, figure, date, price or URL changed; reads like natural ${lang} written by a native professional; keeps the Markdown structure (headings, lists, steps, tables, bold, links as [words](same URL)); and leaves these untranslated: ${KEEP}.

Answer with ONLY a JSON object: {"ok": true} when it passes, otherwise {"ok": false, "fix": the full corrected translation object with the five keys}.`;

function parseJson(text, want) {
  const s = String(text || '');
  const a = s.indexOf(want === 'array' ? '[' : '{'), b = s.lastIndexOf(want === 'array' ? ']' : '}');
  if (a < 0 || b <= a) throw new Error('no JSON in the answer');
  return JSON.parse(s.slice(a, b + 1));
}

function open({ db, log = console, siteUrl = '' }) {
  const settings = () => settingsOf(db.content('i18n'));
  const save = (patch, who) => db.setContent('i18n', Object.assign(settings(), patch), who || 'translator');
  const key = () => String(process.env.ANTHROPIC_API_KEY || '').trim();
  const model = () => process.env.I18N_MODEL || 'claude-sonnet-5-5';
  const checkModel = () => process.env.I18N_CHECK_MODEL || model();
  const off = () => String(process.env.I18N || '').toLowerCase() === 'off';

  /* The dictionary in memory, per language, filled from the database the
     first time the language is asked for and kept in step by every save. */
  const dicts = new Map();
  function dict(lang) {
    if (!dicts.has(lang)) {
      const m = new Map();
      if (db.i18nReady) db.i18nDict(lang).forEach(r => m.set(r.hash, r.text));
      dicts.set(lang, m);
    }
    return dicts.get(lang);
  }
  const lookupFor = lang => { const d = dict(lang); return h => (d.has(h) ? d.get(h) : null); };

  /* Which units are not worth a translation: the catalogue's own words. */
  let catSet = null, catVersion = -1;
  function isCatalogue(key) {
    const v = typeof db.catalogueVersion === 'function' ? db.catalogueVersion() : 0;
    if (!catSet || v !== catVersion) {
      catSet = new Set();
      try {
        (db.catalogueNames ? db.catalogueNames() : []).forEach(n => { const k = String(n || '').trim().toLowerCase(); if (k) catSet.add(k); });
      } catch (e) { /* no catalogue names: nothing to skip */ }
      catVersion = v;
    }
    const k = key.replace(/<\/?\d+\/?>|\{\d+\}/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    return catSet.has(k);
  }

  /* Units seen once on a page of a data family (one university's page): the
     template's words come round again on the next page; one page's data
     does not. */
  const once = new Map();     /* hash → the page instance it was seen on */
  const ONCE_MAX = 20000;

  /* Pages' units, so the same page served twice does not write twice. */
  const pageSeen = new Map();  /* page family → Set of hashes recorded */

  function learn(units, { page, instance, kind }) {
    if (!db.i18nReady || !units.length) return 0;
    const S = settings();
    if (!S.langs.length) return 0;
    const fam = page || '';
    const fresh = [];
    for (const u of units) {
      if (!u || !u.key || !u.hash) continue;
      if (u.key.length > 4000 || I18N.notWords(u.key)) continue;
      if (isCatalogue(u.key)) continue;
      if (I18N.DATA_FAMILIES.has(fam) && instance) {
        const was = once.get(u.hash);
        if (was == null) { if (once.size > ONCE_MAX) once.clear(); once.set(u.hash, instance); continue; }
        if (was === instance) continue;
      }
      fresh.push(u);
    }
    if (!fresh.length) return 0;
    const added = db.i18nLearn(fresh, S.langs, fam, kind || 'html');
    if (added) kick();
    return added;
  }
  function pageUnits(page, hashes, js) {
    if (!db.i18nReady || !page || !hashes.length) return;
    const k = js ? page + '|js' : page;
    let set = pageSeen.get(k);
    if (!set) { set = new Set(); pageSeen.set(k, set); }
    const fresh = hashes.filter(h => !set.has(h));
    if (!fresh.length) return;
    fresh.forEach(h => set.add(h));
    db.i18nPageSeen(page, fresh, !!js);
    if (js) pageDictCache.clear();
  }
  const pageDictCache = new Map();
  function pageDict(lang, page) {
    const k = lang + '|' + page;
    const c = pageDictCache.get(k);
    if (c && Date.now() - c.at < 60000) return c.d;
    const d = {};
    if (db.i18nReady) db.i18nPageDict(lang, page).forEach(r => { d[r.hash] = r.text; });
    pageDictCache.set(k, { at: Date.now(), d });
    if (pageDictCache.size > 200) pageDictCache.delete(pageDictCache.keys().next().value);
    return d;
  }

  /* ------------------------------------------------------------ the API */
  let inFlight = 0;
  const MAX_FLIGHT = 3;
  const waiters = [];
  const slot = () => new Promise(r => { if (inFlight < MAX_FLIGHT) { inFlight++; r(); } else waiters.push(r); });
  const free = () => { inFlight--; const w = waiters.shift(); if (w) { inFlight++; w(); } };

  /* Patch 269 (4 Nov, live): a failure of the SERVICE — the day's limit,
     a 4xx/5xx from the API, a timeout — is not a failure of the LINE. It
     stops the run and leaves the line pending for the next one. Before this,
     hitting the 2,500-call limit flagged the 40,000 lines still waiting as
     "needs a person", one by one, in a minute. */
  class Stop extends Error {}
  const msToMidnight = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - d.getTime() + 60000; };
  async function ask(system, user, { model: m, maxTokens } = {}) {
    const S = settings();
    const today = new Date().toISOString().slice(0, 10);
    if (S.day !== today) save({ day: today, todayCalls: 0 });
    if ((settings().todayCalls || 0) >= S.perDay) throw Object.assign(new Stop('the day\'s limit of ' + S.perDay + ' translation calls is reached — it carries on tomorrow, or raise the limit'), { retryMs: msToMidnight() });
    await slot();
    try {
      let r;
      try {
        r = await post((process.env.ANTHROPIC_API_BASE || 'https://api.anthropic.com') + '/v1/messages',
          { 'x-api-key': key(), 'anthropic-version': '2023-06-01' },
          { model: m || model(), max_tokens: maxTokens || 8000, system, messages: [{ role: 'user', content: user }] });
      } catch (e) { throw Object.assign(new Stop('could not reach the translation service: ' + String(e.message || e)), { retryMs: 2 * 60 * 1000 }); }
      /* Patch 270: a refused call (no credit, too many at once, a bad key)
         is not a call — on 4 Nov afternoon 17,500 refusals counted against
         the day and translated nothing. The service's own words are kept,
         so the office reads "credit balance is too low" and not a limit. */
      if (r.status !== 200) {
        const msg = ((r.data || {}).error || {}).message || ('the translation service said ' + r.status);
        const e = new Stop('the translation service refused (' + r.status + '): ' + msg);
        e.retryMs = r.status === 429 ? 60 * 1000 : r.status >= 500 ? 2 * 60 * 1000 : 15 * 60 * 1000;
        throw e;
      }
      const cur = settings();
      const usage = (r.data && r.data.usage) || {};
      save({ calls: (cur.calls || 0) + 1, todayCalls: (cur.todayCalls || 0) + 1,
        tokens: { in: (cur.tokens.in || 0) + Number(usage.input_tokens || 0), out: (cur.tokens.out || 0) + Number(usage.output_tokens || 0) } });
      return (r.data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    } finally { free(); }
  }

  const langName = l => (I18N.BY_CODE[l] || {}).name || l;

  /* Translate a batch of units into one language, check them, save them.
     A batch the model answers with the wrong number of lines is split and
     tried again, down to one line. */
  async function translateBatch(lang, rows) {
    if (!rows.length) return;
    const srcs = rows.map(r => r.src);
    let out;
    try {
      out = parseJson(await ask(TRANSLATE(langName(lang), srcs.length), JSON.stringify(srcs)), 'array');
    } catch (e) {
      if (e instanceof Stop) throw e;
      if (rows.length > 1) { const h = Math.ceil(rows.length / 2); await translateBatch(lang, rows.slice(0, h)); await translateBatch(lang, rows.slice(h)); return; }
      db.i18nSave(rows[0].hash, lang, '', 'flagged', 'no translation came back: ' + String(e.message || e).slice(0, 200), 'translator');
      return;
    }
    if (!Array.isArray(out) || out.length !== srcs.length) {
      if (rows.length > 1) { const h = Math.ceil(rows.length / 2); await translateBatch(lang, rows.slice(0, h)); await translateBatch(lang, rows.slice(h)); return; }
      db.i18nSave(rows[0].hash, lang, '', 'flagged', 'the answer did not match the question', 'translator');
      return;
    }
    const pairs = rows.map((r, i) => ({ en: r.src, t: String(out[i] == null ? '' : out[i]) }));
    /* The reviewer. If the review itself fails, the translation stands as
       'machine' — used, and listed on the screen as unchecked. */
    let verdict = null;
    try {
      verdict = parseJson(await ask(CHECK(langName(lang), pairs.length), JSON.stringify(pairs), { model: checkModel() }), 'array');
      if (!Array.isArray(verdict) || verdict.length !== pairs.length) verdict = null;
    } catch (e) { verdict = null; }
    const d = dict(lang);
    pairs.forEach((p, i) => {
      let text = p.t, status = verdict ? 'checked' : 'machine', note = '';
      if (verdict && typeof verdict[i] === 'string' && verdict[i].trim().toLowerCase() !== 'ok' && verdict[i].trim()) { text = verdict[i]; note = 'corrected by the reviewer'; }
      if (!text.trim() || !I18N.placeholdersMatch(p.en, text)) {
        /* the reviewer's version failed the placeholders: try the first */
        if (p.t.trim() && I18N.placeholdersMatch(p.en, p.t)) { text = p.t; status = 'machine'; note = 'the reviewer\'s correction lost a placeholder; the first translation is used unchecked'; }
        else { db.i18nSave(rows[i].hash, lang, p.t, 'flagged', 'the translation does not carry the placeholders of the English', 'translator'); d.delete(rows[i].hash); return; }
      }
      db.i18nSave(rows[i].hash, lang, text, status, note, 'translator');
      d.set(rows[i].hash, text);
    });
    pageDictCache.clear();
  }

  /* ------------------------------------------------------------ posts */
  const postSrc = p => I18N.hash([p.title, p.excerpt, p.meta_title, p.meta_desc, p.body].map(x => String(x || '')).join('\u0001'));
  function postsNeeding(lang) {
    if (!db.i18nReady) return [];
    const have = new Map(db.postI18nByLang(lang).map(r => [Number(r.post_id), r]));
    const out = [];
    for (const p of db.postsForI18n()) {
      if (!String(p.body || '').trim()) continue;
      const h = postSrc(p);
      const t = have.get(Number(p.id));
      if (t && t.src_hash === h && t.status !== 'pending') continue;
      if (t && t.status === 'edited' && t.src_hash === h) continue;
      out.push({ post: p, srcHash: h });
    }
    return out;
  }
  async function translatePost(lang, p, srcHash) {
    const en = { title: p.title || '', excerpt: p.excerpt || '', metaTitle: p.meta_title || '', metaDesc: p.meta_desc || '', body: p.body || '' };
    let t;
    try {
      t = parseJson(await ask(POST_TRANSLATE(langName(lang)), JSON.stringify(en), { maxTokens: 16000 }), 'object');
    } catch (e) {
      if (e instanceof Stop) { db.postI18nSave(p.id, lang, { status: 'pending', srcHash, by: 'translator' }); throw e; }
      db.postI18nSave(p.id, lang, { status: 'flagged', srcHash, note: 'no translation came back: ' + String(e.message || e).slice(0, 200), by: 'translator' });
      return;
    }
    const shape = o => ({ title: String((o && o.title) || '').slice(0, 200), excerpt: String((o && o.excerpt) || '').slice(0, 1000),
      metaTitle: String((o && o.metaTitle) || '').slice(0, 200), metaDesc: String((o && o.metaDesc) || '').slice(0, 400), body: String((o && o.body) || '') });
    t = shape(t);
    if (!t.title.trim() || !t.body.trim()) { db.postI18nSave(p.id, lang, { status: 'flagged', srcHash, note: 'the translation came back without a title or a body', by: 'translator' }); return; }
    let status = 'machine', note = '';
    try {
      const v = parseJson(await ask(POST_CHECK(langName(lang)), JSON.stringify({ en, t }), { model: checkModel(), maxTokens: 16000 }), 'object');
      if (v && v.ok === false && v.fix && typeof v.fix === 'object') { const f = shape(v.fix); if (f.title.trim() && f.body.trim()) { t = f; note = 'corrected by the reviewer'; } }
      if (v && (v.ok === true || v.fix)) status = 'checked';
    } catch (e) { status = 'machine'; }
    /* The links must survive: every URL of the English is in the translation. */
    const urls = s => [...String(s).matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map(m => m[1]).sort().join('\n');
    if (urls(en.body) !== urls(t.body)) { status = 'flagged'; note = 'the links of the English post do not all survive in the translation'; }
    db.postI18nSave(p.id, lang, Object.assign(t, { status, srcHash, note, by: 'translator' }));
  }

  /* Patch 270: the office pressing a button (or raising the limit) ends a pause. */
  function wake() { state.pausedUntil = 0; if (timer) { clearTimeout(timer); timer = null; } kick(); }
  function invalidateDicts() { try { dicts.clear(); pageDictCache.clear(); } catch (e) {} }

  /* ------------------------------------------------------------ worker */
  const state = { running: new Set(), lastError: '', kicked: 0, idleAt: '', pausedUntil: 0 };
  let timer = null;
  /* Patch 270: after the service refuses, nothing — not a visitor's page,
     not the crawl — wakes the worker before the pause is over. Before, every
     page read kicked a run that made one refused call and stopped. */
  function kick() {
    if (timer) return;
    const wait = Math.max(1500, state.pausedUntil - Date.now());
    timer = setTimeout(() => { timer = null; runAll().catch(e => { state.lastError = String(e.message || e); }); }, wait);
    if (timer.unref) timer.unref();
  }
  /* Patch 269: lines the old code flagged for a service failure go back to
     pending — they were never looked at. Posts the same. */
  function unflagServiceFailures() {
    try {
      const n = db.i18nUnflagServiceFailures ? db.i18nUnflagServiceFailures() : { units: 0, posts: 0 };
      if (n.units || n.posts) log.log('  translator: ' + n.units + ' line(s) and ' + n.posts + ' post(s) flagged for a service failure are back in the queue');
    } catch (e) {}
  }
  async function runLang(lang) {
    if (state.running.has(lang)) return;
    state.running.add(lang);
    try {
      const S = settings();
      for (let rounds = 0; rounds < 500; rounds++) {
        if (!settings().on || off() || !key()) break;
        const pending = db.i18nPending(lang, S.batch);
        if (pending.length) { await translateBatch(lang, pending); continue; }
        if (S.blog) {
          const need = postsNeeding(lang);
          if (need.length) { const { post: p, srcHash } = need[0]; db.postI18nSave(p.id, lang, { status: 'pending', srcHash, by: 'translator' }); await translatePost(lang, p, srcHash); continue; }
        }
        break;
      }
      state.lastError = '';
      /* Patch 269: a run that finished clears the last run's complaint. */
      if (settings().lastError) save({ lastError: '' });
    } catch (e) {
      state.lastError = String(e.message || e);
      save({ lastError: state.lastError, errors: (settings().errors || 0) + 1 });
      log.error('  translator ✗ ' + lang + ': ' + state.lastError);
      /* back off, then look again — for as long as the refusal says */
      state.pausedUntil = Date.now() + (e instanceof Stop && e.retryMs ? e.retryMs : 5 * 60 * 1000);
      kick();
    } finally {
      state.running.delete(lang);
      if (!state.running.size) state.idleAt = new Date().toISOString();
    }
  }
  /* Patch 270: is a language finished? Every line looked at (nothing
     waiting), at most 1% left for a person, and every live post done. */
  function completeness(lang) {
    const c = (db.i18nCounts ? db.i18nCounts() : {})[lang] || {};
    const done = (c.checked || 0) + (c.machine || 0) + (c.edited || 0);
    const total = done + (c.pending || 0) + (c.flagged || 0);
    const posts = settings().blog ? postsNeeding(lang).length : 0;
    return { done, total, pending: c.pending || 0, flagged: c.flagged || 0, posts,
      complete: total > 0 && !(c.pending) && (c.flagged || 0) <= Math.max(5, total * 0.01) && posts === 0 };
  }
  function promoteFinished() {
    const S = settings();
    /* A language the office took off by hand stays off until they put it back. */
    S.langs.filter(l => !S.live.includes(l) && !S.held.includes(l)).forEach(l => {
      const k = completeness(l);
      if (!k.complete) return;
      save({ live: settings().live.concat(l) }, 'translator');
      invalidateDicts();
      log.log('  translator ✓ ' + langName(l) + ' is complete (' + k.done + ' lines) and live on the site');
      try { db.log && db.log('translator', langName(l) + ' went live', k.done + ' lines, every post'); } catch (e) {}
    });
  }
  /* The languages being translated now: the first FOCUS in the office's
     order that are not live yet. */
  function translating() {
    const S = settings();
    const counts = db.i18nCounts ? db.i18nCounts() : {};
    /* A language with nothing left for the machine — only lines a person
       has to look at — does not hold up the next one. */
    const work = l => { const c = counts[l] || {}; const any = Object.keys(c).length; return !any || (c.pending || 0) > 0 || (S.blog && postsNeeding(l).length > 0); };
    return S.langs.filter(l => !S.live.includes(l) && work(l)).slice(0, S.focus);
  }
  async function runAll() {
    if (!db.i18nReady || !key() || off()) return;
    const S = settings();
    if (!S.on) return;
    unflagServiceFailures();
    promoteFinished();
    save({ lastRun: new Date().toISOString() });
    /* Live languages keep up with new lines (cheap); the focus languages
       get the rest of the capacity. */
    const now = [...new Set(settings().live.concat(translating()))];
    await Promise.all(now.map(l => runLang(l)));
    promoteFinished();
    /* A run stops after 500 rounds; if a language still has work and the
       service is not refusing, carry on. */
    if (Date.now() >= state.pausedUntil && now.some(l => { const c = (db.i18nCounts ? db.i18nCounts() : {})[l] || {}; return (c.pending || 0) > 0; })) kick();
  }

  function status() {
    const S = settings();
    const counts = db.i18nCounts ? db.i18nCounts() : {};
    const posts = db.postI18nCounts ? db.postI18nCounts() : {};
    const total = db.i18nSrcCount ? db.i18nSrcCount() : 0;
    const livePosts = db.i18nReady ? db.postsForI18n().filter(p => String(p.body || '').trim()).length : 0;
    return {
      ready: !!db.i18nReady, connected: !!key(), off: off(), on: S.on, blog: S.blog, langs: S.langs, model: model(), checkModel: checkModel(),
      perDay: S.perDay, calls: S.calls || 0, todayCalls: S.todayCalls || 0, tokens: S.tokens, lastRun: S.lastRun || '', lastError: state.lastError || S.lastError || '',
      running: [...state.running], units: total, livePosts,
      /* Patch 270 */
      gate: GATE, focus: S.focus, live: S.live, order: S.langs, translating: translating(),
      pausedUntil: state.pausedUntil > Date.now() ? new Date(state.pausedUntil).toISOString() : '',
      languages: I18N.LANGS.map(l => {
        const on = l.code === 'en' || S.langs.includes(l.code);
        const live = l.code === 'en' || (GATE ? S.live.includes(l.code) : on);
        const tr = translating();
        const c = counts[l.code] || {};
        const st = l.code === 'en' ? 'live' : !on ? 'off' : live ? 'live' : tr.includes(l.code) ? 'translating'
          : (!(c.pending) && Object.keys(c).length && !(S.blog && postsNeeding(l.code).length)) ? 'person' : 'queued';
        return Object.assign({}, l, { on, live, state: st, place: S.langs.indexOf(l.code) + 1, counts: c, posts: posts[l.code] || {} });
      }),
    };
  }

  function setLangs(langs, who) {
    const clean = [...new Set((Array.isArray(langs) ? langs : []).filter(l => I18N.OTHER.includes(l)))];
    const before = settings().langs;
    /* Patch 270: keep the office's order — the queue is the order. */
    const ordered = before.filter(l => clean.includes(l)).concat(clean.filter(l => !before.includes(l)));
    save({ langs: ordered }, who);
    clean.filter(l => !before.includes(l)).forEach(l => { try { db.i18nEnsureLang(l); } catch (e) {} });
    kick();
  }

  /* On start: translate what is waiting, after the site has settled. */
  function start() { if (key() && db.i18nReady && settings().on && !off()) setTimeout(kick, 20000).unref(); }

  /* The languages the PUBLIC site offers — live ones only (patch 270). */
  function enabledLangs() { const S = settings(); return ['en'].concat(GATE ? S.live : S.langs); }
  /* Every language switched on, live or still being translated — for the
     office's preview and for queueing lines. */
  function allLangs() { return ['en'].concat(settings().langs); }
  function setLive(lang, live, who) {
    const S = settings();
    if (!S.langs.includes(lang)) return S.live;
    const next = live ? [...new Set(S.live.concat(lang))] : S.live.filter(l => l !== lang);
    const held = live ? S.held.filter(l => l !== lang) : [...new Set(S.held.concat(lang))];
    save({ live: next, held }, who);
    invalidateDicts();
    return next;
  }
  /* "Do this one next": to the front of the queue, behind nothing. */
  function moveFirst(lang, who) {
    const S = settings();
    if (!S.langs.includes(lang)) return;
    save({ langs: [lang].concat(S.langs.filter(l => l !== lang)) }, who);
    kick();
  }

  return { settings, save, status, learn, pageUnits, pageDict, lookupFor, dict, kick, start, setLangs, enabledLangs,
    translateBatch, translatePost, postsNeeding, postSrc, invalidate: invalidateDicts,
    allLangs, setLive, moveFirst, translating, completeness, wake };
}

module.exports = { open, settingsOf, TRANSLATE, CHECK, POST_TRANSLATE, POST_CHECK, parseJson };
