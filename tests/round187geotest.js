/**
 * Patch 187: the visitor's country from their IP, and their currency.
 *   node tests/round187geotest.js        (runs its own servers)
 */
const http = require('http'); const zlib = require('zlib'); const fs = require('fs');
const { spawn } = require('child_process');
const GEO = require('../server/geo.js');
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note != null ? ' — ' + note : ''));
const ROOT = '/home/claude/glovels/build';

/* A stand-in for DB-IP's monthly file: a few real-shaped rows, padded past
   the "is this the real file" floor with filler ranges. */
const rows = [['1.0.0.0', '1.0.0.255', 'AU'], ['41.58.0.0', '41.58.255.255', 'NG'],
  ['49.36.0.0', '49.36.255.255', 'IN'], ['181.0.0.0', '181.0.255.255', 'AR'],
  ['200.0.0.0', '200.0.255.255', 'BR'], ['2001:db8::', '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff', 'KE']];
const lines = [];
for (let i = 0; i < 60000; i++) {
  const a = 100 + Math.floor(i / 65536), b = Math.floor(i / 256) % 256, c = i % 256;
  lines.push(`${a}.${b}.${c}.0,${a}.${b}.${c}.255,ZZ`.replace('ZZ', i % 2 ? 'DE' : 'FR'));
}
const csv = rows.map(r => r.join(',')).concat(lines).sort((x, y) => {
  const n = s => s.includes(':') ? 1e12 : s.split(',')[0].split('.').reduce((a, v) => a * 256 + Number(v), 0);
  return n(x) - n(y);
}).join('\n');
const gz = zlib.gzipSync(Buffer.from(csv));
const fake = http.createServer((req, res) => {
  if (/dbip-country-lite-\d{4}-\d{2}\.csv\.gz$/.test(req.url)) { res.writeHead(200); return res.end(gz); }
  res.writeHead(404); res.end();
});

const get = (port, p, headers) => new Promise(r => http.get({ host: 'localhost', port, path: p, headers: headers || {} }, res => {
  let o = ''; res.on('data', c => o += c); res.on('end', () => { try { r(JSON.parse(o)); } catch (e) { r({}); } });
}).on('error', () => r({})));

(async () => {
  /* ------------------------------------------------- the lookup itself */
  check('Nigeria → naira', GEO.currencyFor('NG') === 'NGN');
  check('China → yuan', GEO.currencyFor('CN') === 'CNY');
  check('Senegal → West African franc', GEO.currencyFor('SN') === 'XOF');
  check('Argentina (not taken by Razorpay) → US dollars', GEO.currencyFor('AR') === 'USD');
  check('a country nobody listed → US dollars', GEO.currencyFor('ZZ') === 'USD');

  await new Promise(r => fake.listen(8077, r));
  process.env.GEO_SOURCE = 'http://localhost:8077/dbip-country-lite-{m}.csv.gz';
  const dir = '/tmp/geo-187'; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
  const done = await GEO.refresh(dir);
  check('the monthly file is fetched and packed', done === true, JSON.stringify(GEO.status()));
  check('an IPv4 address in Lagos', GEO.countryOfIp('41.58.12.9') === 'NG', GEO.countryOfIp('41.58.12.9'));
  check('an IPv4 address in India', GEO.countryOfIp('49.36.200.1') === 'IN');
  check('an IPv6 address', GEO.countryOfIp('2001:db8:1:2::5') === 'KE', GEO.countryOfIp('2001:db8:1:2::5'));
  check('an IPv4-mapped IPv6 address', GEO.countryOfIp('::ffff:200.0.3.4') === 'BR');
  check('rubbish is nobody', GEO.countryOfIp('not-an-ip') === '');
  check('and a packed copy is kept on disk', fs.existsSync(dir + '/geo-country.bin'));
  /* Patch 196: a header a visitor can type is ignored unless we said our CDN sets it. */
  const forged = GEO.forRequest({ headers: { 'cf-ipcountry': 'pk' } }, '41.58.1.1');
  check('a country header nobody vouched for is ignored — the IP decides', forged.country === 'NG' && forged.source === 'ip', JSON.stringify(forged));
  process.env.GEO_TRUST_HEADER = 'cf-ipcountry';
  const cdn = GEO.forRequest({ headers: { 'cf-ipcountry': 'pk' } }, '41.58.1.1');
  check('the CDN header we trust (GEO_TRUST_HEADER) wins over the IP', cdn.country === 'PK' && cdn.currency === 'PKR' && cdn.source === 'cdn');
  const other = GEO.forRequest({ headers: { 'x-country-code': 'us' } }, '41.58.1.1');
  check('but a different header is still ignored', other.country === 'NG', JSON.stringify(other));
  delete process.env.GEO_TRUST_HEADER;

  /* ------------------------------------------ the server, from disk */
  const dataDir = '/tmp/db-187';
  fs.rmSync(dataDir, { recursive: true, force: true }); fs.mkdirSync(dataDir);
  fs.copyFileSync(dir + '/geo-country.bin', dataDir + '/geo-country.bin');
  const kid = spawn('node', ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: '8187', DATA_DIR: dataDir, FX_AUTO: 'off', GEO_AUTO: 'off', GEO_TRUST_HEADER: 'cf-ipcountry' }) });
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); if ((await get(8187, '/api/health')).ok !== undefined || (await get(8187, '/api/pay/config')).currencies) break; }
    const ng = await get(8187, '/api/pay/config', { 'X-Forwarded-For': '41.58.77.1' });
    check('a visitor from a Lagos address is offered naira', ng.geo && ng.geo.country === 'NG' && ng.geo.currency === 'NGN', JSON.stringify(ng.geo));
    const ar = await get(8187, '/api/pay/config', { 'X-Forwarded-For': '181.0.4.4' });
    check('one from Buenos Aires is offered US dollars', ar.geo && ar.geo.country === 'AR' && ar.geo.currency === 'USD', JSON.stringify(ar.geo));
    const local = await get(8187, '/api/pay/config');
    check('an address it does not know leaves the choice to the browser', local.geo && local.geo.currency === '', JSON.stringify(local.geo));
    const cn = await get(8187, '/api/v1/app/config', { 'CF-IPCountry': 'CN' });
    check('the app is told too (China → yuan)', cn.geo && cn.geo.currency === 'CNY', JSON.stringify(cn.geo));
    check('China is in the currency list', (local.currencies || []).includes('CNY'));
  } finally { try { process.kill(-kid.pid); } catch (e) {} fake.close(); }

  console.log('\nPASS'); ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\nround187geotest: ${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
