/**
 * Patch 187: which country a visitor is in, from their IP address.
 *
 * Used for one thing: offering prices and payment in the visitor's own
 * currency (and counting visits by country on the Traffic screen). The
 * address is looked up in memory and never stored; only the two-letter
 * country goes into the visit log.
 *
 * Where the answer comes from, in order:
 *   1. A country header from a CDN in front of the site, if there is one
 *      (Cloudflare's CF-IPCountry, CloudFront, Vercel, Fastly).
 *   2. The DB-IP "IP to Country Lite" database (CC BY 4.0, https://db-ip.com),
 *      downloaded by the server once a month, packed into typed arrays
 *      (about 12 MB in memory) and kept on disk so a restart does not fetch it again.
 *   3. Nothing — the browser then falls back to its time zone.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const readline = require('readline');
const net = require('net');

/* Country → the currency a visitor there is offered. Countries not listed
   (or whose money Razorpay does not take) get USD. */
const CURRENCY_OF = (() => {
  const m = {};
  const put = (cur, list) => list.split(' ').forEach(c => { m[c] = cur; });
  put('INR', 'IN BT');
  put('NPR', 'NP'); put('LKR', 'LK'); put('BDT', 'BD'); put('PKR', 'PK'); put('MVR', 'MV');
  put('AED', 'AE'); put('SAR', 'SA'); put('QAR', 'QA'); put('KWD', 'KW'); put('BHD', 'BH');
  put('OMR', 'OM'); put('JOD', 'JO'); put('IQD', 'IQ'); put('EGP', 'EG'); put('TRY', 'TR');
  put('ILS', 'IL PS'); put('YER', 'YE');
  put('MYR', 'MY'); put('IDR', 'ID'); put('VND', 'VN'); put('THB', 'TH'); put('PHP', 'PH');
  put('SGD', 'SG'); put('KHR', 'KH'); put('MMK', 'MM'); put('LAK', 'LA'); put('BND', 'BN');
  put('CNY', 'CN'); put('HKD', 'HK'); put('TWD', 'TW'); put('KRW', 'KR'); put('JPY', 'JP');
  put('MNT', 'MN'); put('MOP', 'MO');
  put('NGN', 'NG'); put('KES', 'KE'); put('GHS', 'GH'); put('ZAR', 'ZA'); put('TZS', 'TZ');
  put('UGX', 'UG'); put('RWF', 'RW'); put('ETB', 'ET'); put('ZMW', 'ZM'); put('MWK', 'MW');
  put('MZN', 'MZ'); put('BWP', 'BW'); put('NAD', 'NA'); put('MUR', 'MU'); put('MAD', 'MA EH');
  put('DZD', 'DZ'); put('TND', 'TN'); put('SCR', 'SC'); put('SOS', 'SO'); put('SLL', 'SL');
  put('LRD', 'LR'); put('GMD', 'GM'); put('GNF', 'GN'); put('BIF', 'BI'); put('DJF', 'DJ');
  put('KMF', 'KM'); put('MGA', 'MG'); put('CVE', 'CV'); put('LSL', 'LS'); put('SZL', 'SZ');
  put('XOF', 'SN CI ML BF NE TG BJ GW'); put('XAF', 'CM GA CG TD CF GQ');
  put('BRL', 'BR'); put('CLP', 'CL'); put('COP', 'CO'); put('PEN', 'PE'); put('UYU', 'UY');
  put('BOB', 'BO'); put('PYG', 'PY'); put('GYD', 'GY');
  put('MXN', 'MX'); put('GTQ', 'GT'); put('HNL', 'HN'); put('NIO', 'NI'); put('CRC', 'CR');
  put('DOP', 'DO'); put('JMD', 'JM'); put('TTD', 'TT'); put('BBD', 'BB'); put('BSD', 'BS');
  put('BZD', 'BZ'); put('HTG', 'HT'); put('KYD', 'KY'); put('AWG', 'AW'); put('BMD', 'BM');
  put('XCD', 'AG DM GD KN LC VC AI MS');
  put('KZT', 'KZ'); put('UZS', 'UZ'); put('KGS', 'KG'); put('AZN', 'AZ'); put('AMD', 'AM');
  put('EUR', 'AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SK SI AD MC SM VA ME XK '
    + 'GP MQ GF RE YT PM BL MF AX');
  put('GBP', 'GB IM JE GG'); put('GIP', 'GI'); put('CHF', 'CH LI'); put('SEK', 'SE');
  put('NOK', 'NO SJ'); put('DKK', 'DK FO GL'); put('PLN', 'PL'); put('CZK', 'CZ'); put('HUF', 'HU');
  put('RON', 'RO'); put('BGN', 'BG'); put('RSD', 'RS'); put('MKD', 'MK'); put('ALL', 'AL');
  put('BAM', 'BA'); put('MDL', 'MD'); put('UAH', 'UA'); put('ISK', 'IS');
  put('CAD', 'CA'); put('AUD', 'AU CX CC NF KI NR TV'); put('NZD', 'NZ CK NU PN TK');
  put('FJD', 'FJ'); put('PGK', 'PG'); put('VUV', 'VU'); put('XPF', 'PF NC WF');
  return m;
})();

