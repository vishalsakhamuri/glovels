/**
 * Patch 186: what a price is in the buyer's own money.
 *
 * Glovels sells in rupees. A buyer in Lagos, Lima or Kuala Lumpur sees and
 * pays the same price in naira, soles or ringgit. This file holds:
 *
 *  - the currencies Razorpay International Payments accepts that matter to
 *    the audience (South and South-East Asia, the Middle East, Africa, South
 *    America, plus the usual majors), grouped for the checkout's menu;
 *  - each currency's minor unit (most have 100, a few have none, the Gulf's
 *    dinars and rials have 1,000), because Razorpay wants the amount in it;
 *  - the rate: market rates fetched once a day from a free public source,
 *    a snapshot taken when this was written as the fallback, plus a small
 *    cushion (2%) for the card network's conversion, so the office's rupee
 *    settlement is not short. The Finder's own exchange rates are for showing
 *    university fees and are not used here.
 *
 * Every charged amount is worked out on the server (api.js), never trusted
 * from a browser. The browser repeats the same arithmetic only to show it.
 */

'use strict';

const https = require('https');

/* Razorpay's exponent table (docs: International Payments → supported currencies). */
const EXP0 = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX',
  'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const EXP3 = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'OMR', 'TND']);
const exponent = c => (EXP0.has(c) ? 0 : EXP3.has(c) ? 3 : 2);

/* What the checkout offers, region by region. Only currencies Razorpay
   accepts; Argentina (ARS) and Venezuela (VES) are not among them, so those
   buyers are offered US dollars. */
