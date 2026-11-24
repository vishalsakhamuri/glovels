/**
 * Patch 294: the Leads command says, per counsellor, how many leads they have
 * and where each stands.
 *
 * Owner, 24 Nov: "when we get a lead the same thing applies: how many leads
 * each counsellor has and how many he converted or is working on, how many
 * follow-ups he has done, how many are not converted or still missing."
 *
 * Boots its own server, gives the demo counsellor four leads (one left new,
 * one called, one lost, one called twice), and checks her row: leads, new,
 * working, converted, not converted, no follow-up yet, follow-ups in all and
 * in seven days; that the numbers add up; the company line; and the screen.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const ROOT = '/home/claude/glovels/build';
const PORT = 8296;
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
  const dir = '/tmp/db-leadboard-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off' }) });
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); if ((await call('/api/health')).status === 200) break; }
    const admin = await login('admin@glovels.com');
    const kavya = await login('kavya@glovels.com');
    const H = { Cookie: admin }, K = { Cookie: kavya };
    const cmd = async h => (await call('/api/staff/leads/command', { headers: h || H })).body;
    const rowOf = b => (b.board || []).find(r => /Kavya/.test(r.name));
    const r0 = rowOf(await cmd());
    check('each person on the board carries where their leads stand', !!r0 && ['fresh', 'working', 'lost', 'noFollowUp', 'followUps', 'followUpsWeek'].every(k => typeof r0[k] === 'number'), JSON.stringify(r0 || {}).slice(0, 200));
    const add = async n => (await call('/api/staff/leads', { method: 'POST', headers: K, body: { name: 'Board Lead ' + n, phone: '98765' + String(10000 + n), email: 'board' + n + '@mail.test', source: 'phone' } })).body.lead;
    const L = [await add(1), await add(2), await add(3), await add(4)];
    check('four leads are added by the counsellor', L.every(x => x && x.id), JSON.stringify(L).slice(0, 120));
    const r1 = rowOf(await cmd());
    check('they are hers', r1.assigned === r0.assigned + 4, r0.assigned + ' -> ' + r1.assigned);
    const note = (id, kind, body) => call('/api/staff/lead/' + id + '/note', { method: 'POST', headers: K, body: { kind, body } });
    const n1 = await note(L[1].id, 'call', 'Called, wants Germany for winter intake.');
    await note(L[3].id, 'call', 'Called, asked to ring back.');
    await note(L[3].id, 'whatsapp', 'Sent the fee sheet on WhatsApp.');
    const lost = await call('/api/staff/lead/' + L[2].id, { method: 'PUT', headers: K, body: { status: 'lost', lostReason: 'budget' } });
    check('a call is recorded and a lead is marked lost', n1.status === 200 && lost.status === 200, n1.status + ' ' + lost.status);
    const b2 = await cmd(), r2 = rowOf(b2);
    check('follow-ups made are counted: three', r2.followUps === r0.followUps + 3 && r2.followUpsWeek === r0.followUpsWeek + 3, r0.followUps + ' -> ' + r2.followUps);
    check('the lost lead is under "not converted"', r2.lost === r0.lost + 1);
    check('the three she still holds open are being worked on or new', r2.fresh + r2.working === r1.fresh + r1.working - 1, JSON.stringify([r1.fresh, r1.working, r2.fresh, r2.working]));
    check('only the untouched one has no follow-up yet', r2.noFollowUp === r1.noFollowUp - 3, JSON.stringify([r1.noFollowUp, r2.noFollowUp]));
    check('new + working + converted + not converted = her leads', r2.fresh + r2.working + r2.conversions + r2.lost === r2.assigned, JSON.stringify([r2.fresh, r2.working, r2.conversions, r2.lost, r2.assigned]));
    const T = b2.totals;
    check('the company line adds up the same way', !!T && T.fresh + T.working + T.converted + T.lost === T.leads, JSON.stringify(T));
    check('and is the sum of the board', b2.board.reduce((n, r) => n + r.assigned, 0) === T.leads && b2.board.reduce((n, r) => n + r.lost, 0) === T.lost);
    check('the lost leads are listed with the reason', (b2.lost || []).some(x => x.id === L[2].id && x.lostReason === 'budget'));
    const mine = await cmd(K);
    check('a counsellor sees her own row', mine.board.some(r => /Kavya/.test(r.name) && r.followUps === r2.followUps) && !mine.board.some(r => r.id && !/Kavya/.test(r.name)));

    const br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1500, height: 950 } });
    await ctx.addCookies([{ name: admin.split('=')[0], value: admin.split('=').slice(1).join('='), url: 'http://localhost:' + PORT }]);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|push|serviceWorker|Notification/i.test(m.text())) errs.push(m.text()); });
    await p.goto('http://localhost:' + PORT + '/leads-command.html'); await p.waitForTimeout(1800);
    const head = await p.$eval('#crew', el => el.closest('table').querySelector('thead').textContent);
    check('the board has New, Working, Converted, Not converted, No follow-up yet and Follow-ups', ['New', 'Working', 'Converted', 'Not converted', 'No follow-up yet', 'Follow-ups', 'Follow-ups, 7 days'].every(x => head.includes(x)), head);
    const cells = await p.$$eval('#crew tr[data-cid="' + r2.id + '"] td', tds => tds.map(td => td.textContent.trim()));
    check('with her numbers', cells[1] === String(r2.assigned) && cells[2] === String(r2.fresh) && cells[3] === String(r2.working) && cells[4] === String(r2.conversions) && cells[5] === String(r2.lost) && cells[6] === String(r2.noFollowUp) && cells[7] === String(r2.followUps) && cells[8] === String(r2.followUpsWeek), cells.join(' | '));
    check('the company line is above the board', (await p.textContent('#ltot')).includes(T.leads + ' leads in all'));
    await p.evaluate(() => document.querySelector('#crew').scrollIntoView({ block: 'center' })); await p.waitForTimeout(300);
    await p.screenshot({ path: '/tmp/leadboard.png' });
    await p.click('#crew tr[data-cid="' + r2.id + '"] [data-view="lost"]'); await p.waitForTimeout(500);
    check('"Not converted" opens those leads with the reason', /Board Lead 3/.test(await p.textContent('#dList')) && /reason: budget/.test(await p.textContent('#dList')), (await p.textContent('#dList')).slice(0, 200));
    check('and her panel says it in words', /being worked on/.test(await p.textContent('#dSub')) && /follow-ups made/.test(await p.textContent('#dSub')), await p.textContent('#dSub'));
    await p.screenshot({ path: '/tmp/leadboard-lost.png' });
    await p.click('#dx'); await p.waitForTimeout(300);
    await p.click('#crew tr[data-cid="' + r2.id + '"] [data-view="nofollow"]'); await p.waitForTimeout(500);
    check('"No follow-up yet" opens the lead nobody has touched', /Board Lead 1/.test(await p.textContent('#dList')) && !/Board Lead 4/.test(await p.textContent('#dList')));
    check('the page has no script errors', errs.length === 0, errs.join(' | '));
    await br.close();
  } catch (e) { bad.push('the suite ran to the end — ' + String(e && e.message || e).slice(0, 300)); }
  finally { try { process.kill(-child.pid); } catch (e) {} }
  ok.forEach(n => console.log('  ✓ ' + n)); bad.forEach(n => console.log('  ✗ ' + n));
  console.log('leadboardtest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
