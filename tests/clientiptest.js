/** Patch 214: the visitor's address behind Render's Cloudflare, not the edge's. */
const g = require('../server/geo');
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const ip = (xff, extra) => g.clientIpOf({ headers: Object.assign({ 'x-forwarded-for': xff }, extra || {}), socket: { remoteAddress: '10.1.1.1' } });
check('Italy visitor behind a Cloudflare edge', ip('93.40.1.1, 162.158.1.2') === '93.40.1.1');
check('a forged first hop is ignored', ip('1.2.3.4, 93.40.1.1, 172.70.4.5') === '93.40.1.1');
check('private Render hops are skipped too', ip('93.40.1.1, 104.23.10.1, 10.0.4.2') === '93.40.1.1');
check('IPv6 visitor behind an IPv6 edge', ip('2a01:4f8:1::1, 2400:cb00:1::5') === '2a01:4f8:1::1');
check('only the edge: CF-Connecting-IP is believed', ip('172.70.4.5', { 'cf-connecting-ip': '93.40.1.1' }) === '93.40.1.1');
check('without Cloudflare, CF-Connecting-IP is NOT believed', ip('8.8.8.8', { 'cf-connecting-ip': '93.40.1.1' }) === '8.8.8.8');
check('Cloudflare ranges: 104.16.0.0/13 and 131.0.72.0/22', g.isCloudflare('104.23.255.1') && g.isCloudflare('131.0.75.9') && !g.isCloudflare('104.24.0.0') === false);
check('ordinary addresses are not Cloudflare', !g.isCloudflare('8.8.8.8') && !g.isCloudflare('93.40.1.1') && !g.isCloudflare('2a01:4f8::1'));
ok.forEach(x => console.log('  ✓ ' + x)); bad.forEach(x => console.log('  ✗ ' + x));
console.log('\nclientiptest: ' + ok.length + ' passed, ' + bad.length + ' failed'); process.exit(bad.length ? 1 : 0);
