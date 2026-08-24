'use strict';
/**
 * What we were promised, what arrived, what is still coming, and what is gone.
 *
 * "How much was expected, how much we got, what is pending, and drop off and
 * left — these four should be enough to track the progress."
 *
 * Every one of those numbers is already in the orders table. What was missing
 * is that nobody had ever written down which of two things an unpaid balance
 * is. A student halfway through a three-part plan and a student who stopped
 * answering in March have the identical row: an order, some money in, some
 * money out. The first is pending and will arrive; the second is lost and will
 * not. Until somebody says which, the office is adding them together and
 * calling the total "receivables", which is how a business is surprised.
 *
 * So the split is not computed here — it is READ, from the student's status,
 * which an administrator sets. This file only does the arithmetic.
 *
 * Deliberately out of scope, because Vishal said so and because mixing them in
 * would make every number above unauditable: commissions from Expatrio, from
 * universities, and from bank loan referrals. Those are somebody else's ledger.
 *
 * On GST: prices on this site are inclusive, so the tax is inside the money
 * received rather than added to it. The figure below is the portion of what
 * arrived that is not ours — computed from what was actually RECEIVED, never
 * from what was invoiced, because tax on money that never came is not a
 * liability anybody owes.
 */

const GST_RATE = 0.18;

/** The tax inside an inclusive amount. */
const gstIn = paise => Math.round(paise - paise / (1 + GST_RATE));

/** What has actually been collected on one order. */
function collected(order) {
  if (order.status === 'paid') return Number(order.gross_paise || 0);
  /* A part-paid order carries its own running total, kept by recordPayment. An
     order with a plan and nothing paid has 0, which is correct. */
  return Number(order.paid_paise || 0);
}

/**
 * An order counts toward the book only if the work was actually taken on.
 *
 * `owing` is a real order — a counsellor agreed it and is collecting — and
 * `part` means the money started arriving. A card that failed, or a checkout
 * somebody abandoned, is not a promise anybody made.
 */
const EARNED = new Set(['paid', 'owing', 'part']);

/**
 * The four numbers, plus the working.
 *
 * `students` is every student row; `orders` is every order. Both are passed in
 * rather than fetched, so the caller decides the window and a test can hand it
 * whatever situation it wants to describe.
 */
function summarise(students, orders, now) {
  const byId = new Map(students.map(s => [Number(s.id), s]));
  const statusOf = order => {
    const s = order.student_id ? byId.get(Number(order.student_id)) : null;
    return s ? (s.status || 'active') : 'active';
  };

  const out = {
    expected: 0,        /* everything agreed, whatever became of it */
    received: 0,        /* money in the bank */
    pending: 0,         /* still coming, from students still with us */
    lost: 0,            /* owed by students who stopped part-way */
    gst: 0,             /* the tax inside `received` */
    orders: 0,
    services: 0,        /* line items on fully-paid orders — work delivered */
    overdue: 0,         /* of `pending`, the part whose date has passed */
    students: { active: 0, completed: 0, left: 0 },
    /* Who to chase, longest overdue first. The point of the screen. */
    owing: [],
  };

  students.forEach(s => {
    const k = s.status || 'active';
    if (out.students[k] != null) out.students[k]++;
  });

  const t = now || Date.now();

  for (const o of orders) {
    if (!EARNED.has(o.status)) continue;
    const gross = Number(o.gross_paise || 0);
    const got = collected(o);
    const left = Math.max(0, gross - got);

    out.orders++;
    out.expected += gross;
    out.received += got;

    /* Line items exist on itemised orders; a package order counts as one piece
       of work. Only counted when the order is settled — "services performed"
       against money that never arrived is not a number anybody wants. */
    if (o.status === 'paid') {
      let items = [];
      try { items = JSON.parse(o.items || '[]') || []; } catch (e) { items = []; }
      out.services += items.length || 1;
    }

    if (!left) continue;

    if (statusOf(o) === 'left') {
      out.lost += left;
      continue;
    }

    out.pending += left;

    /* The overdue part, and who owes it. A schedule with dates is the only
       thing that can be late; an order with no plan is owed but not yet due. */
    let plan = null;
    try { plan = o.plan ? JSON.parse(o.plan) : null; } catch (e) { plan = null; }
    const late = (plan || []).filter(p =>
      p.status !== 'paid' && p.dueAt && new Date(p.dueAt).getTime() < t);
    const lateSum = late.reduce((n, p) => n + Number(p.paise || 0), 0);
    out.overdue += lateSum;

    const who = o.student_id ? byId.get(Number(o.student_id)) : null;
    out.owing.push({
      reference: o.reference,
      studentId: o.student_id || null,
      name: (who && who.name) || o.name || '—',
      email: (who && who.email) || o.email || '',
      status: statusOf(o),
      package: o.package,
      gross,
      collected: got,
      outstanding: left,
      overdue: lateSum,
      /* The date the oldest unpaid instalment was due, which is what "how late"
         means in a sentence somebody says on the phone. */
      since: late.length ? late.map(p => p.dueAt).sort()[0] : '',
      nextDue: (plan || []).filter(p => p.status !== 'paid')
        .map(p => p.dueAt).filter(Boolean).sort()[0] || '',
    });
  }

  out.gst = gstIn(out.received);
  out.owing.sort((a, b) => b.overdue - a.overdue || b.outstanding - a.outstanding);
  return out;
}

module.exports = { summarise, gstIn, collected, EARNED, GST_RATE };
