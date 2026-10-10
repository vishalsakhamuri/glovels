/*
 * Tags — the free-text search over the catalogue (10 Oct).
 *
 * "A field where a student or counsellor can give free text, and using tags
 *  we show the relevant universities; suggestions for student and counsellor
 *  should come from these tags so correct search results are possible."
 *
 * One module, two readers, like find.js: the server loads the dictionary
 * (assets/tags-de.json — 3,774 values the office's Germany sheet uses, each
 * with a type and how many programmes carry it) and answers /api/tags; the
 * browser loads the same file at /js/tags.js, without the dictionary, and
 * uses match()/tagsOf() to narrow a list of rows it already holds. Nothing
 * here touches `document`, and `require` only runs under Node.
 *
 * A programme's tags are either the ones the office imported (p.tags, from
 * the sheet's Tags column) or, when none have been, a set DERIVED from the
 * row's own fields — the title's words, the university and its short name,
 * the city, the degree, public/private, no tuition, MOI, GRE, work
 * experience, a 3-year bachelor's, the German level, the intake seasons and
 * their deadline months, the bachelor's subjects it asks for. So the search
 * works on the 171 seeded rows today and gets sharper when the import lands.
 *
 * Types in the dictionary: Programme, University, City, State, Bachelor,
 * Degree, Language, Requirement, Feature, Application, Deadline, Intake,
 * Eligibility. Two more are made here and never suggested: Field (the
 * catalogue's own field name) and Text (a free-text chip).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(true);
  else root.TAGS = factory(false);
})(typeof self !== 'undefined' ? self : this, function (isNode) {
  'use strict';

  const TYPES = ['Programme', 'University', 'City', 'State', 'Bachelor', 'Degree', 'Language', 'Requirement',
    'Feature', 'Application', 'Deadline', 'Intake', 'Eligibility'];
  /* The types that would name a public university on a locked row. */
  const IDENTITY = ['University', 'City', 'State'];

  /* Lower-case, no accents, ß → ss, one space between words. "Tübingen",
     "Tubingen" and "TÜBINGEN" are one key; "Tuebingen" is folded a second
     way (ue → u) when looked up, so a short name typed the German way lands. */
  const fold = s => String(s == null ? '' : s).toLowerCase().replace(/ß/g, 'ss').normalize('NFKD')
    .replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const foldUe = s => fold(s).replace(/ue/g, 'u').replace(/oe/g, 'o').replace(/ae/g, 'a');
  const words = s => fold(s).split(' ').filter(Boolean);

  /* ------------------------------------------------------- the dictionary */

  let DICT = [];                 // [{ value, type, count }]
  let BY_KEY = new Map();        // fold(value) -> entry
  let BY_KEY_UE = new Map();     // foldUe(value) -> entry
  let PHRASES = [];              // Programme + Bachelor entries with 2+ words, longest first
  let SINGLE_BACHELOR = [];      // one-word Bachelor entries
  let PHRASE_BY_FIRST = new Map();

  /* A few the sheet does not carry but the finder does. */
  const EXTRA = [{ value: 'MBA', type: 'Degree', count: 0 }, { value: 'MEng', type: 'Degree', count: 0 }];

  function load(list) {
    const seen = new Map();
    (Array.isArray(list) ? list : []).concat(EXTRA).forEach(e => {
      if (!e) return;
      const value = String(Array.isArray(e) ? e[0] : e.value || '').trim();
      const type = String(Array.isArray(e) ? e[1] : e.type || '').trim();
      const count = Number(Array.isArray(e) ? e[2] : e.count) || 0;
      if (!value || !type) return;
      const k = fold(value);
      if (!k) return;
      /* k and ku: the folded forms, worked out once — derive() and suggest()
         walk the whole list and folding 3,700 values per call was 4ms a row. */
      if (!seen.has(k)) seen.set(k, { value, type, count, k, ku: foldUe(value) });
      else if (count > seen.get(k).count) seen.set(k, { value, type, count, k, ku: foldUe(value) });
    });
    DICT = [...seen.values()];
    BY_KEY = new Map(DICT.map(e => [e.k, e]));
    BY_KEY_UE = new Map(DICT.map(e => [e.ku, e]));
    PHRASES = DICT.filter(e => (e.type === 'Programme' || e.type === 'Bachelor') && e.k.includes(' '))
      .sort((a, b) => b.k.length - a.k.length);
    /* By first word, so a title is checked against the phrases that could
       be in it rather than against all of them. */
    PHRASE_BY_FIRST = new Map();
    PHRASES.forEach(e => { const w = e.k.split(' ')[0]; if (!PHRASE_BY_FIRST.has(w)) PHRASE_BY_FIRST.set(w, []); PHRASE_BY_FIRST.get(w).push(e); });
    SINGLE_BACHELOR = DICT.filter(e => e.type === 'Bachelor' && !e.k.includes(' '));
    return DICT.length;
  }
  const loaded = () => DICT.length > 0;
  const dictionary = () => DICT;
  /** The dictionary's entry for a value, or null. */
  const lookup = v => BY_KEY.get(fold(v)) || BY_KEY_UE.get(foldUe(v)) || null;
  /** The type of a value: the dictionary's, or a guess from its shape. */
  function typeOf(v) {
    const e = lookup(v);
    if (e) return e.type;
    const s = String(v || '');
    if (/^(winter|summer) deadline /i.test(s)) return 'Deadline';
    if (/^(winter|summer)$/i.test(s)) return 'Intake';
    if (/^(english|german) [abc][12]$/i.test(s) || /^no german required$/i.test(s)) return 'Language';
    if (/^(public|private) university$/i.test(s) || /^no tuition fee$/i.test(s)) return 'Feature';
    return '';
  }

  if (isNode) {
    try {
      const fs = require('fs'), path = require('path');
      load(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'tags-de.json'), 'utf8')));
    } catch (e) { /* no dictionary: derive() still works, suggest() answers from the catalogue only */ }
  }

  /* ------------------------------------------------------------ derive() */

  const STOP = new Set(['of', 'the', 'and', 'in', 'for', 'with', 'on', 'at', 'to', 'a', 'an', 'der', 'die', 'das', 'und',
    'fur', 'im', 'von', 'de', 'm', 'sc', 'msc', 'ma', 'meng', 'mba', 'llm', 'ba', 'bsc', 'beng', 'master', 'masters',
    'bachelor', 'bachelors', 'programme', 'program', 'degree', 'studies', 'study', 'or', 'any', 'closely', 'related',
    'e', 'g', 'etc']);
  const DEGREES = [[/\bm\.?\s?sc\.?\b/i, 'MSc'], [/\bm\.?\s?eng\.?\b/i, 'MEng'], [/\bmba\b/i, 'MBA'], [/\bll\.?\s?m\.?\b/i, 'LLM'],
    [/\bm\.?\s?p\.?\s?h\.?\b/i, 'MPH'], [/\bmfa\b/i, 'MFA'], [/\bmpa\b/i, 'MPA'], [/\bmpp\b/i, 'MPP'], [/\bm\.?\s?a\.?\b(?![a-z])/i, 'MA']];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const num = v => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const cap = s => String(s || '').replace(/\b\w/g, c => c.toUpperCase());

  /* Dictionary phrases (2+ words) that sit inside a text, whole words only. */
  function phrasesIn(text, types) {
    const f = ' ' + fold(text) + ' ';
    if (f.trim().length < 3) return [];
    const out = [];
    const seenW = new Set();
    for (const w of f.trim().split(' ')) {
      if (seenW.has(w)) continue;
      seenW.add(w);
      const cands = PHRASE_BY_FIRST.get(w);
      if (!cands) continue;
      for (const e of cands) {
        if (types && !types.includes(e.type)) continue;
        if (f.includes(' ' + e.k + ' ')) out.push(e.value);
      }
    }
    return out;
  }

  /**
   * The tags a row would carry had the office written them: worked out from
   * what the row says about itself. Every rule is listed in the header.
   */
  function derive(p) {
    if (!p) return [];
    const r = p.reqs && typeof p.reqs === 'object' ? p.reqs : {};
    const out = [];
    const add = v => { const s = String(v == null ? '' : v).trim(); if (s) out.push(s); };
    const title = String(p.program || '');
    /* The facts first — they are what a screen shows when it shows the first
       few — then who and where, then what the title says. */
    /* The degree, from the title, else the level. */
    let deg = '';
    for (const [re, d] of DEGREES) { if (re.test(title)) { deg = d; break; } }
    if (!deg && String(p.level || '').toLowerCase() === 'mba') deg = 'MBA';
    add(deg);
    /* Public or private; tuition. */
    add(p.isPublic ? 'Public University' : (p.university || p.id ? 'Private University' : ''));
    const tu = num(r.tuitionEurSem);
    if (tu === 0 || (p.isPublic && (Number(p.totalInr || 0) === 0 || p.freeTuition === true))) add('No Tuition Fee');
    /* What it asks for. */
    if (r.moiAccepted === true) add('MOI Accepted');
    if (r.greRequired === true || (r.greRequired !== false && num(r.greMin) != null)) add('GRE');
    else if (r.greRequired === false && (num(r.greMin) != null || num(r.greQuant) != null)) add('GRE Recommended / Optional');
    if (r.workExpRequired === true || (num(r.workExpMonths) || 0) > 0) add('Work Experience');
    if (r.papersRequired === true) add('Publications');
    const by = num(r.bachelorYears), ects = num(r.ectsMin);
    if ((by != null && by <= 3) || (ects != null && ects <= 180)) add('3-Year Bachelor Accepted');
    const gl = String(r.germanLevel || '').trim();
    if (!gl || /^none$/i.test(gl)) add('No German Required'); else add('German ' + gl.toUpperCase());
    const ielts = num(r.ieltsMin), toefl = num(r.toeflMin);
    if ((ielts != null && ielts >= 7) || (toefl != null && toefl >= 95)) add('English C1');
    else if ((ielts != null && ielts >= 5.5) || (toefl != null && toefl >= 72)) add('English B2');
    if (r.restricted === true) add('Restricted Admission');
    /* Intakes and their deadline months. */
    const seasons = new Set();
    (p.intakes || []).forEach(i => {
      if (!i) return;
      const se = /summer|spring/i.test(String(i.season || '')) ? 'Summer' : 'Winter';
      seasons.add(se);
      const m = /^\d{4}-(\d{2})-\d{2}/.exec(String(i.deadline || ''));
      if (m && MONTHS[Number(m[1]) - 1]) add(se + ' Deadline ' + MONTHS[Number(m[1]) - 1]);
    });
    seasons.forEach(add);
    /* Who and where — stripped again for a locked public row (publicTags). */
    add(p.shortName); add(p.university); add(p.city);
    if (p.field) add(p.field);
    /* The dictionary phrases in the title, its words, and the title itself. */
    phrasesIn(title).forEach(add);
    words(title).forEach(w => { if (!STOP.has(w) && w.length > 1) add(cap(w)); });
    add(title);
    /* The bachelor's it wants: dictionary subjects named in the text. */
    const bs = String(r.bachelorSubjects || '');
    if (bs) {
      phrasesIn(bs, ['Bachelor']).forEach(add);
      const bw = ' ' + fold(bs) + ' ';
      SINGLE_BACHELOR.forEach(e => { if (bw.includes(' ' + e.k + ' ')) add(e.value); });
    }
    /* De-duplicated, first spelling kept. */
    const seen = new Set(), uniq = [];
    out.forEach(t => { const k = fold(t); if (k && !seen.has(k)) { seen.add(k); uniq.push(t); } });
    return uniq;
  }

  /** The row's stored tags when the office has written any, else derive(). */
  function tagsOf(p) {
    if (!p) return [];
    const stored = Array.isArray(p.tags) ? p.tags : String(p.tags || '').split(';');
    const list = stored.map(t => String(t == null ? '' : t).trim()).filter(Boolean);
    return list.length ? list : derive(p);
  }

  /** tagsOf() less anything that would name the university — for a locked row. */
  function publicTags(p) {
    /* The exact title goes too: /api/catalogue withholds it on a locked row
       (only its length travels), and a tag that IS the title would hand it
       back. Its words and the dictionary phrases in it stay — "Data" says
       what the row is about, not which university it is. */
    const own = new Set([p.university, p.shortName, p.city, p.program].map(fold).filter(Boolean));
    return tagsOf(p).filter(t => !IDENTITY.includes(typeOf(t)) && !own.has(fold(t)));
  }

  /* ----------------------------------------------------------- suggest() */

  /**
   * Dictionary entries for what somebody typed: a value that starts with
   * it, then one with a word that starts with it, then one that merely
   * contains it; within a rank, the most-used first. `types` narrows to
   * some types; `limit` caps the whole list (default 24) and `perType` each
   * type (default 8), so a common word does not fill the box with
   * programme titles and leave no room for "No German Required".
   */
  function suggest(q, o) {
    const opt = o || {};
    const f = fold(q), fu = foldUe(q);
    if (!f) return [];
    const limit = Math.max(1, Math.min(100, Number(opt.limit) || 24));
    const perType = Math.max(1, Math.min(100, Number(opt.perType) || 8));
    const types = Array.isArray(opt.types) && opt.types.length ? opt.types : null;
    const qWords = f.split(' ');
    const ranked = [];
    for (const e of DICT) {
      if (types && !types.includes(e.type)) continue;
      const v = e.k, vu = e.ku;
      let rank = 0;
      if (v.startsWith(f) || vu.startsWith(fu)) rank = 3;
      else if ((' ' + v).includes(' ' + f) || (' ' + vu).includes(' ' + fu)) rank = 2;
      else if (v.includes(f) || vu.includes(fu)) rank = 1;
      else if (qWords.length > 1 && qWords.every(w => (' ' + v + ' ').includes(' ' + w))) rank = 1;
      if (rank) ranked.push({ e, rank });
    }
    ranked.sort((a, b) => b.rank - a.rank || b.e.count - a.e.count || a.e.value.localeCompare(b.e.value));
    const per = {}, out = [];
    for (const { e } of ranked) {
      per[e.type] = (per[e.type] || 0) + 1;
      if (per[e.type] > perType) continue;
      out.push({ value: e.value, type: e.type, count: e.count });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** A flat suggestion list as [{ type, items }] in dictionary type order. */
  function group(list) {
    const by = new Map();
    (list || []).forEach(s => { if (!by.has(s.type)) by.set(s.type, []); by.get(s.type).push(s); });
    const order = TYPES.concat([...by.keys()].filter(t => !TYPES.includes(t)));
    return order.filter(t => by.has(t)).map(t => ({ type: t, items: by.get(t) }));
  }

  /* ------------------------------------------------------------- match() */

  const nameText = p => [p.program, p.university, p.shortName, p.city, p.field].map(s => String(s || '')).join(' ');

  /* One chosen tag against a row: in its tags, or — a phrase — sitting whole
     inside its name, university or city. */
  function hasTag(p, tag, tagKeys, hay) {
    const k = fold(tag);
    if (!k) return true;
    if (tagKeys.has(k) || tagKeys.has(foldUe(tag))) return true;
    return hay.includes(' ' + k + ' ');
  }

  /**
   * True when every chosen tag is on the row and every word of the free
   * text hits a tag or the programme's, university's or city's name.
   * `tags` is a list or a ';'-joined string; `text` is what was typed.
   */
  function match(p, tags, text) {
    const list = (Array.isArray(tags) ? tags : String(tags || '').split(';')).map(t => String(t == null ? '' : t).trim()).filter(Boolean);
    const q = words(text);
    if (!list.length && !q.length) return true;
    const own = tagsOf(p);
    const tagKeys = new Set();
    own.forEach(t => { tagKeys.add(fold(t)); tagKeys.add(foldUe(t)); });
    const hay = ' ' + fold(nameText(p)) + ' ';
    const hayUe = ' ' + foldUe(nameText(p)) + ' ';
    for (const t of list) if (!hasTag(p, t, tagKeys, hay)) return false;
    if (q.length) {
      const tagText = ' ' + own.map(fold).join(' ') + ' ' + own.map(foldUe).join(' ') + ' ';
      for (const w of q) {
        const wu = foldUe(w);
        if (!(hay.includes(w) || hayUe.includes(wu) || tagText.includes(w) || tagText.includes(wu))) return false;
      }
    }
    return true;
  }

  /**
   * How well a row answers the search, for ordering: a tag hit in the stored
   * or derived tags counts 2, a free-text word in the programme title 2, in
   * the university or city 1. Rows match() refused score 0.
   */
  function score(p, tags, text) {
    if (!match(p, tags, text)) return 0;
    const list = (Array.isArray(tags) ? tags : String(tags || '').split(';')).map(t => String(t == null ? '' : t).trim()).filter(Boolean);
    const own = new Set(tagsOf(p).map(fold));
    let s = 0;
    list.forEach(t => { s += own.has(fold(t)) ? 2 : 1; });
    const title = ' ' + fold(p.program) + ' ', rest = ' ' + fold([p.university, p.shortName, p.city].join(' ')) + ' ';
    words(text).forEach(w => { if (title.includes(w)) s += 2; else if (rest.includes(w)) s += 1; });
    return s;
  }

  /* The list form of a ';'-joined address value, trimmed and de-duplicated. */
  function parseList(v) {
    const seen = new Set(), out = [];
    (Array.isArray(v) ? v : String(v || '').split(';')).forEach(t => {
      const s = String(t == null ? '' : t).trim().slice(0, 60);
      const k = fold(s);
      if (s && k && !seen.has(k)) { seen.add(k); out.push(s); }
    });
    return out.slice(0, 60);
  }

  return { TYPES, IDENTITY, load, loaded, dictionary, lookup, typeOf, derive, tagsOf, publicTags, suggest, group, match, score, parseList, fold };
});
