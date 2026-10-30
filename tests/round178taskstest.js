/*
 * Round 178 — the tasks board, the student's Tasks tab and the bell, from
 * the testers' 30 Oct "Status and History" review.
 *
 *   BUG-087  Organisation → Tasks → "The work itself": ONE ROW PER STUDENT —
 *            the step that needs doing now, its date, "N of M done", the
 *            actions, and "View all steps" opening the timeline in place.
 *            Steps that cannot start yet (Offer letter, Visa decision,
 *            Pre-departure on a file with no application) are upcoming in the
 *            timeline, never current work. Filters by need.
 *   BUG-088  sorted by urgency (most overdue first → due soon → undated), an
 *            "Overdue" state label and an Overdue count.
 *   BUG-089  finished steps say "Done 30 Oct 2026 · by <who>" or "Ticked
 *            automatically (the applications are past this stage)".
 *   BUG-090  the reason a step cannot be ticked is text under the step.
 *   BUG-091  the counsellor's Tasks tab is the same timeline; works at 375px.
 *   BUG-095  the bell groups alerts by student, most urgent first, "+N more".
 *
 * Port 8130 by default:  bash srv.sh 8130 && node round178taskstest.js
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8130';
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-claude/1786b8f2-34f3-577c-8e36-0bf9ca4f2fdf/scratchpad/oct30/shots';

let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + String(e ?? '').slice(0, 500))); };
const J = x => JSON.stringify(x);

const jar = {};
async function req(who, method, path, body) {
  const h = { 'content-type': 'application/json', 'x-forwarded-for': '10.178.' + (who.length) + '.' + (9 + who.charCodeAt(0) % 200) };
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, ok: r.ok, body: j || {} };
}
const login = (who, e, p) => req(who, 'POST', '/api/auth/login', { email: e, password: p });
/* Calendar days in India, like the server. */
const istDay = n => new Date(Date.now() + 5.5 * 3600e3 + (n || 0) * 864e5).toISOString().slice(0, 10);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const human = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d); return Number(m[3]) + ' ' + MON[Number(m[2]) - 1] + ' ' + m[1]; };
const LOCKED_KEYS = ['offer', 'visadocs', 'visa', 'visadecision', 'predeparture'];

