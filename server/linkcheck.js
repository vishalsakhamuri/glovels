'use strict';
/*
 * ARE THE COURSE LINKS STILL THERE?
 *
 * 1,719 German rows carry a link to the university's own course page, and a
 * student presses it to decide. Nothing had ever checked one: the office has
 * no time to open two thousand pages, and the tools that built the catalogue
 * could not reach the university sites at all. The server can — it is the one
 * machine in this story on the open internet — so it does, in the background,
 * politely, and keeps the answer until somebody downloads it.
 *
 * WHAT EACH ANSWER MEANS
 *   ok         the page answered, and it is still a page, not the front door
 *   home       it answered — by sending us to the university's home page. The
 *              course page is gone; the site just doesn't say 404
 *   dead       404 / 410, or the address no longer exists
 *   blocked    401 / 403 / 429 — the site refuses robots. Probably fine; a
 *              person has to look
 *   error      a 5xx, a timeout or a broken certificate. Try again later
 *   bad        not an http(s) address at all
 *
 * POLITE: a handful at a time, never two to the same university at once, a
 * short pause between requests to one host, a real user-agent that says who
 * we are, and the body is not downloaded — the status and where it ended up
 * are all we need.
 *
 * NOT A PROXY: it only ever fetches the addresses already in the catalogue,
 * never one somebody hands it, and it refuses anything that resolves to a
 * private address, so it cannot be pointed at the server's own network.
 */
const dns = require('node:dns').promises;
const net = require('node:net');

const UA = 'Mozilla/5.0 (compatible; GlovelsLinkCheck/1.0; +https://glovels.com)';
const TIMEOUT_MS = 15000;
const CONCURRENCY = 8;
const PER_HOST_GAP_MS = 700;

const PRIVATE = [
  /^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./,
  /^::1$/, /^fc/i, /^fd/i, /^fe80:/i, /^::ffff:(10|127|192\.168|169\.254)\./i,
];
const isPrivate = ip => PRIVATE.some(re => re.test(ip));

let job = null;   // { id, startedAt, finishedAt, total, done, results: [], running }

/* The front door of a site: "/", "/en", "/en/", "/index.html", "/de/home". */
function isHome(u) {
  try {
    const p = new URL(u).pathname.replace(/\/+$/, '').toLowerCase();
    return p === '' || /^\/(en|de|english|deutsch|home|index(\.html?|\.php)?|en\/home|de\/home|start(seite)?)$/.test(p);
  } catch (e) { return false; }
}

