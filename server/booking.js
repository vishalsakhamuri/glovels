'use strict';
/*
 * Patch 206: BOOK A CALL.
 *
 * "Can a user book an appointment on the website? They should be able to
 *  schedule a call with the counsellor. We can show them 3 to 4 slots during
 *  9 to 12 CET, which is afternoon time in India." — Vishal, 1 Nov
 *
 * The office works on Central European time; the visitor sees each slot in
 * their own (09:00 CET is 13:30 in India in winter, 12:30 in summer — the
 * clocks are worked out per date, never assumed). A slot holds `capacity`
 * calls; when it is full it is shown as taken, and a booking that arrives
 * after it filled is refused with a sentence, not double-booked.
 *
 * Everything an administrator might change lives in one content key,
 * `booking`: the time zone, the start times, the call length, the working
 * days, how many working days ahead are offered, calls per slot, the notice
 * needed, and closed dates (holidays).
 */

const DEFAULTS = {
  on: true,
  tz: 'Europe/Berlin',
  times: ['09:00', '09:45', '10:30', '11:15'],
  minutes: 30,
  days: [1, 2, 3, 4, 5],          // Monday … Friday (0 = Sunday)
  ahead: 5,                       // working days offered
  capacity: 1,                    // calls per slot
  noticeHours: 3,
  closed: [],                     // 'YYYY-MM-DD'
};

function settingsOf(raw) {
  const s = Object.assign({}, DEFAULTS, raw || {});
  s.times = (Array.isArray(s.times) ? s.times : String(s.times || '').split(','))
    .map(t => String(t).trim()).filter(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))
    .filter((t, i, a) => a.indexOf(t) === i).sort().slice(0, 12);
  if (!s.times.length) s.times = DEFAULTS.times.slice();
  s.days = (Array.isArray(s.days) ? s.days : []).map(Number).filter(d => d >= 0 && d <= 6);
  if (!s.days.length) s.days = DEFAULTS.days.slice();
  s.minutes = Math.max(10, Math.min(120, Number(s.minutes) || 30));
  s.ahead = Math.max(1, Math.min(20, Number(s.ahead) || 5));
  s.capacity = Math.max(1, Math.min(20, Number(s.capacity) || 1));
  s.noticeHours = Math.max(0, Math.min(72, Number(s.noticeHours) || 0));
  s.closed = (Array.isArray(s.closed) ? s.closed : String(s.closed || '').split(','))
    .map(d => String(d).trim()).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 120);
  try { new Intl.DateTimeFormat('en', { timeZone: s.tz }); } catch (e) { s.tz = DEFAULTS.tz; }
  s.on = s.on !== false;
  return s;
}

/* The wall-clock parts of an instant in a zone. */
function partsIn(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
  const o = {};
  f.formatToParts(new Date(ms)).forEach(p => { o[p.type] = p.value; });
  return o;
}
const offsetAt = (ms, tz) => {
  const p = partsIn(ms, tz);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
};
/** 'YYYY-MM-DD' + 'HH:MM' on the wall clock of `tz` → the instant (ms). */
function zoned(date, hhmm, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - offsetAt(guess, tz);
  t = guess - offsetAt(t, tz);           // again, across a clock change
  return t;
}
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * The slots to offer from `nowMs`: `ahead` working days, each with its times,
 * each free or not. `taken(iso)` says how many calls a slot already holds.
 */
function slots(set, nowMs, taken) {
  const s = settingsOf(set);
  const out = [];
  if (!s.on) return { on: false, tz: s.tz, minutes: s.minutes, days: [] };
  const today = partsIn(nowMs, s.tz);
  let y = +today.year, mo = +today.month, d = +today.day;
  for (let i = 0; i < 40 && out.length < s.ahead; i++) {
    const date = new Date(Date.UTC(y, mo - 1, d + i)).toISOString().slice(0, 10);
    const noon = zoned(date, '12:00', s.tz);
    const wd = WD[partsIn(noon, s.tz).weekday];
    if (!s.days.includes(wd) || s.closed.includes(date)) continue;
    const list = s.times.map(t => {
      const at = zoned(date, t, s.tz);
      const iso = new Date(at).toISOString();
      const held = taken ? taken(iso) : 0;
      return { at: iso, local: t, free: at - nowMs >= s.noticeHours * 3600000 && held < s.capacity };
    });
    if (i === 0 && !list.some(x => x.free)) continue;   // nothing left today: start tomorrow
    out.push({ date, weekday: wd, slots: list });
  }
  return { on: true, tz: s.tz, minutes: s.minutes, days: out };
}

/** Is `iso` one of the slots offered right now, and still free? */
function check(set, nowMs, taken, iso) {
  const all = slots(set, nowMs, taken);
  for (const day of all.days) for (const x of day.slots) if (x.at === iso) return x.free ? { ok: true, slot: x } : { ok: false, why: 'taken' };
  return { ok: false, why: 'unknown' };
}

/** "Tue 4 Nov, 13:30" in a zone, for emails and notes. */
function say(iso, tz, opts) {
  try {
    return new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: tz, weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, opts || {})).format(new Date(iso));
  } catch (e) { return iso; }
}

module.exports = { DEFAULTS, settingsOf, slots, check, zoned, say };