const currencyFor = country => CURRENCY_OF[String(country || '').toUpperCase()] || 'USD';

/* ---------------------------------------------------------------- the data */
let v4Start = null, v4End = null, v4Cc = null;   // Uint32Array ×2, Uint16Array
let v6Start = null, v6End = null, v6Cc = null;   // BigUint64Array ×2 (first 64 bits), Uint16Array
let codes = [];                           // index → 'IN'
let loadedMonth = '';
let loading = false;

const ccIndex = new Map();
const idxOf = cc => {
  let i = ccIndex.get(cc);
  if (i == null) { i = codes.length; codes.push(cc); ccIndex.set(cc, i); }
  return i;
};

function v4ToInt(ip) {
  const p = ip.split('.');
  if (p.length !== 4) return -1;
  let n = 0;
  for (const x of p) { const b = Number(x); if (!(b >= 0 && b <= 255)) return -1; n = n * 256 + b; }
  return n >>> 0;
}
function v6Prefix(ip) {
  /* The first 64 bits — DB-IP's IPv6 ranges are /64 or wider. */
  let s = String(ip).split('%')[0];
  if (s.includes('.')) return null;                 // IPv4-mapped is handled as IPv4
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = head.concat(new Array(Math.max(0, fill)).fill('0'), tail);
  if (groups.length !== 8) return null;
  let n = 0n;
  for (let i = 0; i < 4; i++) {
    const g = parseInt(groups[i] || '0', 16);
    if (!(g >= 0 && g <= 0xffff)) return null;
    n = (n << 16n) | BigInt(g);
  }
  return n;
}

function search(starts, x) {
  let lo = 0, hi = starts.length - 1, at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= x) { at = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return at;
}

/** Two-letter country for an IP, or ''. */
function countryOfIp(ip) {
  ip = String(ip || '').trim().replace(/^::ffff:/i, '');
  if (!ip) return '';
  if (net.isIPv4(ip)) {
    if (!v4Start) return '';
    const n = v4ToInt(ip); if (n < 0) return '';
    const i = search(v4Start, n);
    return i >= 0 && n <= v4End[i] ? codes[v4Cc[i]] || '' : '';
  }
  if (net.isIPv6(ip)) {
    if (!v6Start) return '';
    const n = v6Prefix(ip); if (n == null) return '';
    const i = search(v6Start, n);
    return i >= 0 && n <= v6End[i] ? codes[v6Cc[i]] || '' : '';
  }
  return '';
}

const HEADERS = ['cf-ipcountry', 'cloudfront-viewer-country', 'x-vercel-ip-country',
  'fastly-geo-country', 'x-country-code'];

/** { country, currency, source } for a request. `ip` is the caller's
 *  idea of the client address (the API's clientIp). */
