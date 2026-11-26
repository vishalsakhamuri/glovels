'use strict';
/*
 * THE SECOND READER — the long sums, on a thread of their own.
 *
 * Started by server/heavy.js. It opens the same database file, to read only,
 * and does the two pieces of work that are too long for the web server's one
 * thread at 70,000 programmes:
 *
 *   tags  — which programmes carry the chosen tags (a tag is partly worked
 *           out from the row, so the database cannot be asked)
 *   fit   — which programmes fit a student
 *
 * While it works, the web server goes on answering everybody else. Nothing
 * here writes anything.
 */
const { parentPort, workerData } = require('worker_threads');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const UNIS = require('./unis.js');
const TAGS = require('./tags.js');
const FITCORE = require('./fitcore.js');

try { TAGS.setAliases(workerData.aliases || []); } catch (e) { /* names stay separate */ }

let conn = null;
const db = () => {
  if (conn) return conn;
  try { conn = new DatabaseSync(workerData.file, { readOnly: true }); }
  catch (e) { conn = new DatabaseSync(workerData.file); }
  try { conn.exec('PRAGMA busy_timeout = 5000'); conn.exec('PRAGMA query_only = 1'); } catch (e) { /* older build: it only ever reads */ }
  return conn;
};
const all = (sql, ...a) => db().prepare(sql).all(...a);

/* ---------------------------------------------------------------- tags */

/* What match() needs of each programme (TAGS.prep), kept by id. A row is
   worked out again only when it has changed: `fp` is a fingerprint of the
   whole row, so any write to it — whichever column, with or without a new
   updated_at — is seen. */
const index = new Map();
let indexV = null;
const fingerprint = r => {
  const h = crypto.createHash('md5');
  for (const k in r) { const v = r[k]; h.update(v == null ? '\u0000' : String(v)); h.update('\u0001'); }
  return h.digest('base64');
};
const entryOf = (r, fp) => { const e = TAGS.prep(UNIS.fromRow(r)); e.fp = fp || fingerprint(r); return e; };
function ensureIndex(v) {
  if (indexV !== null && indexV === v) return { built: 0, kept: index.size };
  let last = 0, built = 0, kept = 0;
  const seen = new Set();
  for (;;) {
    const rows = all('SELECT rowid AS _rid, * FROM programmes WHERE rowid > ? ORDER BY rowid LIMIT 2000', last);
    for (const r of rows) {
      last = r._rid; delete r._rid;
      const id = String(r.id);
      seen.add(id);
      const fp = fingerprint(r);
      const had = index.get(id);
      if (had && had.fp === fp) { kept++; continue; }
      index.set(id, entryOf(r, fp)); built++;
    }
    if (rows.length < 2000) break;
  }
  if (seen.size !== index.size) for (const id of [...index.keys()]) if (!seen.has(id)) index.delete(id);
  indexV = v;
  return { built, kept };
}

function tags(job) {
  ensureIndex(job.v);
  const test = TAGS.matcher(job.tags);
  const ids = all('SELECT id FROM programmes WHERE ' + job.where + ' ORDER BY ' + job.order, ...(job.params || []));
  const from = Number(job.from) || 0, to = Number(job.to) || 0, keep = Number(job.keep) || 0;
  let total = 0; const page = [], first = [];
  for (const r of ids) {
    const id = String(r.id);
    let e = index.get(id);
    if (!e) {   /* saved since the index was read: looked at on its own */
      const row = db().prepare('SELECT * FROM programmes WHERE id = ?').get(id);
      if (!row) continue;
      e = entryOf(row); index.set(id, e);
    }
    if (!test(e)) continue;
    if (total >= from && total < to) page.push(id);
    if (keep && first.length < keep) first.push(id);
    total++;
  }
  return { total, page, ids: first };
}

/* ----------------------------------------------------------------- fit */

/* The rows, as store.rowsForCountries / rowsOnSite read them — the same
   statements, so the same rows in the same order. */
function rowsFor(spec) {
  const cs = [...new Set((spec.countries || []).map(c => String(c || '').toUpperCase()).filter(Boolean))];
  const lv = Array.isArray(spec.levels) && spec.levels.length
    ? [...new Set(spec.levels.map(l => String(l || '').toLowerCase()).filter(Boolean))] : null;
  const w = ['active = 1']; const a = [];
  if (cs.length) { w.push('country IN (' + cs.map(() => '?').join(',') + ')'); a.push(...cs); }
  if (lv) { w.push('LOWER(level) IN (' + lv.map(() => '?').join(',') + ')'); a.push(...lv); }
  if (spec.onSite) w.push('search_only = 0');
  return all('SELECT * FROM programmes WHERE ' + w.join(' AND ') + (spec.onSite ? ' ORDER BY university' : ''), ...a);
}
function fit(job) {
  const cat = rowsFor(job.rows).map(UNIS.fromRow);
  return FITCORE.compute(cat, job.prof, job.opts, job.parts, job.countries);
}

/* The matcher's strict order for a student, per kind — what the office's
   hand-added rows are ranked against (api.js rankOfficeRows). Only what the
   ranking reads of each row is sent back. */
function rank(job) {
  const skip = new Set((job.dismissed || []).map(String));
  const cat = rowsFor(job.rows).map(UNIS.fromRow).filter(p => !skip.has(String(p.id)));
  const out = {};
  for (const kind of job.kinds || []) {
    let list = [];
    try { list = FITCORE.MATCHES.pick(cat, job.prof, 10000, kind, [], job.countries); } catch (e) { list = []; }
    out[kind] = list.map(p => ({ id: p.id, university: p.university, uKey: p.uKey, city: p.city, isPublic: !!p.isPublic }));
  }
  return out;
}

/* ---------------------------------------------------------------- jobs */

const JOBS = { tags, fit, rank, warm: job => ensureIndex(job.v), ping: () => ({ rows: (all('SELECT COUNT(*) AS n FROM programmes')[0] || {}).n || 0 }) };

parentPort.on('message', m => {
  const at = Date.now();
  try {
    const fn = JOBS[m && m.job && m.job.type];
    if (!fn) throw new Error('no such job');
    parentPort.postMessage({ id: m.id, ok: true, result: fn(m.job), ms: Date.now() - at });
  } catch (e) {
    parentPort.postMessage({ id: m.id, ok: false, error: String((e && e.message) || e), ms: Date.now() - at });
  }
});
