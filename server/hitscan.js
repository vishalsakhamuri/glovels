'use strict';
/*
 * Patch 307: reading the visits without stopping the server.
 *
 * 24 Nov 2026: the site went down twice in working hours. Render's health
 * check gives the server five seconds; the Traffic screen's numbers took 4.9
 * seconds for seven days on the live data, and the screen opens on thirty.
 * `traffic.summary` and `marketing.report` each read every visit of their
 * window in ONE query and counted the rows in one go — one piece of work on
 * a server that does one thing at a time, so for those seconds nobody else
 * was answered (300,000 rows held it for 2.9 s on a test machine).
 *
 * eachHit reads the same rows, in the same order, a slice of the table at a
 * time, and lets the server answer other people between slices. The numbers
 * are the same; the wait is the admin's alone.
 */

const SLICE = () => Math.max(200, Number(process.env.TRAFFIC_SLICE) || 4000);
const pause = () => new Promise(resolve => setImmediate(resolve));

/**
 * Call fn(row) for every visit on or after `since` of the given kinds, oldest
 * first. `lite` reads only id, day, kind and visitor (the "seen" beacons need
 * no more). Returns the number of rows read.
 */
async function eachHit(db, since, kinds, fn, lite) {
  const span = typeof db.hitsSpan === 'function' ? db.hitsSpan(since) : null;
  if (!span) {
    /* the JSON driver (tests): there is no table to slice */
    const rows = db.hitsSince(since, kinds);
    rows.forEach(fn);
    return rows.length;
  }
  if (span.a == null) return 0;
  const step = SLICE();
  let n = 0;
  for (let from = span.a; from <= span.b; from += step) {
    const rows = db.hitsSlice(from, from + step, since, kinds, lite);
    for (let i = 0; i < rows.length; i++) fn(rows[i]);
    n += rows.length;
    await pause();
  }
  return n;
}

/** The same for rows already in memory: fn(item) for each, with a pause
 *  every slice, so counting a long list does not hold the server either. */
async function eachOf(list, fn) {
  const step = SLICE();
  for (let i = 0; i < list.length; i++) {
    fn(list[i]);
    if ((i + 1) % step === 0) await pause();
  }
}

module.exports = { eachHit, eachOf };
