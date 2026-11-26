'use strict';
/*
 * LONG WORK OFF THE WEB SERVER'S THREAD (patch 316, after the outage of 26 Nov).
 *
 * WHAT HAPPENED. A counsellor chose a tag chip in a student's file with no
 * word typed. The server read all 70,000 programmes and worked out each
 * one's tags — ten seconds, on the one thread that also answers every
 * visitor. She clicked again; four of those in a row, the host's health
 * check got no answer, and the host restarted the site. The fit test did
 * the same in four-to-five-second pieces. A bigger machine does not help:
 * the thread was not short of power, it was busy.
 *
 * THE RULE NOW. Work that reads the whole catalogue is done by a second
 * reader on its own thread (server/heavywork.js). The web server hands the
 * question over and goes on answering; the answer comes back when it is
 * ready. One piece at a time, the same question asked twice is worked once,
 * and an answer is remembered for two minutes.
 *
 * WHEN THE SECOND READER IS NOT THERE. On the file-based store the tests
 * fall back to, or with HEAVY=inline, the work is done where it always was.
 * If the reader fails on a big catalogue the screen is told "busy, try
 * again" — the work is NOT brought back onto the web server's thread, because
 * that is the outage.
 */
const path = require('path');
const crypto = require('crypto');

function open({ file, aliases, log }) {
  const say = typeof log === 'function' ? log : () => {};
  const forced = String(process.env.HEAVY || '').toLowerCase();
  let Worker = null;
  try { Worker = require('worker_threads').Worker; } catch (e) { Worker = null; }
  const possible = !!file && !!Worker && forced !== 'inline' && forced !== 'off';
  let w = null, seq = 0, deaths = [], offUntil = 0;
  const waiting = new Map();          // id -> { resolve, reject, timer }

  const fail = why => {
    for (const [, j] of waiting) { clearTimeout(j.timer); j.reject(new Error(why)); }
    waiting.clear();
  };
  const died = why => {
    w = null;
    fail(why);
    const now = Date.now();
    deaths = deaths.filter(t => now - t < 5 * 60000); deaths.push(now);
    /* Three times in five minutes: left alone for a minute rather than
       started over and over. */
    if (deaths.length >= 3) { offUntil = now + 60000; deaths = []; }
    say('heavy  the second reader stopped (' + why + ')' + (offUntil > now ? ' — resting for a minute' : ''));
  };
  const start = () => {
    if (w || !possible || Date.now() < offUntil) return w;
    try {
      const mine = new Worker(path.join(__dirname, 'heavywork.js'), { workerData: { file, aliases: aliases || [] } });
      mine.on('message', m => {
        const j = waiting.get(m && m.id);
        if (!j) return;
        waiting.delete(m.id); clearTimeout(j.timer);
        if (m.ok) j.resolve(m.result); else j.reject(new Error(m.error || 'failed'));
      });
      mine.on('error', e => { if (w === mine) died(String((e && e.message) || e)); });
      mine.on('exit', code => { if (w === mine) died('exit ' + code); });
      mine.unref();
      w = mine;
    } catch (e) { died(String((e && e.message) || e)); }
    return w;
  };

  /* One job, answered or refused. */
  const run = (job, timeoutMs) => new Promise((resolve, reject) => {
    const mine = start();
    if (!mine) return reject(new Error('not running'));
    const id = ++seq;
    const timer = setTimeout(() => {
      if (!waiting.has(id)) return;
      /* A job that has not answered in this long is stuck: the reader is
         replaced, and everything waiting on it is told so. */
      const stuck = w; w = null;
      try { if (stuck) stuck.terminate(); } catch (e) { /* gone already */ }
      fail('took too long');
      say('heavy  a job took more than ' + Math.round((timeoutMs || 90000) / 1000) + ' s and was stopped');
    }, timeoutMs || 90000);
    if (timer.unref) timer.unref();
    waiting.set(id, { resolve, reject, timer });
    try { mine.postMessage({ id, job }); }
    catch (e) { waiting.delete(id); clearTimeout(timer); reject(e); }
  });

  /* The same question, asked again inside `ttl`, is not worked again — and
     asked while it is still being worked, waits for the one answer. */
  const answers = new Map();          // key -> { at, value } | { promise }
  const keyOf = x => crypto.createHash('sha1').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('base64');
  const cached = (keyParts, ttl, make) => {
    const k = keyOf(keyParts), now = Date.now();
    const had = answers.get(k);
    if (had && had.promise) return had.promise;
    if (had && now - had.at < ttl) return Promise.resolve(had.value);
    const promise = Promise.resolve().then(make).then(value => {
      answers.set(k, { at: Date.now(), value });
      if (answers.size > 60) { const oldest = [...answers.entries()].filter(e => !e[1].promise).sort((a, b) => a[1].at - b[1].at)[0]; if (oldest) answers.delete(oldest[0]); }
      return value;
    }, err => { answers.delete(k); throw err; });
    answers.set(k, { promise });
    return promise;
  };

  return {
    /** Whether long work can be handed over at all (false: the file store, or HEAVY=inline). */
    possible,
    run, cached,
    waiting: () => waiting.size,
    stop: () => { const mine = w; w = null; fail('stopping'); try { if (mine) mine.terminate(); } catch (e) { /* gone */ } },
  };
}

module.exports = { open };
