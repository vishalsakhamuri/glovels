'use strict';
/*
 * THE FIT TEST'S ARITHMETIC — one function, run wherever there is room.
 *
 * "Which programmes fit this student" reads every programme in the student's
 * countries and scores each one: four to five seconds at 70,000 programmes.
 * Run inside the web server it was four to five seconds in which the server
 * answered nobody (26 Nov, patch 316). It is kept here, apart from the
 * routes, so the same lines can be run on the reader's own thread
 * (server/heavywork.js) or, on a small catalogue, where they always were.
 */
const MATCHES = require('./matches.js');

/* `cat` — the catalogue rows (UNIS.fromRow), `prof` the profile with the
   screen's answers laid over it, `opts` the screen's filters, `parts` what
   the student is owed ([{kind, count, package}]), `countries` the country map. */
function compute(cat, prof, opts, parts, countries) {
  const found = MATCHES.screen(cat, prof, countries, opts);
  /* What the machine would deliver — the same call deliverMatches makes. */
  const auto = (parts || []).map(part => {
    const pl = MATCHES.plan(cat, prof, part.count, part.kind, countries);
    return { kind: part.kind, count: part.count, package: part.package || '',
      picks: pl.items.map(p => ({ id: p.id, program: p.program, university: p.university, totalInr: p.totalInr })),
      note: pl.note, short: pl.short };
  });
  return { profile: prof, usable: MATCHES.usable(prof), fits: found.fits, near: found.near,
    counts: found.counts, auto };
}

/* The rows a profile is matched against, as the store reads them
   (store.rowsForCountries / rowsOnSite) — said as data, so the other thread
   can ask the database the same question. */
function rowsSpec(profile) {
  const cs = (profile && profile.countries && profile.countries.length) ? profile.countries : null;
  const levels = MATCHES.levelsFor ? MATCHES.levelsFor(profile) : null;
  if (!cs) return { countries: [], levels: levels || null, onSite: true };
  return { countries: cs, levels: levels || null, onSite: false };
}

module.exports = { compute, rowsSpec };
