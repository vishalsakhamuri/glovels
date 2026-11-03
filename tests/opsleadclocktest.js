/**
 * FIX (3 Nov e2e run): the command centre's "New leads nobody has called"
 * queue runs on the lead watch's clock — the office's first-response SLA in
 * minutes — not on a 24-hour clock of its own. The board used to say
 * "4 leads are past the 15-minute SLA" in the Leads waiting tile and
 * "4 on time" in the queue right under it, about the same four people.
 *
 * Fast clocks (LEAD_MINUTE_MS=1000): a "minute" is a second.
 *
 *     node tests/opsleadclocktest.js         (boots its own server on 8227)
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8227);
const BASE = 'http://localhost:' + PORT;
const DIR = '/tmp/db-opslead-' + PORT;
let pass = 0, fail = 0;
const check = (n, c, note) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (c || note == null ? '' : ' — ' + String(note).slice(0, 220))); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const J = JSON.stringify;
let cookie = '';
async function req(method, p, body, extra) {
  const h = Object.assign({ 'content-type': 'application/json', cookie }, extra || {});
  const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length && method === 'POST' && /login/.test(p)) cookie = set.map(c => c.split(';')[0]).join('; ');
  let j = {}; try { j = await r.json(); } catch (e) { j = {}; }
  return { status: r.status, ok: r.ok, body: j };
}

(async () => {
  fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: DIR, FX_AUTO: 'off', GEO_AUTO: 'off', LEAD_MINUTE_MS: '1000', LEAD_SLA_TICK_MS: '500' }) });
  try {
    for (let i = 0; i < 120; i++) { await wait(500); try { if ((await fetch(BASE + '/api/health')).ok) break; } catch (e) { /* booting */ } }
    const l = await req('POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
    check('admin signs in', l.ok, l.status);
    const sla = await req('PUT', '/api/staff/leads/sla', { firstMins: 5, escalateMins: 10, burstMins: 1 });
    check('first-response SLA set to 5 "minutes"', sla.ok && sla.body.settings.firstMins === 5, J(sla.body));
    const e = await req('POST', '/api/enquiries', { name: 'Priya Sharma', phone: '9811100001', email: 'priya.clock@glv-sim.in', destination: 'DE', consent: 'yes' }, { 'x-forwarded-for': '203.0.113.77' });
    check('an enquiry arrives', e.ok, e.status + ' ' + J(e.body));
    let cmd = (await req('GET', '/api/staff/command')).body;
    let q = (cmd.queues || []).find(x => x.key === 'leads') || {};
    check('the queue says its SLA in the lead watch’s minutes', q.sla === '5 min', q.sla);
    check('inside the SLA the lead is not late', q.total === 1 && q.late === 0, J({ total: q.total, late: q.late }));
    const row0 = (q.rows || [])[0] || {};
    check('the row carries a minutes timer for the screen', row0.timer && /waiting/.test(row0.timer.big) && /left of 5 min/.test(row0.timer.small), J(row0.timer));
    await wait(7000);
    cmd = (await req('GET', '/api/staff/command')).body;
    q = (cmd.queues || []).find(x => x.key === 'leads') || {};
    const row = (q.rows || [])[0] || {};
    check('past the 5-minute SLA the queue counts it late — the same verdict as the Leads waiting tile', q.late === 1 && cmd.leadWatch && cmd.leadWatch.overdue === 1, J({ late: q.late, tile: cmd.leadWatch && cmd.leadWatch.overdue }));
    check('…and says by how much, in minutes', row.state === 'late' && row.overMins >= 1 && /past the 5-minute SLA/.test((row.timer || {}).small || ''), J({ state: row.state, over: row.overMins, timer: row.timer }));
    check('…with "worst" in minutes too', /min over|h over/.test(q.worst || ''), q.worst);
  } catch (err) {
    check('ran', false, err.stack);
  } finally {
    try { process.kill(-child.pid); } catch (x) { /* gone */ }
  }
  console.log('\nopsleadclocktest: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
