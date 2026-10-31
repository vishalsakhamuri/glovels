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

/* What the checkout offers, region by region: every currency Razorpay
   International Payments accepts (its published list), less the Russian
   rouble and the Cuban peso, which international cards cannot pay in, and
   the Croatian kuna (Croatia uses the euro). Currencies Razorpay does not
   take — Argentina (ARS), Venezuela (VES), Iran, Syria, Lebanon — are
   offered US dollars. */
const REGIONS = [
  ['South Asia', ['INR', 'NPR', 'LKR', 'BDT', 'PKR', 'MVR', 'BTN']],
  ['Middle East', ['AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'JOD', 'IQD', 'EGP', 'TRY', 'ILS', 'YER']],
  ['South-East Asia', ['MYR', 'IDR', 'VND', 'THB', 'PHP', 'SGD', 'KHR', 'MMK', 'LAK', 'BND']],
  ['East Asia', ['CNY', 'HKD', 'TWD', 'KRW', 'JPY', 'MNT', 'MOP']],
  ['Africa', ['NGN', 'KES', 'GHS', 'ZAR', 'TZS', 'UGX', 'RWF', 'ETB', 'ZMW', 'MWK', 'MZN', 'BWP', 'NAD', 'MUR', 'MAD', 'DZD', 'TND', 'XOF', 'XAF', 'SCR', 'SOS', 'SLL', 'LRD', 'GMD', 'GNF', 'BIF', 'DJF', 'KMF', 'MGA', 'CVE', 'LSL', 'SZL']],
  ['South America', ['BRL', 'CLP', 'COP', 'PEN', 'UYU', 'BOB', 'PYG', 'GYD']],
  ['Central America & Caribbean', ['MXN', 'GTQ', 'HNL', 'NIO', 'CRC', 'SVC', 'DOP', 'JMD', 'TTD', 'BBD', 'BSD', 'BZD', 'HTG', 'KYD', 'XCD', 'AWG', 'BMD']],
  ['Central Asia & Caucasus', ['KZT', 'UZS', 'KGS', 'AZN', 'AMD']],
  ['Europe', ['EUR', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'RSD', 'MKD', 'ALL', 'BAM', 'MDL', 'UAH', 'ISK', 'GIP']],
  ['North America', ['USD', 'CAD']],
  ['Oceania', ['AUD', 'NZD', 'FJD', 'PGK', 'VUV', 'XPF']],
];
const OFFERED = [].concat(...REGIONS.map(r => r[1]));

/* Rupees per unit, 31 Oct 2026 (open.er-api.com). Used until the first daily
   fetch succeeds, and whenever it cannot. NPR is pegged at 1.6 per rupee. */
const SNAPSHOT = {
  AED: 25.888, ALL: 1.16804, AMD: 0.263872, AUD: 66.8494, AWG: 53.1124, AZN: 55.9222,
  BAM: 54.2446, BBD: 47.5376, BDT: 0.766577, BGN: 54.2446, BHD: 252.845, BIF: 0.0318196,
  BMD: 95.0751, BND: 74.3439, BOB: 7.93525, BRL: 17.6544, BSD: 95.0751, BTN: 1.0, BWP: 6.64942,
  BZD: 47.5376, CAD: 68.0504, CHF: 115.327, CLP: 0.0963549, CNY: 14.2908, COP: 0.0300217,
  CRC: 0.209484, CVE: 0.962166, CZK: 4.3576, DJF: 0.53496, DKK: 14.1943, DOP: 1.56644,
  DZD: 0.704068, EGP: 1.69954, ETB: 0.589744, EUR: 106.09, FJD: 42.3657, GBP: 127.226,
  GHS: 8.13312, GIP: 127.226, GMD: 1.27221, GNF: 0.010741, GTQ: 12.4607, GYD: 0.454433,
  HKD: 12.1098, HNL: 3.54692, HTG: 0.72629, HUF: 0.289956, IDR: 0.00524299, ILS: 30.3306,
  IQD: 0.0627124, ISK: 0.781037, JMD: 0.600376, JOD: 134.102, JPY: 0.603626, KES: 0.732003,
  KGS: 1.08645, KHR: 0.0234785, KMF: 0.215651, KRW: 0.0712564, KWD: 305.623, KYD: 114.09,
  KZT: 0.209798, LAK: 0.00428323, LKR: 0.285866, LRD: 0.559349, LSL: 5.70496, MAD: 9.65251,
  MDL: 5.28547, MGA: 0.0206982, MKD: 1.71908, MMK: 0.0453906, MNT: 0.0263685, MOP: 11.7571,
  MUR: 1.97632, MVR: 6.16067, MWK: 0.0543688, MXN: 5.03943, MYR: 23.4274, MZN: 1.48751,
  NAD: 5.70496, NGN: 0.0702457, NIO: 2.58842, NOK: 10.301, NPR: 0.625, NZD: 53.5705,
  OMR: 247.28, PEN: 27.4288, PGK: 21.2775, PHP: 1.4925, PKR: 0.344064, PLN: 24.1057,
  PYG: 0.0164298, QAR: 26.1192, RON: 19.8515, RSD: 0.902416, RWF: 0.0641993, SAR: 25.353,
  SCR: 6.76169, SEK: 9.66501, SGD: 74.3439, SLL: 0.00415721, SOS: 0.166512, SVC: 10.8696,
  SZL: 5.70496, THB: 2.81631, TND: 31.5886, TRY: 1.9014, TTD: 14.0477, TWD: 2.91655,
  TZS: 0.0358591, UAH: 2.09253, UGX: 0.0219154, USD: 95.0751, UYU: 2.3695, UZS: 0.00793301,
  VND: 0.00369587, VUV: 0.798925, XAF: 0.161738, XCD: 35.2125, XOF: 0.161738, XPF: 0.88906,
  YER: 0.403271, ZAR: 5.7049, ZMW: 4.6879
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