(async () => {
  const stamp = Date.now().toString(36);
  await login('a', 'admin@glovels.com', 'glovels123');
  const cName = 'R178 Bhargav ' + stamp;
  const cE = 'c178' + stamp + '@glovels.com', cP = 'c178-' + stamp;
  let r = await req('a', 'POST', '/api/staff/people', { name: cName, email: cE, password: cP, role: 'counsellor' });
  const cId = r.body && r.body.person && r.body.person.id;
  ok('setup: a counsellor', !!cId, J(r.body));
  await login('c', cE, cP);
  await req('c', 'POST', '/api/auth/change', { password: cP + 'X' });
  await login('c', cE, cP + 'X');

  const mk = async tag => {
    const e = tag + stamp + '@ex.example', p = tag + '-' + stamp;
    const who = 's' + tag;
    r = await req('a', 'POST', '/api/staff/people', { name: 'R178 ' + tag + ' ' + stamp, email: e, password: p, role: 'student' });
    const sid = r.body.person.id;
    await req('a', 'PUT', '/api/staff/student/' + sid + '/counsellor', { counsellorId: cId });
    await login(who, e, p);
    await req(who, 'POST', '/api/auth/change', { password: p + 'X' });
    await login(who, e, p + 'X');
    r = await req(who, 'POST', '/api/orders', { packageId: 'pkg-boarding', name: 'R178 ' + tag, email: e, phone: '9876543210', acceptedTerms: true });
    ok('setup: ' + tag + ' buys the boarding package', r.ok, r.status + ' ' + J(r.body).slice(0, 160));
    return { sid, who, name: 'R178 ' + tag + ' ' + stamp };
  };
  const A = await mk('alpha'), B = await mk('bravo'), C = await mk('charlie');
  const tasksOf = async id => (await req('a', 'GET', '/api/staff/student/' + id + '/tasks')).body.tasks || [];
  const task = async (id, re) => (await tasksOf(id)).find(t => re.test(t.title)) || null;
  const redate = async (id, re, n) => { const t = await task(id, re); return req('a', 'PUT', '/api/staff/task/' + t.id, { due: istDay(n) }); };

  /* A: welcome call ticked by the counsellor; the documents step pushed out
     three weeks, so nothing on the file is due inside a week. */
  const aw = await task(A.sid, /^Welcome call/);
  r = await req('c', 'PUT', '/api/staff/task/' + aw.id, { status: 'done' });
  ok('setup: the counsellor ticks A’s welcome call', r.ok, r.status + ' ' + J(r.body));
  for (const re of [/^Profile completed/, /^Shortlist confirmed/]) await redate(A.sid, re, 25);
  /* B: the welcome call ten days overdue. */
  r = await redate(B.sid, /^Welcome call/, -10);
  ok('setup: B’s welcome call is re-dated ten days back', r.ok, r.status + ' ' + J(r.body));
  /* C: a programme on the list and an application filed — the early steps
     tick themselves; the documents step three days overdue. */
  const cat = (await req('a', 'GET', '/api/staff/catalogue?per=40')).body.programmes || [];
  const P1 = cat.find(x => x && x.id && x.university);
  await req('a', 'POST', '/api/staff/student/' + C.sid + '/shortlist', { id: P1.id, force: true });
  r = await req('a', 'PUT', '/api/staff/student/' + C.sid + '/application/' + encodeURIComponent(P1.id), { stage: 3, outcome: '' });
  ok('setup: C’s application is at stage 3', r.ok, r.status + ' ' + J(r.body).slice(0, 160));
  await redate(C.sid, /^Profile completed/, -3);

  const board = async q => (await req('a', 'GET', '/api/staff/tasks?view=students&who=' + cId + (q || ''))).body;

  /* ================================================ BUG-087: one row per student */
  console.log('\nBUG-087 — one row per student, the step that needs doing now');
  let bd = await board('&need=live');
  const rows = bd.students || [];
  ok('087: Still to do for the counsellor → 3 rows (one per student), not one per step', rows.length === 3, rows.length + ' ' + J(rows.map(x => x.student)));
  const rowOf = s => rows.find(x => x.studentId === s.sid) || {};
  const rA = rowOf(A), rB = rowOf(B), rC = rowOf(C);
  ok('087: each row carries the whole timeline (9–13 steps) and "N of M done"',
    rows.every(x => (x.steps || []).length >= 9 && (x.steps || []).length <= 14 && x.progress && x.progress.total === x.steps.length),
    J(rows.map(x => [x.student, (x.steps || []).length, x.progress])));
  ok('087: every row names exactly one current step', rows.every(x => x.current && x.steps.filter(s => s.current).length === 1), J(rows.map(x => x.current && x.current.title)));
  const stepA = k => (rA.steps || []).find(s => s.key === k) || {};
  ok('087: on a file with no application, Offer / Visa / Visa decision / Pre-departure are locked, not open work',
    LOCKED_KEYS.every(k => stepA(k).state === 'locked'), J(LOCKED_KEYS.map(k => [k, stepA(k).state])));
  ok('087: …each with the reason it cannot start ("Unlocks after …")',
    stepA('offer').lockReason === 'Unlocks after an application is submitted'
    && stepA('visadocs').lockReason === 'Unlocks after the offer letter is recorded'
    && /^Unlocks after/.test(stepA('predeparture').lockReason), J(LOCKED_KEYS.map(k => stepA(k).lockReason)));
  ok('087: the current step is never a locked one', rows.every(x => !LOCKED_KEYS.includes(x.current.key) || x.current.lockReason === ''), J(rows.map(x => x.current.key)));
  ok('087: locked steps are not counted as open or overdue work', LOCKED_KEYS.every(k => !stepA(k).overdue) && rA.open === rA.steps.filter(s => ['current', 'overdue', 'upcoming'].includes(s.state)).length, J({ open: rA.open }));
  const rC2 = (rC.steps || []).find(s => s.key === 'offer') || {};
  ok('087: once an application is filed the offer step unlocks (C)', rC2.state !== 'locked', J(rC2));
  ok('087: the row says who looks after the student and where the file is', rA.counsellor === cName && rA.phase && rA.phase.label, J({ c: rA.counsellor, p: rA.phase }));

  /* ================================================ BUG-088: urgency order + Overdue */
  console.log('\nBUG-088 — most overdue first, an Overdue state and count');
  ok('088: B (10 days overdue) first, C (3 days) second, A (nothing due this week) last',
    rows[0].studentId === B.sid && rows[1].studentId === C.sid && rows[2].studentId === A.sid, J(rows.map(x => [x.student, x.need, x.current.over])));
  ok('088: B’s current step is the overdue welcome call, flagged overdue, 10 days', rB.current.key === 'welcome' && rB.current.overdue === true && rB.current.over === 10 && rB.need === 'overdue', J(rB.current));
  ok('088: C’s current step is the overdue documents step (3 days)', rC.current.key === 'profile' && rC.current.over === 3 && rC.need === 'overdue', J(rC.current));
  ok('088: A needs nothing this week → upcoming', rA.need === 'upcoming', J({ need: rA.need, cur: rA.current }));
  ok('088: an Overdue count of 2 students', bd.counts && bd.counts.overdue === 2, J(bd.counts));
  ok('088: and a count of overdue steps', bd.counts.late >= 2, J(bd.counts));
  let x = await board('&need=late');
  ok('088: filter Overdue → B and C', (x.students || []).map(s => s.studentId).sort().join() === [B.sid, C.sid].sort().join(), J((x.students || []).map(s => s.student)));
  x = await board('&need=now');
  ok('088: filter Needs action now → includes the overdue ones', [B.sid, C.sid].every(id => (x.students || []).some(s => s.studentId === id)), J((x.students || []).map(s => s.student)));
  x = await board('&need=upcoming');
  ok('088: filter Upcoming → A only', (x.students || []).length === 1 && x.students[0].studentId === A.sid, J((x.students || []).map(s => s.student)));
  ok('088: the counts do not change with the filter', J(x.counts) === J(bd.counts), J([x.counts, bd.counts]));
  const undated = (rA.steps || []).filter(s => !s.due && s.state !== 'done' && s.state !== 'locked');
  ok('088: within a timeline undated steps exist but are never chosen ahead of a dated one', !undated.length || !!rA.current.due, J({ cur: rA.current.title, due: rA.current.due }));

  /* ================================================ BUG-089: done by, done when */
  console.log('\nBUG-089 — finished steps: when and by whom, or ticked automatically');
  const aWel = stepA('welcome');
  ok('089: A’s welcome call: done today, by the counsellor, not derived', aWel.state === 'done' && aWel.doneAt === istDay(0) && aWel.doneBy === cName && !aWel.derived, J(aWel));
  const cWel = (rC.steps || []).find(s => s.key === 'welcome') || {};
  ok('089: C’s welcome call: ticked automatically by the applications, nobody named', cWel.state === 'done' && cWel.derived && !cWel.doneBy, J(cWel));
  x = await board('&need=done');
  ok('089: filter Finished → students with finished work, latest first, each with its latest finished step',
    (x.students || []).length >= 2 && x.students.every(s => s.latestDone && s.latestDone.state === 'done'), J((x.students || []).map(s => [s.student, s.latestDone && s.latestDone.title])));

  /* ================================================ BUG-090: the reason as text */
  console.log('\nBUG-090 — why a step cannot be ticked');
  const aProf = stepA('profile');
  ok('090: the documents step carries the reason it cannot be ticked', /required documents/.test(aProf.block || ''), J(aProf));
  const cOffer = (rC.steps || []).find(s => s.key === 'offer') || {};
  ok('090: …and the offer step on C (application filed, no offer) says "No offer is recorded yet"', /No offer is recorded/.test(cOffer.block || ''), J(cOffer));
  ok('090: a locked step has a lockReason, not a tick-block', !stepA('visadecision').block && !!stepA('visadecision').lockReason, J(stepA('visadecision')));

  /* ================================================ BUG-091: the student record */
  console.log('\nBUG-091 — the student record carries the timeline');
  const rec = (await req('a', 'GET', '/api/staff/student/' + A.sid)).body || {};
  ok('091: GET /api/staff/student/:id has `timeline` with the same steps as the board', rec.timeline && rec.timeline.steps.length === rA.steps.length && rec.timeline.current.id === rA.current.id, J(rec.timeline && rec.timeline.current));
  const own = (await req('c', 'GET', '/api/staff/student/' + A.sid + '/tasks')).body || {};
  ok('091: …and so does GET …/tasks, for the counsellor', own.timeline && own.timeline.steps.length === rA.steps.length, J(own.timeline && own.timeline.progress));
  ok('091: the counsellor sees their own three on the board', ((await req('c', 'GET', '/api/staff/tasks?view=students')).body.students || []).length === 3);

  /* ================================================ the old API */
  console.log('\nthe old task list still answers');
  const old = (await req('a', 'GET', '/api/staff/tasks?state=live&who=' + cId)).body || {};
  ok('old: GET /api/staff/tasks?state=live still returns task rows', Array.isArray(old.tasks) && old.tasks.length > 3 && old.tasks.every(t => t.id && t.title), (old.tasks || []).length);
  ok('old: …with the scoreboard and the funnel', Array.isArray(old.people) && Array.isArray(old.funnel));

  /* ================================================ one late count */
  console.log('\nlocked steps are never late — header, Tasks badge, bell and board agree');
  r = await redate(A.sid, /^Offer letter/, -5);
  ok('setup: A’s (locked) offer step is re-dated five days back', r.ok, r.status + ' ' + J(r.body));
  const rA2 = ((await board('&need=all')).students || []).find(s => s.studentId === A.sid) || {};
  const off2 = (rA2.steps || []).find(s => s.key === 'offer') || {};
  ok('late: the board still shows it locked, not overdue, and A has nothing overdue', off2.state === 'locked' && !off2.overdue && rA2.overdue === 0 && rA2.need !== 'overdue', J({ off2, o: rA2.overdue, n: rA2.need }));
  const recA = (await req('a', 'GET', '/api/staff/student/' + A.sid)).body || {};
  ok('late: the file header (phase.late) agrees — 0', (recA.phase || {}).late === 0 && recA.timeline.overdue === 0, J({ late: (recA.phase || {}).late, tl: recA.timeline.overdue }));
  const recC = (await req('a', 'GET', '/api/staff/student/' + C.sid)).body || {};
  ok('late: and on C the header and the timeline give the same number', (recC.phase || {}).late === recC.timeline.overdue && recC.timeline.overdue >= 1, J({ late: (recC.phase || {}).late, tl: recC.timeline.overdue }));
  const alA = ((await req('a', 'GET', '/api/staff/alerts')).body.alerts || []).filter(a => a.kind === 'task' && (a.subject || {}).studentId === A.sid);
  ok('late: the bell raises no "past the agreed date" alert for A', alA.length === 0, J(alA));

  /* ================================================ BUG-095: the bell */
  console.log('\nBUG-095 — the bell, one entry per student');
  const al = (await req('a', 'GET', '/api/staff/alerts')).body || {};
  const groups = al.groups || [];
  ok('095: /api/staff/alerts returns `groups`', groups.length > 0, J(Object.keys(al)));
  const sids = groups.filter(g => g.studentId != null).map(g => g.studentId);
  ok('095: one group per student', new Set(sids).size === sids.length, J(sids));
  ok('095: every alert is in exactly one group', groups.reduce((n, g) => n + g.count, 0) === al.counts.total, groups.reduce((n, g) => n + g.count, 0) + ' vs ' + al.counts.total);
  const RANK = { now: 0, soon: 1, watch: 2 };
  ok('095: the most urgent student first', groups.every((g, i) => !i || RANK[groups[i - 1].urgency] <= RANK[g.urgency]), J(groups.map(g => g.urgency)));
  ok('095: inside a group the most urgent alert first', groups.every(g => g.alerts.every((a, i) => !i || RANK[g.alerts[i - 1].urgency] <= RANK[a.urgency])));
  const multi = groups.find(g => g.count > 1);
  ok('095: a student with several alerts is one group holding them all', !!multi && multi.alerts.length === multi.count, J(groups.map(g => g.count)));
  const gB = groups.find(g => g.studentId === B.sid);
  ok('095: B’s group is named and carries the overdue-task alert', gB && gB.name === B.name && gB.alerts.some(a => a.kind === 'task'), J(gB && { n: gB.name, k: gB.alerts.map(a => a.kind) }));
  ok('095: the flat `alerts` list is still there for older callers', Array.isArray(al.alerts) && al.alerts.length === Math.min(200, al.counts.total));

  /* ================================================ the screens */
  console.log('\nthe screens');
  const b = await chromium.launch();
  const errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
    await ctx.request.post(BASE + '/api/auth/login', { data: { email: 'admin@glovels.com', password: 'glovels123' } });
    const ap = await ctx.newPage();
    ap.on('pageerror', e => errs.push('admin: ' + e.message));
    await ap.goto(BASE + '/admin#tasks', { waitUntil: 'domcontentloaded' });
    await ap.waitForTimeout(3200);
    await ap.selectOption('#tkWho', String(cId)).catch(() => {});
    await ap.waitForTimeout(1500);
    let n = await ap.$$eval('#tkRows .tks', l => l.length);
    ok('087 UI: Still to do for the counsellor → 3 rows on the screen', n === 3, n);
    const firstRow = await ap.$eval('#tkRows .tks', e => e.textContent.replace(/\s+/g, ' '));
    ok('088 UI: the first row is B, labelled Overdue, "10 days overdue"', firstRow.includes(B.name) && /Overdue/.test(firstRow) && /10 days overdue/.test(firstRow), firstRow.slice(0, 300));
    ok('088 UI: no row says "Not started" for an overdue step', !(await ap.$$eval('#tkRows .tks.over .tks-step .st', l => l.map(e => e.textContent))).includes('Not started'));
    const chips = await ap.$eval('#tkNeed', e => e.textContent.replace(/\s+/g, ' '));
    ok('088 UI: the filters by need, with the Overdue count', /Needs action now/.test(chips) && /Overdue\s*2/.test(chips) && /Upcoming/.test(chips) && /Finished/.test(chips), chips);
    const rowSel = '[data-tkrow="' + A.sid + '"]';
    ok('087 UI: the row shows "N of M done"', new RegExp('\\d+ of ' + rA.steps.length + ' done').test(await ap.$eval(rowSel, e => e.textContent)));
    ok('087 UI: the timeline is closed until asked for', await ap.$eval('#tl-' + A.sid, e => e.hidden));
    await ap.click(rowSel + ' [data-tkview]');
    await ap.waitForTimeout(300);
    const tl = await ap.$eval('#tl-' + A.sid, e => ({ hidden: e.hidden, n: e.querySelectorAll('li').length, cur: e.querySelectorAll('li.current').length, text: e.textContent.replace(/\s+/g, ' ') }));
    ok('087 UI: "View all steps" opens the whole timeline in place (' + rA.steps.length + ' steps)', !tl.hidden && tl.n === rA.steps.length && tl.n >= 9, J({ n: tl.n, hidden: tl.hidden }));
    ok('087 UI: the current step is highlighted (exactly one)', tl.cur === 1, tl.cur);
    ok('087 UI: upcoming steps say why they are locked', /Unlocks after an application is submitted/.test(tl.text) && /Unlocks after the offer letter is recorded/.test(tl.text), tl.text.slice(0, 300));
    ok('089 UI: the done step says "Done ' + human(istDay(0)) + ' · by ' + cName + '"', tl.text.includes('Done ' + human(istDay(0)) + ' · by ' + cName), tl.text.slice(0, 300));
    ok('090 UI: the reason the documents step cannot be ticked is written under it', /Can’t be ticked yet: .*required documents/.test(tl.text), tl.text.slice(0, 400));
    ok('090 UI: …and its button is disabled', await ap.$eval('#tl-' + A.sid + ' li[data-tkstep="' + aProf.id + '"] [data-tkdone]', e => e.disabled));
    await ap.screenshot({ path: SHOTS + '/r178-admin-tasks-1400.png', fullPage: false }).catch(() => {});
    await ap.$eval('#tkRows', e => e.scrollIntoView()).catch(() => {});
    await ap.screenshot({ path: SHOTS + '/r178-admin-tasks-timeline-1400.png', fullPage: true }).catch(() => {});
    /* The C row: derived steps. */
    await ap.click('[data-tkrow="' + C.sid + '"] [data-tkview]');
    await ap.waitForTimeout(200);
    const tlC = await ap.$eval('#tl-' + C.sid, e => e.textContent.replace(/\s+/g, ' '));
    ok('089 UI: a step the applications ticked says "Ticked automatically"', /Ticked automatically \(the applications are past this stage\)/.test(tlC), tlC.slice(0, 300));
    /* Filters from the chips. */
    await ap.click('[data-tkneed="late"]');
    await ap.waitForTimeout(1200);
    n = await ap.$$eval('#tkRows .tks', l => l.length);
    ok('088 UI: the Overdue chip → 2 rows', n === 2, n);
    ok('087 UI: an expanded timeline stays open across a reload of the list', await ap.$eval('#tl-' + C.sid, e => !e.hidden).catch(() => false));
    await ap.selectOption('#tkState', 'done');
    await ap.waitForTimeout(1200);
    const fin = await ap.$eval('#tkRows', e => e.textContent.replace(/\s+/g, ' '));
    ok('089 UI: Finished rows say "Done … · by …" or "Ticked automatically"', /Done \d{1,2} [A-Z][a-z]{2} \d{4} · by /.test(fin) || /Ticked automatically/.test(fin), fin.slice(0, 300));
    ok('089 UI: Finished rows do not offer "mark done"', !(await ap.$('#tkRows .tks-act [data-tkdone]')));
    await ap.screenshot({ path: SHOTS + '/r178-admin-finished-1400.png' }).catch(() => {});
    await ap.selectOption('#tkState', 'live');
    await ap.waitForTimeout(1200);

    /* The bell at 1400. */
    await ap.click('#bell');
    await ap.waitForTimeout(1200);
    const bell = await ap.evaluate(() => ({
      groups: document.querySelectorAll('#bellPanel .alg').length,
      firstAl: (document.querySelector('#bellPanel .alg .al') || {}).className || '',
      more: document.querySelectorAll('#bellPanel [data-almore]').length,
      shown: [...document.querySelectorAll('#bellPanel .al')].filter(e => e.offsetParent).length,
      all: document.querySelectorAll('#bellPanel .al').length,
    }));
    const al2 = (await req('a', 'GET', '/api/staff/alerts')).body || {};
    ok('095 UI: one entry per student in the bell', bell.groups === (al2.groups || []).length, J(bell));
    ok('095 UI: only the most urgent alert of each is shown until asked', bell.shown === bell.groups && bell.all === al2.counts.total, J(bell));
    ok('095 UI: the first entry is the most urgent', bell.firstAl.includes((al2.groups[0] || {}).urgency || 'x'), J(bell.firstAl));
    ok('095 UI: "+N more" on a student with several', bell.more > 0, J(bell));
    const moreTxt = await ap.$eval('#bellPanel [data-almore]', e => e.textContent).catch(() => '');
    ok('095 UI: …reading "+N more for <name>"', /^\+\d+ more( for .+)?$/.test(moreTxt), moreTxt);
    await ap.screenshot({ path: SHOTS + '/r178-bell-1400.png' }).catch(() => {});
    await ap.click('#bellPanel [data-almore]');
    await ap.waitForTimeout(200);
    const opened = await ap.$eval('#bellPanel [data-almore]', e => ({ ex: e.getAttribute('aria-expanded'), rest: !e.nextElementSibling.hidden, t: e.textContent }));
    ok('095 UI: pressing it expands the rest in place', opened.ex === 'true' && opened.rest && opened.t === 'Show fewer', J(opened));
    ok('095 UI: …and the panel stays open', await ap.$eval('#bellPanel', e => !e.hidden));
    const link = await ap.$eval('#bellPanel .al-rest .al', e => ({ s: e.dataset.student, l: e.dataset.lead })).catch(() => null);
    ok('095 UI: the alerts behind "+N more" still link to the student or lead', link && (link.s || link.l), J(link));
    await ap.screenshot({ path: SHOTS + '/r178-bell-expanded-1400.png' }).catch(() => {});
    await ap.click('#bellPanel [data-almore]');

    /* 375px: the board and the bell. */
    await ap.setViewportSize({ width: 375, height: 812 });
    await ap.waitForTimeout(600);
    let wide = await ap.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
    ok('375: the bell panel fits the screen', await ap.$eval('#bellPanel', e => e.getBoundingClientRect().right <= window.innerWidth + 1 && e.getBoundingClientRect().left >= -1), J(wide));
    await ap.screenshot({ path: SHOTS + '/r178-bell-375.png' }).catch(() => {});
    await ap.click('#bell');
    await ap.waitForTimeout(300);
    await ap.$eval('[data-tkrow="' + B.sid + '"]', e => e.scrollIntoView()).catch(() => {});
    wide = await ap.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
    ok('375: the tasks board does not scroll sideways', wide.sw <= wide.w + 1, J(wide));
    const fits = await ap.$$eval('#tkRows .tks', l => l.every(e => e.getBoundingClientRect().right <= window.innerWidth + 1));
    ok('375: every student row fits the screen', fits);
    await ap.screenshot({ path: SHOTS + '/r178-admin-tasks-375.png', fullPage: true }).catch(() => {});

    /* The counsellor's Tasks tab, as the counsellor. */
    const cctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
    await cctx.request.post(BASE + '/api/auth/login', { data: { email: cE, password: cP + 'X' } });
    const cp = await cctx.newPage();
    cp.on('pageerror', e => errs.push('counsellor: ' + e.message));
    await cp.goto(BASE + '/counsellor?student=' + A.sid, { waitUntil: 'domcontentloaded' });
    await cp.waitForTimeout(3000);
    await cp.click('.tab[data-t="tasks"]').catch(() => {});
    await cp.waitForTimeout(500);
    const tab = await cp.evaluate(() => {
      const p = document.querySelector('#t-tasks');
      return {
        tables: p.querySelectorAll('table').length,
        now: (p.querySelector('.tkc-now') || {}).textContent || '',
        steps: p.querySelectorAll('ol.tl:not(.tl-now) > li[data-step]').length,
        first: p.firstElementChild ? p.firstElementChild.className : '',
        text: p.textContent.replace(/\s+/g, ' '),
      };
    });
    ok('091 UI: no table — a timeline', tab.tables === 0, tab.tables);
    ok('091 UI: the step in hand is at the top', /tkc-now/.test(tab.first) && tab.now.includes(rA.current.title), J({ first: tab.first, now: tab.now.slice(0, 160) }));
    ok('091 UI: then every step (' + rA.steps.length + ')', tab.steps === rA.steps.length, tab.steps);
    ok('091 UI: done steps with the date and who', tab.text.includes('Done ' + human(istDay(0)) + ' · by ' + cName), tab.text.slice(0, 300));
    ok('091 UI: upcoming steps with the reason they are locked', /Unlocks after an application is submitted/.test(tab.text), tab.text.slice(0, 300));
    ok('090 UI: the reason a step cannot be ticked is text, not only a tooltip', /Can’t be ticked yet: .*required documents/.test(tab.text));
    ok('091 UI: "N of M done"', new RegExp('\\d+ of ' + rA.steps.length + ' done').test(tab.now), tab.now.slice(0, 120));
    const badge = await cp.evaluate(() => ({ tab: (document.querySelector('.tab[data-t="tasks"]') || {}).textContent || '',
      head: (document.querySelector('.phase') || {}).textContent || '' }));
    ok('late UI: with only a locked step past its date, neither the Tasks badge nor the header says anything is late',
      !/Tasks\s*\d/.test(badge.tab.replace(/\s+/g, ' ')) && !/past its date/.test(badge.head), J(badge));
    await cp.screenshot({ path: SHOTS + '/r178-counsellor-tasks-1400.png', fullPage: true }).catch(() => {});
    /* stuck still opens its note under the step */
    const stuck = await cp.$('#t-tasks [data-task-stuck]');
    if (stuck) {
      await stuck.click();
      await cp.waitForTimeout(250);
      ok('091 UI: "stuck" opens the note field under the step', !!(await cp.$('#t-tasks .stuckrow input')));
      await cp.click('#t-tasks .stuckrow [data-stuck-cancel]');
      await cp.waitForTimeout(150);
      ok('091 UI: …and Cancel removes it', !(await cp.$('#t-tasks .stuckrow')));
    } else ok('091 UI: there is a stuck control', false);
    /* the C file: ticked automatically */
    await cp.goto(BASE + '/counsellor?student=' + C.sid, { waitUntil: 'domcontentloaded' });
    await cp.waitForTimeout(2600);
    await cp.click('.tab[data-t="tasks"]').catch(() => {});
    await cp.waitForTimeout(400);
    const ctab = await cp.$eval('#t-tasks', e => e.textContent.replace(/\s+/g, ' '));
    ok('089/091 UI: the counsellor sees "Ticked automatically" on C', /Ticked automatically \(the applications are past this stage\)/.test(ctab), ctab.slice(0, 300));
    ok('088/091 UI: and the overdue step labelled Overdue', /Overdue/.test(ctab) && /3 days overdue/.test(ctab), ctab.slice(0, 300));
    /* 375 */
    await cp.goto(BASE + '/counsellor?student=' + A.sid, { waitUntil: 'domcontentloaded' });
    await cp.setViewportSize({ width: 375, height: 812 });
    await cp.waitForTimeout(2600);
    await cp.click('.tab[data-t="tasks"]').catch(() => {});
    await cp.waitForTimeout(500);
    wide = await cp.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth,
      out: [...document.querySelectorAll('#t-tasks li, #t-tasks .tkc-now')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).length }));
    ok('375: the Tasks tab does not scroll sideways and every step fits', wide.sw <= wide.w + 1 && wide.out === 0, J(wide));
    await cp.$eval('#t-tasks', e => e.scrollIntoView()).catch(() => {});
    await cp.screenshot({ path: SHOTS + '/r178-counsellor-tasks-375.png', fullPage: true }).catch(() => {});
    /* the bell on the counsellor's screen */
    await cp.click('#bell');
    await cp.waitForTimeout(1200);
    const cb = await cp.evaluate(() => ({ g: document.querySelectorAll('#bellPanel .alg').length,
      ids: [...document.querySelectorAll('#bellPanel .alg > .al')].map(e => e.dataset.student).filter(Boolean) }));
    ok('095 UI: the counsellor’s bell is grouped too — one entry per student', cb.g > 0 && new Set(cb.ids).size === cb.ids.length, J(cb));
    await cp.screenshot({ path: SHOTS + '/r178-counsellor-bell-375.png' }).catch(() => {});
    ok('no page errors', !errs.length, errs.join(' | '));
  } finally { await b.close(); }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
