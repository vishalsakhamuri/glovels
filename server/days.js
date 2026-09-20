'use strict';
/**
 * What day it is, and how many days apart two days are.
 *
 * Every date in this application that a person agreed to — an application
 * deadline, the day a task is due — is a CALENDAR DAY, not a moment. "Due the
 * ninth" means the ninth in Hyderabad, where everybody reading these screens
 * works. It does not mean 23:59:59 UTC on the ninth, which is 05:29 on the
 * tenth to the person being told they are late.
 *
 * This existed as three slightly different calculations in three files, and
 * they disagreed:
 *
 *   tasks.js   rounded elapsed milliseconds from the due date at 23:59:59Z, so
 *              lateness flipped over at noon UTC rather than at midnight. A
 *              task due yesterday reported "0 days ago" for the first half of
 *              every day — including at the exact hour the sweep runs, so
 *              every overdue email understated the delay by a day.
 *   alerts.js  rounded from midnight UTC, so the 9am digest and the 10am
 *              sweep described the same task, in the same database, as one
 *              day late and zero days late respectively.
 *   both       treated zero as late, so a task due TODAY was chased.
 *
 * One definition, imported by both. A day difference is integer subtraction
 * of two calendar days, which is what everybody means by it and what nobody
 * gets wrong.
 */

/* Hyderabad. Not configurable, because a business with one office does not
   need a timezone setting, and one that grows a second office needs a real
   answer rather than a global. */
const IST_OFFSET = 5.5 * 3600 * 1000;
const DAY = 864e5;

/**
 * A moment, as milliseconds, from whatever a caller happens to be holding: a
 * number, a Date, or a string out of the database. Falls back to now rather
 * than to NaN, because every one of these functions is on a path that draws
 * a screen, and a screen that throws over one malformed timestamp is worse
 * than a screen showing today.
 */
function moment(t) {
  if (t == null) return Date.now();
  if (t instanceof Date) return t.getTime();
  if (typeof t === 'number') return Number.isFinite(t) ? t : Date.now();
  /* A blank is nothing, not a number. Number('') is 0, so an empty date
     went through the last line below as the first of January 1970 and came
     back as fifty-six years ago — a row with a blank date read as the most
     urgent thing in the office. Every other unusable value falls back to
     now; this one has to as well. */
  const raw = String(t).trim();
  if (!raw) return Date.now();
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return parsed;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Date.now();
}

/** The calendar day, in India, of a moment. 'YYYY-MM-DD'. */
function istDay(t) {
  return new Date(moment(t) + IST_OFFSET).toISOString().slice(0, 10);
}

/** The hour of the day, in India, of a moment. 0–23. */
function istHour(t) {
  return new Date(moment(t) + IST_OFFSET).getUTCHours();
}

/**
 * Whole days from day `from` to day `to`, both 'YYYY-MM-DD'.
 *
 * Positive means `to` is later. Both are read as plain calendar days at UTC
 * midnight — which is safe precisely BECAUSE neither carries a time: the
 * difference of two midnights is exact whatever the zone.
 */
function daysBetweenDays(from, to) {
  if (!from || !to) return null;
  const a = Date.parse(String(from).slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(String(to).slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY);
}

/**
 * How many days past its date something is, as of `now`.
 *
 *   negative  still to come
 *   0         due today — NOT late
 *   positive  that many days late
 *
 * The zero case is the one worth spelling out. A task due today is due today.
 * Telling somebody it is "0 days past the agreed date" on the morning it is
 * due is the screen picking a fight over work that is not yet owed, and it is
 * how people learn to stop reading the colour.
 */
function daysPast(dueDay, now) {
  if (!dueDay) return null;
  return daysBetweenDays(dueDay, istDay(now));
}

/** Is this due day actually past? Due today is not. */
const isPast = (dueDay, now) => {
  const n = daysPast(dueDay, now);
  return n != null && n > 0;
};

/**
 * `days` days after the calendar day of `from`.
 *
 * `from` may be a plain day ('2026-06-01') or a moment ('2026-06-01T20:00:00Z').
 * A moment is resolved to ITS INDIAN calendar day first — the distinction
 * matters and getting it wrong was a real bug: the first version tested
 * `from.slice(0,10)` against a date pattern, which an ISO timestamp also
 * matches, so a timestamp was read as a UTC day. A student who signed up at
 * 20:00 UTC — half past one in the morning in Hyderabad, an ordinary
 * overnight web signup — had their two-day welcome call dated from the day
 * before they existed, and was chased for it on day two of two.
 */
function addDays(from, days) {
  const raw = String(from == null ? '' : from);
  /* A plain day carries no time, so it is already a calendar day. Anything
     longer is a moment, and a moment has to be asked what day it is HERE. */
  const day = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : istDay(from);
  return new Date(Date.parse(day + 'T00:00:00Z') + Number(days) * DAY)
    .toISOString().slice(0, 10);
}

module.exports = { istDay, istHour, moment, daysBetweenDays, daysPast, isPast, addDays, DAY, IST_OFFSET };
