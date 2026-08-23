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

/* Two more rules from the office, and both of them are about what is worth
   collecting rather than what is arithmetically possible.

   Four parts at most: every part is a call somebody has to make, a payment
   somebody has to remember, and a row somebody has to reconcile. Eight parts
   of ₹9,000 is not a kindness, it is eight chances to lose the thread.

   ₹5,000 at least: below that the cost of collecting it is most of it. */
const MAX_PARTS = 4;
const MIN_PART_PAISE = 5000 * 100;          // ₹5,000, in paise

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

/* A basket of services has no applications and no offer to hang a phase on, so
   it gets its own three. Same rule, same floor, different words — a schedule
   whose labels describe work nobody is doing is a schedule nobody believes. */
const SERVICE_PLAN = [
  { label: 'To start', percent: 40, dueDays: 0 },
  { label: 'When the first drafts are with you', percent: 30, dueDays: 21 },
  { label: 'On delivery', percent: 30, dueDays: 45 },
];

const clampPct = n => Math.max(1, Math.min(100, Math.round(Number(n) || 0)));

/** The phases for a package, as authored or as defaulted. */
function phasesFor(pkg) {
  const own = pkg && Array.isArray(pkg.plan) ? pkg.plan : null;
  /* No package means a basket of services. */
  const base = pkg ? DEFAULT_PLAN : SERVICE_PLAN;
  const rows = (own && own.length ? own : base)
    .slice(0, 6)
    .map((r, i) => ({
      label: String((r && r.label) || ('Part ' + (i + 1))).slice(0, 60),
      percent: clampPct(r && r.percent),
      dueDays: Math.max(0, Math.round(Number(r && r.dueDays) || 0)),
    }));
  /* Percentages that do not add to a hundred are a typo, not an intention.
     Rather than refuse the sale, they are scaled — the total charged is the
     price on the card either way, and `split` guarantees that. */
  return rows.length ? rows : base.slice();
}

/** May this be paid in parts at all? */
function allowed(grossPaise) {
  const gross = Number(grossPaise || 0);
  /* Over the threshold, and enough for two parts that each clear the floor.
     Those are the same number today — ₹10,000 — and they are two different
     rules, so they are two different checks. */
  return gross > THRESHOLD_PAISE && gross >= MIN_PART_PAISE * 2;
}

/**
 * The schedule: what is due, when, and for how much.
 *
 * `placedAt` is passed in rather than read, so the same order produces the
 * same schedule whenever it is asked — and so a test can look at next month.
 */
/**
 * The amounts for a given set of phases, or null if they cannot be honoured.
 *
 * Every part must be at least ₹5,000, and they must add up to the total
 * exactly. Those two together are what make this more than a division: a
 * 40/30/30 of ₹11,000 is ₹4,400 / ₹3,300 / ₹3,300, and all three are under
 * the floor. So each part is pushed up to the floor if it lands below, and
 * capped so that everything after it can still clear the floor too — and if
 * that is impossible, this set of phases is wrong for this price and the
 * caller tries one fewer.
 */
function amountsFor(gross, rows) {
  const totalPct = rows.reduce((n, r) => n + r.percent, 0) || 100;
  const out = [];
  let spent = 0;
  for (let i = 0; i < rows.length - 1; i++) {
    const stillToCome = rows.length - 1 - i;
    /* What this part can be without starving the ones after it. */
    const ceiling = gross - spent - MIN_PART_PAISE * stillToCome;
    if (ceiling < MIN_PART_PAISE) return null;          // too many parts for this price
    let paise = Math.round(gross * (rows[i].percent / totalPct) / 100) * 100;
    /* Rounded down to the nearest hundred rupees where that still works.
       "₹6,857 to start" reads as a mistake on a card; ₹6,800 reads as a
       decision. The remainder lands on the last part, which is the one nobody
       is looking at when they decide whether they can afford to start. */
    const tidy = Math.floor(paise / 10000) * 10000;
    if (tidy >= MIN_PART_PAISE
        && gross - spent - tidy >= MIN_PART_PAISE * stillToCome) paise = tidy;
    if (paise < MIN_PART_PAISE) paise = MIN_PART_PAISE;
    if (paise > ceiling) paise = ceiling;
    out.push(paise);
    spent += paise;
  }
  const last = gross - spent;
  if (last < MIN_PART_PAISE) return null;
  out.push(last);
  return out;
}

function split(grossPaise, pkg, placedAt) {
  const gross = Math.max(0, Math.round(Number(grossPaise) || 0));
  if (!allowed(gross)) return null;

  const phases = phasesFor(pkg);
  const start = new Date(placedAt || Date.now());

  /* As many parts as the phases ask for, capped at four, and then fewer if the
     price cannot carry that many at ₹5,000 each. Fewer parts is the right way
     to fail: two parts of ₹5,500 is a plan, five parts of ₹2,200 is a
     collections problem. */
  for (let n = Math.min(MAX_PARTS, phases.length); n >= 2; n--) {
    const rows = phases.slice(0, n);
    const amounts = amountsFor(gross, rows);
    if (!amounts) continue;
    return rows.map((r, i) => {
      const due = new Date(start.getTime() + r.dueDays * 864e5);
      return {
        n: i + 1,
        label: r.label,
        paise: amounts[i],
        dueAt: r.dueDays ? due.toISOString() : '',
        /* The first part is paid at the checkout; the rest are collected. */
        status: i === 0 ? 'due' : 'later',
        paidAt: '',
      };
    });
  }
  return null;
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
  THRESHOLD_PAISE, MIN_PART_PAISE, MAX_PARTS, DEFAULT_PLAN, SERVICE_PLAN,
  allowed, split, phasesFor, outstanding, collected, nextDue, overdue, teaser,
};
