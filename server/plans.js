'use strict';
/**
 * Paying in parts.
 *
 * A student who has just decided to go abroad is being asked for ₹74,999 in
 * one press, months before the first application is filed. Some of them can.
 * The ones who cannot do not tell us — they close the tab, and the office
 * counts it as a page that did not convert.
 *
 * So: anything over the threshold can be paid in phases, and the phases are
 * named after what we will have done by then rather than by a number. "40% now,
 * 30% in 30 days" is a loan agreement. "₹30,000 to start, ₹22,500 when your
 * applications go in" is the same money and a different conversation.
 *
 * Three rules the whole thing rests on:
 *
 *   The threshold. Under it, there is nothing to spread — ₹9,999 in three
 *   parts is three payment attempts to collect ten thousand rupees.
 *
 *   The parts add up to the total, exactly. Percentages of an odd number do
 *   not, so the last part is the remainder rather than a rounded figure, and
 *   what is charged is what was quoted.
 *
 *   The first part is due now. Nothing starts until something is paid, and an
 *   order where every part is "later" is not an order.
 */

/* Anything at or under this is paid in one go. ₹10,000 exactly, from the
   office: "9999 to be paid immediately, anything more than 10k will have part
   payments". */
const THRESHOLD_PAISE = 10000 * 100;         // ₹10,000, in paise

/*
 * The default phases, when a package has not been given its own.
 *
 * Named after the work, and dated by when that work usually happens, because
 * an instalment tied to a milestone we have not reached is an instalment
 * nobody can chase.
 */
const DEFAULT_PLAN = [
  { label: 'To start', percent: 40, dueDays: 0 },
  { label: 'When your applications go in', percent: 30, dueDays: 30 },
  { label: 'When your offer is in hand', percent: 30, dueDays: 75 },
];

const clampPct = n => Math.max(1, Math.min(100, Math.round(Number(n) || 0)));

/** The phases for a package, as authored or as defaulted. */
function phasesFor(pkg) {
  const own = pkg && Array.isArray(pkg.plan) ? pkg.plan : null;
  const rows = (own && own.length ? own : DEFAULT_PLAN)
    .slice(0, 6)
    .map((r, i) => ({
      label: String((r && r.label) || ('Part ' + (i + 1))).slice(0, 60),
      percent: clampPct(r && r.percent),
      dueDays: Math.max(0, Math.round(Number(r && r.dueDays) || 0)),
    }));
  /* Percentages that do not add to a hundred are a typo, not an intention.
     Rather than refuse the sale, they are scaled — the total charged is the
     price on the card either way, and `split` guarantees that. */
  return rows.length ? rows : DEFAULT_PLAN.slice();
}

/** May this be paid in parts at all? */
function allowed(grossPaise) {
  return Number(grossPaise || 0) > THRESHOLD_PAISE;
}

/**
 * The schedule: what is due, when, and for how much.
 *
 * `placedAt` is passed in rather than read, so the same order produces the
 * same schedule whenever it is asked — and so a test can look at next month.
 */
function split(grossPaise, pkg, placedAt) {
  const gross = Math.max(0, Math.round(Number(grossPaise) || 0));
  if (!allowed(gross)) return null;

  const rows = phasesFor(pkg);
  const totalPct = rows.reduce((n, r) => n + r.percent, 0) || 100;
  const start = new Date(placedAt || Date.now());

  let spent = 0;
  return rows.map((r, i) => {
    const last = i === rows.length - 1;
    /* Whole rupees, and the last one is the remainder rather than a rounding
       of its own percentage. Three thirds of ₹74,999 do not add up to
       ₹74,999, and a student charged one rupee more than the card said has
       caught us out. ₹29,999.60 is not a number anybody puts on a screen
       either, so the odd paise land on the part furthest away. */
    const paise = last ? gross - spent
      : Math.round(gross * (r.percent / totalPct) / 100) * 100;
    spent += paise;
    const due = new Date(start.getTime() + r.dueDays * 864e5);
    return {
      n: i + 1,
      label: r.label,
      paise,
      dueAt: r.dueDays ? due.toISOString() : '',
      /* The first part is paid at the checkout; the rest are collected. */
      status: i === 0 ? 'due' : 'later',
      paidAt: '',
    };
  });
}

/** What is still owed on a schedule. */
function outstanding(plan) {
  return (plan || []).filter(p => p.status !== 'paid')
    .reduce((n, p) => n + Number(p.paise || 0), 0);
}

/** What has been received. */
function collected(plan) {
  return (plan || []).filter(p => p.status === 'paid')
    .reduce((n, p) => n + Number(p.paise || 0), 0);
}

/** The next one somebody has to chase, if any. */
function nextDue(plan) {
  return (plan || []).find(p => p.status !== 'paid') || null;
}

/**
 * Overdue, and by how much.
 *
 * A part with no date on it is not overdue — it is waiting on the work, and
 * chasing somebody for money before we have done the thing it pays for is how
 * a business loses a customer it had already won.
 */
function overdue(plan, now) {
  const t = now ? new Date(now).getTime() : Date.now();
  return (plan || []).filter(p =>
    p.status !== 'paid' && p.dueAt && new Date(p.dueAt).getTime() < t);
}

/** One line a card can print: "Part payment available — ₹30,000 to start." */
function teaser(grossPaise, pkg, inr) {
  if (!allowed(grossPaise)) return '';
  const parts = split(grossPaise, pkg, 0);
  if (!parts || parts.length < 2) return '';
  const first = inr ? inr(parts[0].paise) : '₹' + Math.round(parts[0].paise / 100);
  return 'Pay in ' + parts.length + ' parts — ' + first + ' to start';
}

module.exports = {
  THRESHOLD_PAISE, DEFAULT_PLAN,
  allowed, split, phasesFor, outstanding, collected, nextDue, overdue, teaser,
};