async function checkOne(url, allowLocal) {
  const out = { url, status: 0, finalUrl: '', verdict: 'error', note: '' };
  let u;
  try { u = new URL(url); } catch (e) { out.verdict = 'bad'; out.note = 'not an address'; return out; }
  if (!/^https?:$/.test(u.protocol)) { out.verdict = 'bad'; out.note = 'not http(s)'; return out; }
  if (!allowLocal) {
    try {
      const addrs = net.isIP(u.hostname) ? [{ address: u.hostname }] : await dns.lookup(u.hostname, { all: true });
      if (addrs.some(a => isPrivate(a.address))) { out.verdict = 'bad'; out.note = 'private address'; return out; }
    } catch (e) { out.verdict = 'dead'; out.note = 'address does not exist (' + (e.code || 'dns') + ')'; return out; }
  }
  const tryFetch = async method => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(url, { method, redirect: 'follow', signal: ac.signal,
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en,de;q=0.8' } });
      try { if (r.body) await r.body.cancel(); } catch (e) { /* already closed */ }
      return r;
    } finally { clearTimeout(t); }
  };
  try {
    /* HEAD first — cheap — but plenty of university servers answer HEAD with
       403 or 405 while serving the page happily, so anything but a 2xx/404
       is asked again with a GET before it is believed. */
    let r = await tryFetch('HEAD');
    if (!(r.status >= 200 && r.status < 300) && r.status !== 404 && r.status !== 410) r = await tryFetch('GET');
    out.status = r.status; out.finalUrl = r.url || url;
    if (r.status === 404 || r.status === 410) { out.verdict = 'dead'; out.note = String(r.status); }
    else if (r.status === 401 || r.status === 403 || r.status === 429) { out.verdict = 'blocked'; out.note = 'the site refuses robots (' + r.status + ')'; }
    else if (r.status >= 500) { out.verdict = 'error'; out.note = 'server error ' + r.status; }
    else if (r.status >= 200 && r.status < 400) {
      if (!isHome(url) && isHome(out.finalUrl)) { out.verdict = 'home'; out.note = 'sends you to the home page'; }
      else { out.verdict = 'ok'; if (out.finalUrl !== url) out.note = 'moved'; }
    } else { out.verdict = 'error'; out.note = 'status ' + r.status; }
  } catch (e) {
    const c = (e && e.cause && e.cause.code) || (e && e.code) || '';
    if (e && e.name === 'AbortError') { out.verdict = 'error'; out.note = 'timed out'; }
    else if (/ENOTFOUND|EAI_AGAIN/.test(c)) { out.verdict = 'dead'; out.note = 'address does not exist'; }
    else if (/CERT|SSL|TLS/i.test(c)) { out.verdict = 'error'; out.note = 'certificate problem'; }
    else { out.verdict = 'error'; out.note = (c || (e && e.message) || 'failed').slice(0, 60); }
  }
  return out;
}

/*
 * Start a run over `rows` ([{id, program, university, url}]). One run at a
 * time: asking again while one is going returns the one that is going.
 */
function start(rows, opts = {}) {
  if (job && job.running) return job;
  const list = rows.filter(r => String(r.url || '').trim());
  job = { id: Date.now().toString(36), startedAt: new Date().toISOString(), finishedAt: null,
    total: list.length, done: 0, running: true, scope: opts.scope || '', results: [] };
  const mine = job;
  const hostBusy = new Map();   // host -> time it is free again
  let next = 0;
  const hostOf = u => { try { return new URL(u).hostname; } catch (e) { return ''; } };
  const worker = async () => {
    while (mine.running) {
      /* The next row whose university is not already being asked. */
      let pick = -1;
      const now = Date.now();
      for (let i = next; i < list.length && i < next + 60; i++) {
        if (list[i] && !list[i]._taken && (hostBusy.get(hostOf(list[i].url)) || 0) <= now) { pick = i; break; }
      }
      if (pick < 0) {
        if (next >= list.length) return;
        await new Promise(r => setTimeout(r, 150));
        while (next < list.length && list[next]._taken) next++;
        continue;
      }
      const row = list[pick]; row._taken = true;
      const host = hostOf(row.url);
      hostBusy.set(host, Infinity);
      const res = await checkOne(String(row.url).trim(), !!opts.allowLocal);
      hostBusy.set(host, Date.now() + PER_HOST_GAP_MS);
      mine.results.push(Object.assign({ id: row.id, program: row.program, university: row.university }, res));
      mine.done++;
      while (next < list.length && list[next]._taken) next++;
    }
  };
  Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length || 1) }, worker))
    .then(() => { mine.running = false; mine.finishedAt = new Date().toISOString(); list.forEach(r => delete r._taken); });
  return job;
}

function status() {
  if (!job) return { running: false, total: 0, done: 0 };
  const counts = {};
  job.results.forEach(r => { counts[r.verdict] = (counts[r.verdict] || 0) + 1; });
  return { id: job.id, running: job.running, startedAt: job.startedAt, finishedAt: job.finishedAt,
    scope: job.scope, total: job.total, done: job.done, counts };
}

const results = () => (job ? job.results.slice() : []);
function stop() { if (job) job.running = false; }

module.exports = { start, status, results, stop, checkOne, isHome };
