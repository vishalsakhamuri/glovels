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

const DEFAULTS = { on: true, langs: I18N.OTHER.slice(), blog: true, perDay: 2500, batch: 30, tokens: { in: 0, out: 0 }, calls: 0, lastRun: '', lastError: '', errors: 0 };
const settingsOf = raw => {
  const s = Object.assign({}, DEFAULTS, raw || {});
  s.langs = (Array.isArray(s.langs) ? s.langs : DEFAULTS.langs).filter(l => I18N.OTHER.includes(l));
  s.on = s.on !== false; s.blog = s.blog !== false;
  s.perDay = Math.max(100, Math.min(100000, Number(s.perDay) || 2500));
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

  async function ask(system, user, { model: m, maxTokens } = {}) {
    const S = settings();
    const today = new Date().toISOString().slice(0, 10);
    if (S.day !== today) save({ day: today, todayCalls: 0 });
    if ((settings().todayCalls || 0) >= S.perDay) throw new Error('the day\'s limit of ' + S.perDay + ' translation calls is reached');
    await slot();
    try {
      const r = await post((process.env.ANTHROPIC_API_BASE || 'https://api.anthropic.com') + '/v1/messages',
        { 'x-api-key': key(), 'anthropic-version': '2023-06-01' },
        { model: m || model(), max_tokens: maxTokens || 8000, system, messages: [{ role: 'user', content: user }] });
      const cur = settings();
      const usage = (r.data && r.data.usage) || {};
      save({ calls: (cur.calls || 0) + 1, todayCalls: (cur.todayCalls || 0) + 1,
        tokens: { in: (cur.tokens.in || 0) + Number(usage.input_tokens || 0), out: (cur.tokens.out || 0) + Number(usage.output_tokens || 0) } });
      if (r.status !== 200) throw new Error(((r.data || {}).error || {}).message || ('the translation service said ' + r.status));
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

  /* ------------------------------------------------------------ worker */
  const state = { running: new Set(), lastError: '', kicked: 0, idleAt: '' };
  let timer = null;
  function kick() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; runAll().catch(e => { state.lastError = String(e.message || e); }); }, 1500);
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
    } catch (e) {
      state.lastError = String(e.message || e);
      save({ lastError: state.lastError, errors: (settings().errors || 0) + 1 });
      log.error('  translator ✗ ' + lang + ': ' + state.lastError);
      /* back off, then look again */
      setTimeout(kick, 5 * 60 * 1000).unref();
    } finally {
      state.running.delete(lang);
      if (!state.running.size) state.idleAt = new Date().toISOString();
    }
  }
  async function runAll() {
    if (!db.i18nReady || !key() || off()) return;
    const S = settings();
    if (!S.on) return;
    save({ lastRun: new Date().toISOString() });
    await Promise.all(S.langs.map(l => runLang(l)));
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
      languages: I18N.LANGS.map(l => Object.assign({}, l, { on: l.code === 'en' || S.langs.includes(l.code), counts: counts[l.code] || {}, posts: posts[l.code] || {} })),
    };
  }

  function setLangs(langs, who) {
    const clean = [...new Set((Array.isArray(langs) ? langs : []).filter(l => I18N.OTHER.includes(l)))];
    const before = settings().langs;
    save({ langs: clean }, who);
    clean.filter(l => !before.includes(l)).forEach(l => { try { db.i18nEnsureLang(l); } catch (e) {} });
    kick();
  }

  /* On start: translate what is waiting, after the site has settled. */
  function start() { if (key() && db.i18nReady && settings().on && !off()) setTimeout(kick, 20000).unref(); }

  function enabledLangs() { return ['en'].concat(settings().langs); }

  return { settings, save, status, learn, pageUnits, pageDict, lookupFor, dict, kick, start, setLangs, enabledLangs,
    translateBatch, translatePost, postsNeeding, postSrc, invalidate: () => { dicts.clear(); pageDictCache.clear(); } };
}

module.exports = { open, settingsOf, TRANSLATE, CHECK, POST_TRANSLATE, POST_CHECK, parseJson };
