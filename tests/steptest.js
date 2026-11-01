/**
 * Patch 210: one step clock — every step is due 24 hours after it starts
 * (the step before it done), changeable to 5 hours or 5 days; the
 * university's offer and the visa decision keep their own dates; a
 * university deadline still wins; and the student sees it on the dashboard.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');

const ROOT = '/home/claude/glovels/build';
const PORT = 8210;
const BASE = 'http://localhost:' + PORT;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const jar = {};
async function req(who, method, path, body) {
  const h = { 'content-type': 'application/json' };
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, ok: r.ok, body: j };
}
const H = 3600000;

(async () => {
  const dir = '/tmp/db-step-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const env = Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off' });
  delete env.TASK_STEP_HOURS;
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore', env });
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); try { if ((await fetch(BASE + '/api/health')).ok) break; } catch (e) {} }
    await req('admin', 'POST', '/api/auth/login', { email: 'admin@glovels.com', password: 'glovels123' });
    await req('stu', 'POST', '/api/auth/login', { email: 'student@glovels.com', password: 'glovels123' });
    const me = (await req('stu', 'GET', '/api/auth/me')).body;
    const sid = (me.user || me).id;

    const rules = (await req('admin', 'GET', '/api/staff/task-rules')).body;
    check('the step time is 24 hours by default', rules.stepHours === 24, String(rules.stepHours));
    check('and the offer and visa decision are left to their own dates', (rules.outside || []).join() === 'offer,visadecision');

    /* A fresh student, so the first step (the welcome call) is the current one. */
    const stamp = Date.now().toString(36);
    const made = await req('admin', 'POST', '/api/staff/people', { name: 'Step Student', email: 'step' + stamp + '@ex.example', password: 'step-' + stamp + '-pw', role: 'student' });
    const fid = (made.body && made.body.person || {}).id;
    const tasksOf = async () => ((await req('admin', 'GET', '/api/staff/student/' + fid + '/tasks')).body || {}).tasks || [];
    let T = await tasksOf();
    const byKey = k => T.find(t => t.key === k) || {};
    const open = T.filter(t => !['done', 'dropped'].includes(t.status));
    const stepped = open.filter(t => t.basis === 'step');
    check('the step that can start now has a due time', stepped.length >= 1 && stepped.every(t => /T\d{2}:\d{2}/.test(t.due)), JSON.stringify(stepped.map(t => [t.key, t.due])));
    check('later steps wait for the one before', open.some(t => t.basis === 'waiting'), JSON.stringify(open.map(t => [t.key, t.basis])));
    check('the offer is never on the step clock', !['step'].includes(byKey('offer').basis), byKey('offer').basis);

    /* Close the current step: the next one starts, due 24 h from now. */
    const cur = stepped.sort((a, b) => (a.due < b.due ? -1 : 1))[0];
    const t0 = Date.now();
    const d = await req('admin', 'PUT', '/api/staff/task/' + cur.id, { status: 'done' });
    check('closing the current step works', d.ok, JSON.stringify(d.body).slice(0, 120));
    T = await tasksOf();
    const nowStepped = T.filter(t => !['done', 'dropped'].includes(t.status) && t.basis === 'step');
    const next = nowStepped.find(t => Math.abs(Date.parse(t.due) - (t0 + 24 * H)) < 5 * 60000);
    check('the next step starts and is due 24 hours later', !!next, JSON.stringify(nowStepped.map(t => [t.key, t.due])));

    /* 5 hours instead. */
    const map = {}; (rules.rules || []).forEach(r => { map[r.key] = Object.assign({}, r.due, r.off ? { off: true } : {}); });
    const put = await req('admin', 'PUT', '/api/staff/task-rules', { rules: map, serviceSla: rules.serviceSla, stepHours: 5 });
    check('the office can change it to 5 hours', put.ok && put.body.stepHours === 5, JSON.stringify(put.body).slice(0, 100));
    T = await tasksOf();
    const five = T.find(t => next && t.id === next.id) || {};
    check('and the open step is re-dated at once', Math.abs(Date.parse(five.due) - (t0 + 5 * H)) < 5 * 60000, five.due);
    const bad1 = await req('admin', 'PUT', '/api/staff/task-rules', { rules: map, stepHours: -3 });
    check('a negative time is refused', bad1.status === 422);
    check('a counsellor cannot change it', (await (async () => { await req('kav', 'POST', '/api/auth/login', { email: 'kavya@glovels.com', password: 'glovels123' }); return req('kav', 'PUT', '/api/staff/task-rules', { rules: map, stepHours: 1 }); })()).status === 403);

    /* Late: a step clock of a minute, a step closed, the next late after it. */
    await req('admin', 'PUT', '/api/staff/task-rules', { rules: map, serviceSla: rules.serviceSla, stepHours: 0.01 });
    await new Promise(r => setTimeout(r, 1500));
    const st = (await req('stu', 'GET', '/api/state')).body;
    const items = [].concat(...(st.journey.stages || []).map(x => x.items || []));
    check('the student sees when each step is due', items.some(i => i.due), JSON.stringify(items.slice(0, 4)));
    check('and when steps were done', items.some(i => i.doneAt));
    check('and the step time', st.journey.stepHours === 0.01);
    await req('admin', 'PUT', '/api/staff/task-rules', { rules: map, serviceSla: rules.serviceSla, stepHours: 24 });

    const b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width: 1300, height: 1000 } });
    await ctx.addCookies(jar.stu.split('; ').map(c => ({ name: c.split('=')[0], value: c.split('=').slice(1).join('='), url: BASE })));
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(BASE + '/dashboard', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
    const txt = await p.textContent('#progList').catch(() => '');
    check('the dashboard shows "Due by" on the current step', /Due by|Due /.test(txt), txt.slice(0, 200));
    check('and "Done" on finished ones', /Done /.test(txt));
    check('and the promise: each step within a day of starting', /each step is done within 1 day/.test(await p.textContent('#progCount')), await p.textContent('#progCount'));
    await p.locator('#progSec').screenshot({ path: '/tmp/student-progress.png' });
    check('no script errors', errs.length === 0, errs.join(' | '));
    await b.close();
  } catch (err) {
    bad.push('crashed: ' + err.stack);
  } finally {
    try { process.kill(-child.pid); } catch (e) { /* gone */ }
  }
  ok.forEach(x => console.log('  ✓ ' + x));
  bad.forEach(x => console.log('  ✗ ' + x));
  console.log('\nsteptest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
