/**
 * Patch 147 — filters to test the shortlist where the shortlist is made.
 *
 * Vishal: "only home page is updated with updated filters. we donot have this
 * filters added in admin and counsellor panel so that shortlisted of the unis
 * can be tested. we hide the university shortlist until paid by student so we
 * need these proper filters to work in counsellors and admin panel."
 *
 * The finder on the home page hides public names until a package is bought, so
 * it cannot be used to check what a student WILL get. Staff now have the same
 * matcher, names shown, in two places:
 *   - a counsellor's case → "Find what fits" (the student's own profile, any
 *     field overridable, every miss explained, Add puts it on their shortlist);
 *   - Catalogue → "Test the matcher" (any made-up profile, admin only).
 * Both also show what the package machine would deliver right now.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099'; const S = Date.now();
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };
const PROFILE = { g_country: 'Germany', g_level: "Master's", g_field: 'Computer Science', d_course: 'B.Tech CSE',
  d_dur: '4 years', d_cgpa: '7.8', d_max: '10', d_pass: '4', e_test: 'IELTS', e_score: '6.5', w_has: 'No' };

(async () => {
  const b = await chromium.launch();
  const admin = await b.newContext();
  await admin.request.post(BASE + '/api/auth/login', { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  /* ---- the admin endpoint ---- */
  const anon = await b.newContext();
  const r0 = await anon.request.post(BASE + '/api/staff/fit', { data: { filters: PROFILE } });
  ok(r0.status() === 401 || r0.status() === 403, 'a visitor cannot run the staff matcher — ' + r0.status());

  const r1 = await admin.request.post(BASE + '/api/staff/fit', { data: { filters: PROFILE, publicCount: 3, privateCount: 2 } });
  const j1 = await r1.json();
  ok(r1.ok() && j1.counts && j1.counts.looked > 0, 'admin matcher looks at programmes — ' + JSON.stringify(j1.counts || j1));
  ok(Array.isArray(j1.fits) && Array.isArray(j1.near), 'returns fits and near misses');
  ok((j1.fits || []).every(f => f.university && f.program), 'fits carry real names (staff see everything)');
  ok((j1.near || []).every(n => n.why && n.why.length === 1), 'each near miss names the one thing it misses on');
  ok(Array.isArray(j1.auto) && j1.auto.length === 2, 'shows what a public + private package would deliver now');
  const pubAuto = (j1.auto || []).find(a => a.kind === 'public');
  ok(pubAuto && pubAuto.picks.length <= 3, 'public preview respects the count — ' + (pubAuto && pubAuto.picks.length));

  /* Tighter profile, fewer fits: the filters do something. */
  const strict = await (await admin.request.post(BASE + '/api/staff/fit',
    { data: { filters: Object.assign({}, PROFILE, { d_cgpa: '5.2', e_score: '5.5' }) } })).json();
  ok(strict.counts.fits <= j1.counts.fits, 'a weaker profile fits no more programmes — ' + strict.counts.fits + ' vs ' + j1.counts.fits);
  const pub = await (await admin.request.post(BASE + '/api/staff/fit',
    { data: { filters: Object.assign({ kind: 'public' }, PROFILE) } })).json();
  ok((pub.fits || []).every(f => f.isPublic), 'the public/private filter holds');
  const cap = await (await admin.request.post(BASE + '/api/staff/fit',
    { data: { filters: Object.assign({ ceiling: 500000 }, PROFILE) } })).json();
  ok((cap.fits || []).every(f => !Number(f.totalInr) || Number(f.totalInr) <= 500000), 'the budget filter holds');
  const lev = await (await admin.request.post(BASE + '/api/staff/fit',
    { data: { filters: PROFILE } })).json();
  ok((lev.fits || []).every(f => !f.level || /master/i.test(f.level)), 'only master’s come back for a master’s profile');

  /* ---- the counsellor endpoint ---- */
  const pe = 'fit' + S + '@agency.example', pw = 'fit-' + S;
  await admin.request.post(BASE + '/api/staff/people', { data: { name: 'Fit Agency ' + S, email: pe, password: pw, role: 'partner' } });
  const P = await b.newContext();
  await P.request.post(BASE + '/api/auth/login', { data: { email: pe, password: pw } });
  await P.request.post(BASE + '/api/auth/change', { data: { current: pw, password: pw + 'X' } });
  await P.request.post(BASE + '/api/auth/login', { data: { email: pe, password: pw + 'X' } });
  const add = await (await P.request.post(BASE + '/api/partner/students',
    { data: { students: [{ name: 'Fit Student', email: 'fs' + S + '@ex.example' }] } })).json();
  const sid = add.added[0].id;

  const mk = async (tag) => {
    const em = tag + S + '@glovels.com', p0 = tag + '-' + S;
    const co = await (await admin.request.post(BASE + '/api/staff/people', { data: { name: tag + S, email: em, password: p0, role: 'counsellor' } })).json();
    const C = await b.newContext();
    await C.request.post(BASE + '/api/auth/login', { data: { email: em, password: p0 } });
    await C.request.post(BASE + '/api/auth/change', { data: { current: p0, password: p0 + 'X' } });
    await C.request.post(BASE + '/api/auth/login', { data: { email: em, password: p0 + 'X' } });
    return { C, id: co.person ? co.person.id : co.id };
  };
  const mine = await mk('fitc'), other = await mk('fito');
  await admin.request.put(BASE + '/api/staff/student/' + sid + '/counsellor', { data: { counsellorId: mine.id } });

  const qs = new URLSearchParams(PROFILE).toString();
  const g1 = await mine.C.request.get(BASE + '/api/staff/student/' + sid + '/fit?' + qs);
  const jg = await g1.json();
  ok(g1.ok() && jg.counts && jg.counts.fits > 0, 'the student’s counsellor gets fits — ' + g1.status() + ' ' + JSON.stringify(jg.counts || jg).slice(0, 90));
  ok(jg.bought === false || jg.bought === 0 || jg.bought === undefined || jg.bought === null || (Array.isArray(jg.bought) && !jg.bought.length),
    'nothing bought yet is said so — ' + JSON.stringify(jg.bought));
  ok(Array.isArray(jg.auto) && jg.auto.length > 0, 'and sees what a package would deliver');
  const g2 = await other.C.request.get(BASE + '/api/staff/student/' + sid + '/fit?' + qs);
  ok(g2.status() === 403, 'a counsellor without the case is refused — ' + g2.status());
  const g3 = await P.request.get(BASE + '/api/staff/student/' + sid + '/fit?' + qs);
  ok(g3.status() === 401 || g3.status() === 403, 'the agency cannot run it — ' + g3.status());

  /* ---- the panels ---- */
  const first = (jg.fits || [])[0];
  const cp = await mine.C.newPage();
  const errs = []; cp.on('pageerror', e => errs.push(String(e)));
  await cp.goto(BASE + '/counsellor?student=' + sid, { waitUntil: 'domcontentloaded' }); await cp.waitForTimeout(3000);
  ok(await cp.locator('#fitUni').count() === 1, 'counsellor case has a "Find what fits" button');
  await cp.evaluate(() => { const t = document.querySelector('[data-t="file"]'); if (t) t.click(); });
  await cp.waitForTimeout(500);
  await cp.evaluate(() => document.querySelector('#fitUni').click());
  await cp.waitForTimeout(800);
  ok(await cp.locator('#fitBox select, #fitBox input').count() > 5, 'the panel opens with its filters');
  /* Patch 149 — the testing team could not find these. */
  ok(await cp.locator('#fitBox #gfGre').count() === 1 && await cp.locator('#fitBox #gfGreS').count() === 1,
    'the counsellor panel has a GRE filter (taken/not taken + score)');
  ok((await cp.$$eval('#gfEng option', o => o.map(x => x.textContent))).includes('MOI letter'),
    'and MOI letter as an English answer');
  /* Fill what the empty profile is missing, then run it. */
  await cp.evaluate((p) => {
    const box = document.querySelector('#fitBox');
    for (const [k, v] of Object.entries(p)) { const el = box.querySelector('[name="' + k + '"]'); if (el) { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); } }
    const go = [...box.querySelectorAll('button')].find(x => /find|run|search|show/i.test(x.textContent)); if (go) go.click();
  }, PROFILE);
  await cp.waitForTimeout(2500);
  const txt = await cp.locator('#fitBox').innerText();
  ok(/fit/i.test(txt) && /miss/i.test(txt), 'it lists fits and near misses — ' + txt.slice(0, 120).replace(/\s+/g, ' '));
  const addBtn = cp.locator('#fitBox button:has-text("Add")').first();
  if (await addBtn.count()) {
    await addBtn.click(); await cp.waitForTimeout(1500);
    const sl = await (await mine.C.request.get(BASE + '/api/staff/student/' + sid)).json().catch(() => ({}));
    const list = (sl.shortlist || (sl.student && sl.student.shortlist) || []);
    ok(list.length >= 1, 'Add puts it on the student’s shortlist — ' + list.length);
  } else ok(false, 'an Add button on a fit');
  ok(!errs.length, 'no page errors on the counsellor screen — ' + errs.join(' | '));

  const ap = await admin.newPage();
  const aerrs = []; ap.on('pageerror', e => aerrs.push(String(e)));
  await ap.goto(BASE + '/catalogue', { waitUntil: 'domcontentloaded' }); await ap.waitForTimeout(2000);
  ok(await ap.locator('[data-t="fit"]').count() === 1, 'Catalogue has a "Test the matcher" tab');
  await ap.evaluate(() => document.querySelector('[data-t="fit"]').click());
  await ap.waitForTimeout(3000);
  const at = await ap.locator('#fitAdmin').innerText();
  ok(/programmes/i.test(at) && /fit/i.test(at), 'it runs on a sample profile straight away — ' + at.slice(-300).replace(/\s+/g, ' '));
  ok(!aerrs.length, 'no page errors on the catalogue screen — ' + aerrs.join(' | '));

  await b.close();
  console.log('round147test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('crashed: ' + (e && e.stack || e)); process.exit(1); });
