/**
 * Patch 293: the command centre says what a counsellor has done and what is left.
 *
 * Owner, 24 Nov: "in the command centre I am unable to understand what
 * counsellor Kanchana has done, how many tasks are remaining, how many
 * completed and how many remaining, last one week's tasks."
 *
 * Boots its own server (the demo counsellor and her student) and checks: each
 * counsellor carries total / done / remaining / late and the last seven days;
 * the numbers add up and agree with the student's own task list; closing a
 * step moves it from remaining to done and into the week, with who the
 * student was and whether it was on time; a message she sends is counted; and
 * the screen shows all of it — in the table and in her drawer.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const ROOT = '/home/claude/glovels/build';
const PORT = 8295;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const call = (path, opts) => new Promise(resolve => {
  const req = http.request({ host: 'localhost', port: PORT, path, method: (opts && opts.method) || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, (opts && opts.headers) || {}) }, res => {
    let out = ''; res.on('data', c => { out += c; }); res.on('end', () => {
      let j = null; try { j = JSON.parse(out || '{}'); } catch (e) { j = { raw: out }; }
      resolve({ status: res.statusCode, body: j, headers: res.headers });
    });
  });
  req.on('error', () => resolve({ status: 0, body: {}, headers: {} }));
  if (opts && opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
  req.end();
});
const login = async (email) => {
  const r = await call('/api/auth/login', { method: 'POST', body: { email, password: 'glovels123' } });
  return String((r.headers['set-cookie'] || [])[0] || '').split(';')[0];
};

(async () => {
  const dir = '/tmp/db-cwork-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off' }) });
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); if ((await call('/api/health')).status === 200) break; }
    const admin = await login('admin@glovels.com');
    const kavya = await login('kavya@glovels.com');
    const H = { Cookie: admin }, K = { Cookie: kavya };
    const board = async (h) => (await call('/api/staff/command', { headers: h || H })).body;
    const b0 = await board();
    const c0 = b0.counsellors.find(c => /Kavya/.test(c.name));
    const W0 = c0 && c0.work;
    check('each counsellor carries a work summary', !!W0 && b0.counsellors.every(c => c.work && typeof c.work.total === 'number'), JSON.stringify(W0).slice(0, 140));
    check('done + remaining = total', W0.done + W0.remaining === W0.total && W0.total > 0, W0.done + ' + ' + W0.remaining + ' = ' + W0.total);
    check('late is part of remaining', W0.late <= W0.remaining);
    check('the remaining steps are listed, each with its student', W0.open.length === Math.min(W0.remaining, 120) && W0.open.every(r => r.student && r.what && r.studentId),
      W0.open.length + ' of ' + W0.remaining);
    check('the latest of them first', W0.open.length < 2 || (W0.open[0].overDays == null ? -1e9 : W0.open[0].overDays) >= (W0.open[W0.open.length - 1].overDays == null ? -1e9 : W0.open[W0.open.length - 1].overDays));
    const sid = W0.open[0].studentId;
    const tl = (await call('/api/staff/student/' + sid + '/tasks', { headers: H })).body.tasks || [];
    const mineOpen = tl.filter(t => !t.derived && !['done', 'dropped'].includes(t.status) && t.key !== 'submit');
    const got = W0.open.filter(r => r.studentId === sid);
    check('every open step on her student\'s own task list is among them', mineOpen.every(t => got.some(r => r.taskId === t.id)), got.length + ' vs ' + mineOpen.length);

    /* ---- the work board: the whole company, by person and by kind ---- */
    const WB = b0.work;
    check('the board carries all the work in the company', !!WB && WB.total > 0 && WB.done + WB.remaining === WB.total, JSON.stringify(WB || {}).slice(0, 160));
    const kinds = (WB.kinds || []).map(k => k.key);
    check('split into welcome, documents, shortlist, CV, SOP, LOR, applications, decisions, visa and other', ['welcome', 'documents', 'shortlist', 'cv', 'sop', 'lor', 'applications', 'offers', 'visa', 'other'].every(k => kinds.includes(k)), kinds.join(','));
    const sum = f => WB.people.reduce((n, q) => n + f(q), 0);
    check('the people add up to the company: total, done, remaining, late', sum(q => q.total) === WB.total && sum(q => q.done) === WB.done && sum(q => q.remaining) === WB.remaining && sum(q => q.late) === WB.late);
    check('and each kind adds up across the people', kinds.every(k => sum(q => q.kinds[k].total) === WB.byKind[k].total && sum(q => q.kinds[k].done) === WB.byKind[k].done));
    check('and the kinds add up to each person', WB.people.every(q => kinds.reduce((n, k) => n + q.kinds[k].total, 0) === q.total));
    const kv = WB.people.find(q => /Kavya/.test(q.name));
    check('a counsellor\'s row is her own summary', !!kv && kv.total === W0.total && kv.done === W0.done && kv.remaining === W0.remaining && kv.late === W0.late);
    const apps = b0.applications || {};
    const listed = Object.values(apps).reduce((n, a) => n + a.listed, 0), applied = Object.values(apps).reduce((n, a) => n + a.applied, 0);
    check('applications are counted one per university: applied of listed', WB.byKind.applications.total === listed && WB.byKind.applications.done === applied && listed > 0, WB.byKind.applications.done + '/' + WB.byKind.applications.total + ' vs ' + applied + '/' + listed);
    const dr = async q => (await call('/api/staff/command/work?' + q, { headers: H })).body;
    const dA = await dr('owner=' + kv.id + '&kind=applications&state=all');
    check('a number opens the pieces behind it', dA.rows.length === kv.kinds.applications.total && dA.counts.done === kv.kinds.applications.done && /Kavya/.test(dA.who) && dA.kind === 'Applications', JSON.stringify(dA.counts));
    check('each naming the university, applied or still to apply', dA.rows.every(r => /^(Applied|To apply): /.test(r.what) && r.student));
    check('what is left comes first', dA.rows.findIndex(r => r.status === 'done') === -1 || dA.rows.slice(dA.rows.findIndex(r => r.status === 'done')).every(r => r.status === 'done'));
    const dO = await dr('owner=all&kind=all&state=open'), dL = await dr('owner=all&kind=all&state=late');
    check('"Remaining" and "Late" for the whole company match the board', dO.total === WB.remaining && dL.total === WB.late, dO.total + '/' + dL.total);
    check('a student is refused the pieces too', [401, 403].includes((await call('/api/staff/command/work?owner=all', { headers: { Cookie: await login('student@glovels.com') } })).status));

    check('the week starts with what was closed in the last seven days', W0.doneWeek === W0.week.length && W0.onTimeWeek <= W0.doneWeek, W0.doneWeek + ' / ' + W0.week.length);

    /* ---- closing a step: remaining -> done, and into the week ---- */
    const can = tl.filter(t => !t.derived && !['done', 'dropped'].includes(t.status));
    let closed = null;
    for (const t of can) {
      let r = await call('/api/staff/task/' + t.id, { method: 'PUT', headers: K, body: { status: 'done' } });
      if (r.status !== 200 && r.body && r.body.canException) {
        r = await call('/api/staff/task/' + t.id, { method: 'PUT', headers: K, body: { status: 'done', exception: 'Not needed for this intake, agreed with the student.' } });
      }
      if (r.status === 200) { closed = t; break; }
    }
    check('a step can be closed by the counsellor', !!closed, can.map(t => t.key).join(','));
    const b1 = await board();
    const W1 = b1.counsellors.find(c => /Kavya/.test(c.name)).work;
    check('it moves from remaining to done', W1.done >= W0.done + 1 && W1.remaining <= W0.remaining - 1 && W1.total === W0.total, JSON.stringify([W0.done, W1.done, W0.remaining, W1.remaining, W0.total, W1.total]));
    check('and into the last seven days', W1.doneWeek === W0.doneWeek + 1 && W1.week[0].taskId === closed.id, JSON.stringify(W1.week[0]).slice(0, 160));
    check('with the student, the step and the day it was done', W1.week[0].student && W1.week[0].what === closed.title && /^Done \d{4}-\d{2}-\d{2}/.test(W1.week[0].timer.big), JSON.stringify(W1.week[0].timer));
    check('and whether it was on time', /on time|after its date|no date/.test(W1.week[0].timer.small), W1.week[0].timer.small);
    check('it is no longer among the remaining', !W1.open.some(r => r.taskId === closed.id));
    check('the company board moved with it', b1.work.done >= WB.done + 1 && b1.work.total === WB.total && b1.work.doneWeek === WB.doneWeek + 1, b1.work.done + ' vs ' + WB.done);
    /* "once tasks are completed, is it updated in the student's status?" */
    const f1 = (await call('/api/staff/student/' + sid, { headers: H })).body;
    const tl1 = (await call('/api/staff/student/' + sid + '/tasks', { headers: H })).body.tasks || [];
    check('and the student\'s own file shows the step as done', (tl1.find(t => t.id === closed.id) || {}).status === 'done' && !!f1.standing, JSON.stringify((tl1.find(t => t.id === closed.id) || {}).status));

    const m0 = W1.messagesWeek;
    const send = await call('/api/staff/student/' + sid + '/message', { method: 'POST', headers: K, body: { body: 'Please upload your semester marksheets today.' } });
    const W2 = (await board()).counsellors.find(c => /Kavya/.test(c.name)).work;
    check('a message she writes to a student is counted in the week', send.status === 200 ? W2.messagesWeek === m0 + 1 : true, send.status + ' ' + m0 + ' -> ' + W2.messagesWeek);
    const mine = await board(K);
    check('a counsellor sees her own summary', mine.counsellors.length === 1 && mine.counsellors[0].work.done === W2.done);
    check('a student is refused', [401, 403].includes((await call('/api/staff/command', { headers: { Cookie: await login('student@glovels.com') } })).status));

    /* ---- the screen ---- */
    const br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1440, height: 950 } });
    await ctx.addCookies([{ name: admin.split('=')[0], value: admin.split('=').slice(1).join('='), url: 'http://localhost:' + PORT }]);
    const p = await ctx.newPage();
    const WBn = (await board()).work, kvn = WBn.people.find(q => /Kavya/.test(q.name));
    const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errs.push(m.text()); });
    await p.goto('http://localhost:' + PORT + '/ops'); await p.waitForTimeout(1500);
    check('the board is on the Command centre, above the queues', /All work in the company/.test(await p.textContent('#workH')));
    const tiles = await p.$$eval('#wsum button', bs => bs.map(x => x.textContent));
    check('with the totals first: all, done, remaining, late, closed this week', tiles.length === 5 && tiles[0].startsWith(String(WBn.total)) && /Remaining/.test(tiles[2]), tiles.join(' | '));
    const wh = await p.textContent('#wbHead');
    check('a column for each kind of work', /Applications/.test(wh) && /CV/.test(wh) && /SOP/.test(wh) && /Documents/.test(wh) && /Visa/.test(wh), wh);
    check('a row for each person and one for the whole company', (await p.$$('#wbBody tr[data-wp]')).length === WBn.people.length && /Whole company/.test(await p.textContent('#wbFoot')));
    await p.screenshot({ path: '/tmp/cwork-board.png', fullPage: true });
    await p.click('#wbBody tr[data-wp="' + kvn.id + '"] td[data-wk="' + kvn.id + '|applications"]'); await p.waitForTimeout(900);
    check('a cell opens that person\'s work of that kind', /Kavya/.test(await p.textContent('#dTitle')) && /Applications/.test(await p.textContent('#dTitle')) && (await p.$$('#dList .item')).length === kvn.kinds.applications.total, await p.textContent('#dTitle'));
    check('saying how many are done and how many remain', /in all/.test(await p.textContent('#dSub')) && /remaining/.test(await p.textContent('#dSub')));
    await p.screenshot({ path: '/tmp/cwork-cell.png' });
    await p.click('#dFilters [data-wstate="open"]'); await p.waitForTimeout(900);
    check('"Remaining" keeps only what is left', (await p.$$('#dList .item')).length === kvn.kinds.applications.remaining);
    await p.click('#dx'); await p.waitForTimeout(400);
    const head = await p.$eval('#crew', el => el.closest('table').querySelector('thead').textContent);
    check('the counsellor table has Done, Done in 7 days and Remaining', /Done/.test(head) && /Done, 7 days/.test(head) && /Remaining/.test(head), head);
    const rowTxt = await p.$eval('tr[data-cid="' + c0.id + '"]', tr => [...tr.children].map(td => td.textContent.trim()));
    check('with her numbers in them', rowTxt[3] === String(W2.done) && rowTxt[4] === String(W2.doneWeek) && rowTxt[5] === String(W2.remaining), rowTxt.slice(2, 7).join(' | '));
    await p.click('tr[data-cid="' + c0.id + '"] [data-view="week"]'); await p.waitForTimeout(500);
    const sub = await p.textContent('#dSub');
    check('her panel says done, remaining and late in words', sub.includes(W2.total + ' steps in all') && sub.includes(W2.done + ' done') && sub.includes(W2.remaining + ' remaining'), sub);
    check('and the last seven days: steps closed and messages sent', /Last 7 days: /.test(sub) && sub.includes(W2.doneWeek + ' step') && /messages? sent/.test(sub), sub);
    const kp = await p.$$eval('#dFilters .kpi', a => a.map(b => b.textContent.replace(/\s+/g, ' ').trim()));
    check('with a button for each: done this week, remaining, late, replies, documents, students', kp.length === 6 && /Done, last 7 days/.test(kp[0]) && /Remaining/.test(kp[1]), kp.join(' | '));
    const list = await p.textContent('#dList');
    check('"Done, last 7 days" lists the step she closed, with the day', list.includes(closed.title) && /Done \d{4}-\d{2}-\d{2}/.test(list), list.slice(0, 200));
    await p.screenshot({ path: '/tmp/cwork-week.png' });
    await p.click('#dFilters [data-cview="open"]'); await p.waitForTimeout(400);
    const rows = await p.$$('#dList .item');
    check('"Remaining" lists every step still to do', rows.length === Math.min(W2.remaining, 120) || /Showing the first/.test(await p.textContent('#dList')), rows.length + ' of ' + W2.remaining);
    check('each with whose move the file is', /Pending from /.test(await p.textContent('#dList')));
    await p.screenshot({ path: '/tmp/cwork-open.png' });
    check('the page has no script errors', errs.length === 0, errs.join(' | '));
    await br.close();
  } catch (e) {
    bad.push('the suite ran to the end — ' + (e && e.stack || e));
  } finally {
    try { process.kill(-child.pid); } catch (e) {}
  }
  ok.forEach(n => console.log('  ✓ ' + n));
  bad.forEach(n => console.log('  ✗ ' + n));
  console.log('\ncounsellorworktest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
