// Load test: N virtual users against a Glovels server (best on the 68,000-row catalogue
// tests/bigcat.js builds). Each user picks a page or search from a realistic mix, waits
// 2-6 s, repeats. Not in runtests.sh. Usage:
//   SERVER_PID=<pid> node tests/loadtest.js http://localhost:8251 <users> <seconds>
const http = require('http');
const BASE = new URL(process.argv[2] || 'http://localhost:8251');
const USERS = Number(process.argv[3] || 100), SECS = Number(process.argv[4] || 40);
const agent = new http.Agent({ keepAlive: true, maxSockets: 2000 });
const countries = ['DE', 'GB', 'US', 'CA', 'IE', 'AU', 'FR'];
const fields = ['Computer Science & IT', 'Data Science, AI & Machine Learning', 'Business & Management', 'Mechanical & Automotive Engineering', 'Nursing & Allied Health Sciences', 'Finance, Banking & Accounting'];
const words = ['london', 'data', 'business', 'munich', 'engineering', 'toronto', 'nursing', 'ai'];
const pick = a => a[Math.floor(Math.random() * a.length)];
const mix = [
  [30, () => '/'],
  [15, () => '/study-in-' + pick(['germany', 'united-kingdom', 'usa', 'canada', 'ireland', 'australia'])],
  [10, () => '/universities'],
  [10, () => '/find-university?country=' + pick(countries) + '&level=master'],
  [20, () => '/api/find/match?country=' + pick(countries) + '&level=master' + (Math.random() < 0.5 ? '&field=' + encodeURIComponent(pick(fields)) : '') + (Math.random() < 0.3 ? '&q=' + pick(words) : '') + '&cgpa=' + (6 + Math.floor(Math.random() * 4)) + '&limit=30'],
  [10, () => '/api/universities/filter?country=' + pick(countries) + '&level=master' + (Math.random() < 0.7 ? '&field=' + encodeURIComponent(pick(fields)) : '')],
  [5, () => '/api/catalogue?limit=30'],
];
const total = mix.reduce((n, m) => n + m[0], 0);
function choose() { let r = Math.random() * total; for (const [w, f] of mix) { if ((r -= w) < 0) return f(); } return '/'; }
const lat = [], errs = { count: 0, by: {} }; let done = 0; const byRoute = {};
const routeOf = p => p.replace(/\?.*$/, '').replace(/^\/study-in-.*/, '/study-in-*').replace(/^\/university\/.*/, '/university/*');
function one(path) {
  return new Promise(res => {
    const t = process.hrtime.bigint();
    const req = http.request({ host: BASE.hostname, port: BASE.port, path, agent, headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1', 'X-Forwarded-For': '10.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) } }, r => {
      r.resume(); r.on('end', () => { const ms = Number(process.hrtime.bigint() - t) / 1e6; lat.push(ms); (byRoute[routeOf(path)] = byRoute[routeOf(path)] || []).push(ms); done++; if (r.statusCode >= 400) { errs.count++; errs.by[r.statusCode] = (errs.by[r.statusCode] || 0) + 1; } res(); });
    });
    req.setTimeout(20000, () => { req.destroy(new Error('timeout')); });
    req.on('error', e => { errs.count++; errs.by[e.code || e.message] = (errs.by[e.code || e.message] || 0) + 1; lat.push(20000); done++; res(); });
    req.end();
  });
}
const stop = Date.now() + SECS * 1000;
async function user() { await new Promise(r => setTimeout(r, Math.random() * 3000)); while (Date.now() < stop) { await one(choose()); await new Promise(r => setTimeout(r, 2000 + Math.random() * 4000)); } }
(async () => {
  const pid = process.env.SERVER_PID; let rss = 0;
  const mem = setInterval(() => { try { const s = require('fs').readFileSync('/proc/' + pid + '/status', 'utf8'); const m = /VmRSS:\s+(\d+)/.exec(s); if (m) rss = Math.max(rss, Number(m[1]) / 1024); } catch (e) {} }, 1000);
  await Promise.all(Array.from({ length: USERS }, user));
  clearInterval(mem);
  lat.sort((a, b) => a - b); const q = p => Math.round(lat[Math.min(lat.length - 1, Math.floor(lat.length * p))]);
  const per = {}; for (const [k, v] of Object.entries(byRoute)) { v.sort((a, b) => a - b); per[k] = { n: v.length, p50: Math.round(v[Math.floor(v.length * .5)]), p95: Math.round(v[Math.floor(v.length * .95)]) }; }
  console.log(JSON.stringify(per));
  console.log(JSON.stringify({ users: USERS, secs: SECS, requests: done, rps: +(done / SECS).toFixed(1), p50: q(0.5), p90: q(0.9), p95: q(0.95), p99: q(0.99), max: Math.round(lat[lat.length - 1]), errors: errs.count, errorsBy: errs.by, serverRssMB: Math.round(rss) }));
})();