const REGIONS = [
  ['South Asia', ['INR', 'NPR', 'LKR', 'BDT', 'PKR', 'MVR']],
  ['South-East Asia', ['MYR', 'IDR', 'VND', 'THB', 'PHP', 'SGD', 'KHR']],
  ['Middle East', ['AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'JOD', 'IQD', 'EGP', 'TRY']],
  ['Africa', ['NGN', 'KES', 'GHS', 'ZAR', 'TZS', 'UGX', 'RWF', 'ETB', 'ZMW', 'MWK', 'MZN',
    'BWP', 'NAD', 'MUR', 'MAD', 'DZD', 'TND', 'XOF', 'XAF']],
  ['South America', ['BRL', 'CLP', 'COP', 'PEN', 'UYU', 'BOB', 'PYG']],
  ['Worldwide', ['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'NZD', 'CHF']],
];
const OFFERED = [].concat(...REGIONS.map(r => r[1]));

/* Rupees per unit, 31 Oct 2026 (open.er-api.com). Used until the first daily
   fetch succeeds, and whenever it cannot. NPR is pegged at 1.6 per rupee. */
const SNAPSHOT = {
  AED: 25.888, AUD: 66.8494, BDT: 0.766577, BHD: 252.8445, BOB: 7.9352, BRL: 17.6544,
  BWP: 6.6494, CAD: 68.0504, CHF: 115.327, CLP: 0.096355, COP: 0.030022, DZD: 0.704068,
  EGP: 1.6995, ETB: 0.589744, EUR: 106.0895, GBP: 127.2265, GHS: 8.1331, IDR: 0.005243,
  IQD: 0.062712, JOD: 134.1022, KES: 0.732003, KWD: 305.6235, LKR: 0.285866, MAD: 9.6525,
  MUR: 1.9763, MVR: 6.1607, MWK: 0.054369, MYR: 23.4274, MZN: 1.4875, NAD: 5.705,
  NGN: 0.070246, NPR: 0.625, NZD: 53.5705, OMR: 247.2799, PEN: 27.4288, PHP: 1.4925,
  PKR: 0.344064, PYG: 0.01643, QAR: 26.1192, RWF: 0.064199, SAR: 25.353, SGD: 74.3439,
  THB: 2.8163, TND: 31.5886, TRY: 1.9014, TZS: 0.035859, UGX: 0.021915, USD: 95.0751,
  UYU: 2.3695, VND: 0.003696, XAF: 0.161738, XOF: 0.161738, ZAR: 5.7049, ZMW: 4.6879,
  KHR: 0.023479,
};

/* The cushion for the card network's conversion spread. */
const CUSHION = 1.02;
/* A day-old rate is fine; a week-old one is not trusted over the snapshot's
   order of magnitude check below, but it is still better than nothing. */
const REFRESH_MS = 12 * 60 * 60 * 1000;
const SOURCE = process.env.FX_SOURCE || 'https://open.er-api.com/v6/latest/INR';

let live = null;            // { at, perInr: { USD: 0.0105, … } }

function load(db) {
  try {
    const v = db && db.content && db.content('fxAuto');
    if (v && v.perInr && typeof v.perInr === 'object') live = v;
  } catch (e) { /* none yet */ }
}

/** Rupees per unit, before the cushion. A fetched rate is used only if it is
 *  within a factor of two of the snapshot — a broken feed must not price a
 *  ₹49,999 package at one dollar. */
function marketRate(code) {
  if (code === 'INR') return 1;
  const snap = SNAPSHOT[code];
  const per = live && live.perInr && Number(live.perInr[code]);
  if (per > 0) {
    const r = 1 / per;
    if (!snap || (r > snap / 2 && r < snap * 2)) return r;
  }
  return snap || 0;
}

/** Rupees per unit as charged (with the cushion), rounded for display. */
function rate(code) {
  if (code === 'INR') return 1;
  const r = marketRate(code);
  if (!(r > 0)) return 0;
  const c = r / CUSHION;          // fewer rupees per unit → more units charged
  return Number(c.toPrecision(6));
}

function rates() {
  const out = { INR: 1 };
  OFFERED.forEach(c => { const r = rate(c); if (r > 0) out[c] = r; });
  return out;
}

function currencies() {
  const r = rates();
  return OFFERED.filter(c => r[c]);
}

function regions() {
  const r = rates();
  return REGIONS.map(([name, list]) => ({ name, currencies: list.filter(c => r[c]) }))
    .filter(g => g.currencies.length);
}

/** Whole units, rounded UP, to about four significant figures so that
 *  ₹49,999 reads 9,537,000 IDR rather than 9,536,413 IDR. */
function niceUnits(x) {
  const units = Math.max(1, Math.ceil(x - 1e-9));
  const step = units >= 10000 ? Math.pow(10, Math.floor(Math.log10(units)) - 3) : 1;
  return Math.ceil(units / step) * step;
}

/** `inrPaise` in `code`: { currency, units, amountMinor, rate, exponent }.
 *  Anything not offered is charged in rupees. */
function convert(inrPaise, code) {
  const cur = String(code || 'INR').toUpperCase();
  const r = rate(cur);
  if (cur === 'INR' || !OFFERED.includes(cur) || !(r > 0)) {
    return { currency: 'INR', units: Math.round(inrPaise) / 100, amountMinor: Math.round(inrPaise), rate: 1, exponent: 2 };
  }
  const e = exponent(cur);
  const units = niceUnits((Number(inrPaise) / 100) / r);
  return { currency: cur, units, amountMinor: units * Math.pow(10, e), rate: r, exponent: e };
}

/** Fetch today's rates. Silent on failure: the snapshot still prices. */
function refresh(db) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    try {
      const req = https.get(SOURCE, { timeout: 8000 }, res => {
        let body = '';
        res.on('data', c => { body += c; if (body.length > 200000) req.destroy(); });
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            const src = j && (j.rates || j.conversion_rates);
            if (!src || typeof src !== 'object') return finish(false);
            const perInr = {};
            OFFERED.forEach(c => { const n = Number(src[c]); if (n > 0) perInr[c] = n; });
            if (Object.keys(perInr).length < 10) return finish(false);
            live = { at: new Date().toISOString(), source: SOURCE, perInr };
            try { db && db.setContent && db.setContent('fxAuto', live, 'system'); } catch (e) { /* in memory */ }
            finish(true);
          } catch (e) { finish(false); }
        });
      });
      req.on('timeout', () => { req.destroy(); finish(false); });
      req.on('error', () => finish(false));
    } catch (e) { finish(false); }
  });
}

/** Load what was fetched before, then fetch twice a day. */
function start(db) {
  load(db);
  if (process.env.FX_AUTO === 'off') return;
  const stale = !live || (Date.now() - Date.parse(live.at || 0)) > REFRESH_MS;
  if (stale) setTimeout(() => refresh(db), 20000).unref();
  setInterval(() => refresh(db), REFRESH_MS).unref();
}

function status() {
  return live ? { at: live.at, source: live.source || SOURCE } : { at: '', source: 'snapshot 2026-10-31' };
}

module.exports = { convert, rate, rates, currencies, regions, exponent, refresh, start, status,
  niceUnits, OFFERED, SNAPSHOT, CUSHION };