function forRequest(req, ip) {
  for (const h of HEADERS) {
    const v = String((req.headers && req.headers[h]) || '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(v) && v !== 'XX' && v !== 'T1') return { country: v, currency: currencyFor(v), source: 'cdn' };
  }
  const c = countryOfIp(ip);
  return c ? { country: c, currency: currencyFor(c), source: 'ip' } : { country: '', currency: '', source: 'none' };
}

/* -------------------------------------------------------- loading the data */
const MAGIC = 'GLVGEO1';

function save(file) {
  try {
    const head = Buffer.from(JSON.stringify({ magic: MAGIC, month: loadedMonth, codes,
      n4: v4Start.length, n6: v6Start.length, ends: true }));
    const len = Buffer.alloc(4); len.writeUInt32LE(head.length);
    const parts = [len, head,
      Buffer.from(v4Start.buffer, v4Start.byteOffset, v4Start.byteLength),
      Buffer.from(v4End.buffer, v4End.byteOffset, v4End.byteLength),
      Buffer.from(v4Cc.buffer, v4Cc.byteOffset, v4Cc.byteLength),
      Buffer.from(v6Start.buffer, v6Start.byteOffset, v6Start.byteLength),
      Buffer.from(v6End.buffer, v6End.byteOffset, v6End.byteLength),
      Buffer.from(v6Cc.buffer, v6Cc.byteOffset, v6Cc.byteLength)];
    fs.writeFileSync(file + '.tmp', Buffer.concat(parts));
    fs.renameSync(file + '.tmp', file);
  } catch (e) { /* the copy in memory still works */ }
}

function loadFile(file) {
  try {
    const buf = fs.readFileSync(file);
    const hl = buf.readUInt32LE(0);
    const head = JSON.parse(buf.slice(4, 4 + hl).toString('utf8'));
    if (head.magic !== MAGIC || !head.ends) return false;
    let o = 4 + hl;
    const take = (Ctor, n) => {
      const bytes = n * Ctor.BYTES_PER_ELEMENT;
      const copy = new Ctor(n);
      Buffer.from(copy.buffer).set(buf.subarray(o, o + bytes));
      o += bytes;
      return copy;
    };
    const a = take(Uint32Array, head.n4), a2 = take(Uint32Array, head.n4), b = take(Uint16Array, head.n4);
    const c = take(BigUint64Array, head.n6), c2 = take(BigUint64Array, head.n6), d = take(Uint16Array, head.n6);
    v4Start = a; v4End = a2; v4Cc = b; v6Start = c; v6End = c2; v6Cc = d;
    codes = head.codes; ccIndex.clear(); codes.forEach((cc, i) => ccIndex.set(cc, i));
    loadedMonth = head.month;
    return true;
  } catch (e) { return false; }
}

/* A typed array that grows — so packing ~700,000 ranges never holds them as
   plain JS numbers or BigInt objects (tens of MB on a 512 MB server). */
function grower(Ctor) {
  let a = new Ctor(65536), n = 0;
  return {
    push(v) { if (n === a.length) { const b = new Ctor(a.length * 2); b.set(a); a = b; } a[n++] = v; },
    last() { return a[n - 1]; },
    setLast(v) { a[n - 1] = v; },
    get length() { return n; },
    done() { return a.slice(0, n); },
  };
}

function monthOf(d) { return d.toISOString().slice(0, 7); }

/** Download and pack one month's DB-IP country file. */
function download(month) {
  const url = (process.env.GEO_SOURCE || 'https://download.db-ip.com/free/dbip-country-lite-{m}.csv.gz')
    .replace('{m}', month);
  const client = /^http:/.test(url) ? require('http') : https;   // http only for the tests' stand-in
  return new Promise(resolve => {
    const req = client.get(url, { timeout: 30000 }, res => {
      if (res.statusCode !== 200) { res.resume(); return resolve(false); }
      const s4 = grower(Uint32Array), e4 = grower(Uint32Array), c4 = grower(Uint16Array);
      const s6 = grower(BigUint64Array), e6 = grower(BigUint64Array), c6 = grower(Uint16Array);
      const fresh = []; const freshIdx = new Map();
      const idx = cc => { let i = freshIdx.get(cc); if (i == null) { i = fresh.length; fresh.push(cc); freshIdx.set(cc, i); } return i; };
      const rl = readline.createInterface({ input: res.pipe(zlib.createGunzip()) });
      rl.on('line', line => {
        const a = line.indexOf(','), b = line.indexOf(',', a + 1);
        if (a < 0 || b < 0) return;
        const start = line.slice(0, a).replace(/"/g, '');
        const end = line.slice(a + 1, b).replace(/"/g, '');
        const cc = line.slice(b + 1).replace(/"/g, '').trim().toUpperCase();
        if (!/^[A-Z]{2}$/.test(cc) || cc === 'ZZ') return;
        if (start.includes(':')) {
          const p = v6Prefix(start), q = v6Prefix(end); if (p == null || q == null) return;
          if (s6.length && s6.last() === p) {                   // ranges narrower than /64
            if (q > e6.last()) e6.setLast(q);
            return;
          }
          s6.push(p); e6.push(q); c6.push(idx(cc));
        } else {
          const n = v4ToInt(start), m = v4ToInt(end); if (n < 0 || m < 0) return;
          s4.push(n); e4.push(m); c4.push(idx(cc));
        }
      });
      rl.on('close', () => {
        if (s4.length < 50000) return resolve(false);           // not the file we expected
        v4Start = s4.done(); v4End = e4.done(); v4Cc = c4.done();
        v6Start = s6.done(); v6End = e6.done(); v6Cc = c6.done();
        codes = fresh; ccIndex.clear(); codes.forEach((cc, i) => ccIndex.set(cc, i));
        loadedMonth = month;
        resolve(true);
      });
      rl.on('error', () => resolve(false));
      res.on('error', () => resolve(false));
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

async function refresh(dir) {
  if (loading) return false;
  loading = true;
  try {
    const now = new Date();
    /* This month's file appears on the 1st; last month's is the fallback. */
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    for (const m of [monthOf(now), monthOf(prev)]) {
      if (m === loadedMonth) return true;
      if (await download(m)) {
        if (dir) save(path.join(dir, 'geo-country.bin'));
        console.log('  [geo] IP-to-country data ' + m + ': ' + v4Start.length + ' IPv4 + ' + v6Start.length + ' IPv6 ranges');
        return true;
      }
    }
    return false;
  } finally { loading = false; }
}

/** Load the packed copy on disk, then keep it current (monthly). */
function start(dir) {
  if (dir) loadFile(path.join(dir, 'geo-country.bin'));
  if (process.env.GEO_AUTO === 'off') return;
  const due = () => loadedMonth !== monthOf(new Date());
  if (due()) setTimeout(() => { refresh(dir).catch(() => {}); }, 45000).unref();
  setInterval(() => { if (due()) refresh(dir).catch(() => {}); }, 24 * 60 * 60 * 1000).unref();
}

function status() {
  return { month: loadedMonth, v4: v4Start ? v4Start.length : 0, v6: v6Start ? v6Start.length : 0 };
}

/* For tests: install a tiny table directly. */
function _install(rows) {
  const s4 = [], e4 = [], c4 = [];
  codes = []; ccIndex.clear();
  rows.sort((a, b) => v4ToInt(a[0]) - v4ToInt(b[0])).forEach(([ip, end, cc]) => { s4.push(v4ToInt(ip)); e4.push(v4ToInt(end)); c4.push(idxOf(cc)); });
  v4Start = Uint32Array.from(s4); v4End = Uint32Array.from(e4); v4Cc = Uint16Array.from(c4);
  v6Start = new BigUint64Array(0); v6End = new BigUint64Array(0); v6Cc = new Uint16Array(0);
  loadedMonth = 'test';
}

module.exports = { forRequest, countryOfIp, currencyFor, start, refresh, status, _install, CURRENCY_OF };
