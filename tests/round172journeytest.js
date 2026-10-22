/*
 * Round 172 — how a student's journey is worked out (16 Oct report:
 * N17-01, N17-03, N17-04, N17-05, N17-08, N17-09).
 *
 *   N17-01  the phase comes from what is ON THE FILE as well as the tasks;
 *           everybody gets the core steps; "documents collected" cannot be
 *           ticked at 0 of 10; never Departed without a granted visa and a
 *           travel date
 *   N17-03  an outcome only at "Decision"; a no-longer-offered programme
 *           needs an explicit confirm
 *   N17-04  one message per outcome change, none for a stage correction
 *   N17-05  the visa decision step, refusal re-opens the visa phase, visa
 *           documents must be verified, travel date, one message per decision
 *   N17-08  alerts stop for an enrolled / finished file
 *   N17-09  the dashboard shows the counsellor's stage and the enrolment
 *
 * Port 8112 by default:  cd tests && bash srv.sh 8112 && node round172journeytest.js
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8112';

let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + String(e ?? '').slice(0, 400))); };
const J = x => JSON.stringify(x);
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const jar = {};
async function req(who, method, path, body) {
  const h = { 'content-type': 'application/json', 'x-forwarded-for': '10.172.' + (who.length) + '.' + (7 + who.charCodeAt(0) % 200) };
  if (jar[who]) h.cookie = jar[who];
  const r = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, ok: r.ok, body: j };
}
const login = (who, e, p) => req(who, 'POST', '/api/auth/login', { email: e, password: p });
const pdf = n => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(n || 300, 0x41)]);
async function upload(who, sid, key, name) {
  const fd = new FormData();
  fd.append('file', new Blob([pdf(400)], { type: 'application/pdf' }), name || (key + '.pdf'));
  const r = await fetch(BASE + '/api/staff/student/' + sid + '/document/' + key + '/file',
    { method: 'POST', headers: { cookie: jar[who] }, body: fd });
  return r.status;
}
const REQUIRED = ['passport', 'x', 'xii', 'degree', 'consol', 'english', 'cv', 'sop', 'lor', 'finance'];
const VISA_REQ = ['visa-offer', 'visa-funds', 'visa-insurance', 'visa-form', 'visa-cover', 'visa-appointment'];

(async () => {
  const stamp = Date.now().toString(36);
  await login('a', 'admin@glovels.com', 'glovels123');
  let r = await req('a', 'POST', '/api/staff/people',
    { name: 'Journey Counsellor', email: 'jc' + stamp + '@glovels.com', password: 'jc-' + stamp, role: 'counsellor' });
  const cId = r.body && r.body.person && r.body.person.id;
  ok('setup: a counsellor', !!cId, J(r.body));

  const caseOf = async id => (await req('a', 'GET', '/api/staff/student/' + id)).body || {};
  const phase = async id => (await caseOf(id)).phase || {};
  const tasksOf = async id => (await caseOf(id)).tasks || [];
  const tick = async (id, re) => {
    const out = [];
    for (const t of (await tasksOf(id)).filter(x => re.test(x.title) && x.status !== 'done')) {
      out.push(await req('a', 'PUT', '/api/staff/task/' + t.id, { status: 'done' }));
    }
    return out;
  };
  const tickAll = async id => {
    for (const t of (await tasksOf(id)).filter(x => x.status !== 'done' && !x.derived)) {
      await req('a', 'PUT', '/api/staff/task/' + t.id, { status: 'done' });
    }
  };
  const msgs = async (id, re) => ((await caseOf(id)).msgs || []).filter(m => re.test(String(m.t || '')));

  /* ================= N17-01: a lead-converted student, no package */
  r = await req('a', 'POST', '/api/staff/leads', { name: 'Lead Journey ' + stamp, phone: '98' + String(Date.now()).slice(-8),
    email: 'lj' + stamp + '@ex.example', source: 'phone' });
  const leadId = r.body && r.body.lead && r.body.lead.id;
  r = await req('a', 'POST', '/api/staff/lead/' + leadId + '/convert', {});
  const lead = r.body && r.body.student && r.body.student.id;
  ok('N17-01 setup: the lead converts into a student', !!lead, r.status + ' ' + J(r.body).slice(0, 200));
  await req('a', 'PUT', '/api/staff/student/' + lead + '/counsellor', { counsellorId: cId });

  let ts = await tasksOf(lead);
  const keys = new Set(ts.map(t => t.key || ''));
  const titles = ts.map(t => t.title).join(' | ');
  ok('N17-01 a student with no package gets the core journey steps',
    ['Welcome call', 'Profile completed', 'Shortlist confirmed', 'Application documents', 'Offer letter',
      'Visa documents ready', 'Visa application filed', 'Visa decision', 'Pre-departure']
      .every(w => titles.includes(w)), titles);
  const prof = ts.find(t => /Profile completed/.test(t.title));
  ok('N17-01 the documents step carries the reason it cannot be ticked yet',
    prof && prof.lock && /0 of 10/.test(prof.lock), J(prof));

  r = (await tick(lead, /Welcome call/))[0];
  ok('N17-01 the welcome call ticks', r && r.ok, r && r.status);
  r = (await tick(lead, /Profile completed/))[0];
  ok('N17-01 "documents collected" is refused at 0 of 10 documents, with a clear message',
    r && r.status === 409 && /0 of 10/.test(r.body.error || ''), r && (r.status + ' ' + J(r.body)));
  let p = await phase(lead);
  ok('N17-01 after both onboarding ticks the student is NOT departed',
    p.key !== 'departed' && !p.finished, J(p));
  ok('N17-01 they are on Profile and documents', p.key === 'profile', p.key);

  /* Tick everything that can be ticked: still not Departed, and nothing on the file says otherwise. */
  await tickAll(lead);
  p = await phase(lead);
  ok('N17-01 ticking every tickable step still does not reach Departed with nothing on the file',
    p.key !== 'departed' && !p.finished, J(p));
  ok('N17-01 the phase says what it is waiting on', !!(p.waitingOn || '').length, J(p));

  /* ================= the QA-style packaged student */
  const sE = 'jq' + stamp + '@ex.example', sP = 'jq-' + stamp;
  r = await req('a', 'POST', '/api/staff/people', { name: 'Journey QA ' + stamp, email: sE, password: sP, role: 'student' });
  const sid = r.body.person.id;
  await req('a', 'PUT', '/api/staff/student/' + sid + '/counsellor', { counsellorId: cId });
  await login('s', sE, sP);
  await req('s', 'POST', '/api/auth/change', { password: sP + 'X' });
  await login('s', sE, sP + 'X');
  r = await req('s', 'POST', '/api/orders', { packageId: 'pkg-boarding', name: 'Journey QA', email: sE, phone: '9876543210', acceptedTerms: true });
  ok('setup: the student buys the boarding package', r.ok, r.status + ' ' + J(r.body).slice(0, 160));

  const seen = [];
  const note = async () => { const k = (await phase(sid)).key; if (seen[seen.length - 1] !== k) seen.push(k); return k; };
  await note();
  await tick(sid, /Welcome call/);
  await note();
  for (const k of REQUIRED) await upload('a', sid, k);
  r = (await tick(sid, /Profile completed/))[0];
  ok('N17-01 documents uploaded but not verified: still refused', r && r.status === 409, r && r.status);
  for (const k of REQUIRED) await req('a', 'POST', '/api/staff/student/' + sid + '/document/' + k, { status: 'ok' });
  r = (await tick(sid, /Profile completed/))[0];
  ok('N17-01 with all 10 verified the documents step ticks', r && r.ok, r && (r.status + ' ' + J(r.body)));
  await note();

  const cat = (await req('a', 'GET', '/api/staff/catalogue?per=60')).body.programmes || [];
  /* Four programmes at four different universities, so each row reads apart. */
  const progs = [];
  cat.forEach(x => { if (x && x.id && x.university && progs.length < 4 && !progs.some(y => y.university === x.university)) progs.push(x); });
  for (const u of progs.slice(0, 3)) await req('a', 'POST', '/api/staff/student/' + sid + '/shortlist', { id: u.id });
  await tick(sid, /Shortlist confirmed/);
  await note();
  await tick(sid, /Statement of Purpose|Letters of Rec/);
  await note();
  await tick(sid, /Application documents/);
  ok('N17-01 all applying tasks short of a submission: still Applying', (await note()) === 'applying', seen.join('>'));

  const [P1, P2, P3] = progs;
  const app = (id, body) => req('a', 'PUT', '/api/staff/student/' + sid + '/application/' + encodeURIComponent(id), body);

  /* ---- N17-03: offer only at Decision */
  const before03 = (await msgs(sid, /Update on your applications/)).length;
  r = await app(P1.id, { stage: 0, outcome: 'offer' });
  ok('N17-03 an offer at "Documents collected" is refused (409) with a message',
    r.status === 409 && /Decision/.test((r.body || {}).error || ''), r.status + ' ' + J(r.body));
  ok('N17-03 and the student is told nothing', (await msgs(sid, /Update on your applications/)).length === before03);

  r = await app(P1.id, { stage: 2, outcome: '' });
  await note();
  r = await app(P1.id, { stage: 4, outcome: '' });
  const after4 = (await msgs(sid, /Update on your applications/)).length;
  r = await app(P1.id, { stage: 4, outcome: '' });
  ok('N17-04 moving to Decision with no outcome sends nothing', (await msgs(sid, /Decision/)).length === 0, J(await msgs(sid, /Decision/)));
  r = await app(P1.id, { stage: 4, outcome: 'offer' });
  ok('N17-03 an offer at Decision saves', r.ok, r.status + ' ' + J(r.body));
  let offerMsgs = await msgs(sid, /an offer from/);
  ok('N17-04 the offer message goes once', offerMsgs.length === 1, offerMsgs.length);
  await app(P1.id, { stage: 1, outcome: 'offer' });
  await app(P1.id, { stage: 4, outcome: 'offer' });
  await app(P1.id, { stage: 4, outcome: 'offer' });
  offerMsgs = await msgs(sid, /an offer from/);
  ok('N17-04 stage corrections (Decision → drafted → Decision) do not send it again', offerMsgs.length === 1, offerMsgs.length);
  ok('N17-04 nothing at all was sent by the corrections',
    (await msgs(sid, /Update on your applications/)).length === after4 + 1, (await msgs(sid, /Update on your applications/)).length + ' vs ' + (after4 + 1));
  await note();

  /* ---- N17-03: a programme no longer offered */
  await app(P3.id, { stage: 4, outcome: '' });
  const del = await req('a', 'DELETE', '/api/staff/programme/' + encodeURIComponent(P3.id));
  ok('setup: P3 withdrawn from the catalogue', del.ok, del.status);
  r = await app(P3.id, { stage: 4, outcome: 'rejected' });
  ok('N17-03 an outcome on a no-longer-offered programme needs an explicit confirm',
    r.status === 409 && r.body && r.body.needsConfirm, r.status + ' ' + J(r.body));
  r = await app(P3.id, { stage: 4, outcome: 'rejected', confirmWithdrawn: true });
  ok('N17-03 with the confirm it saves', r.ok, r.status + ' ' + J(r.body));

  await app(P2.id, { stage: 2, outcome: '' });
  await tick(sid, /Application submitted/);
  await note();
  await tick(sid, /Offer letter/);
  const atVisa = await note();
  ok('N17-01 the packaged student went through Applying and Offers before Visa',
    seen.indexOf('applying') >= 0 && seen.indexOf('offers') >= 0 && atVisa === 'visa'
      && seen.indexOf('applying') < seen.indexOf('offers') && seen.indexOf('offers') < seen.indexOf('visa'),
    seen.join(' > '));

  /* ---- N17-08 control: a deadline alert exists before enrolment */
  const P4 = progs[3];
  const live4 = cat.find(x => String(x.id) === String(P4.id));
  const put4 = await req('a', 'PUT', '/api/staff/programme', Object.assign({}, live4, { id: live4.id,
    intakes: [{ season: 'Winter', deadline: day(16) }] }));
  await req('a', 'POST', '/api/staff/student/' + sid + '/shortlist', { id: P4.id });
  const mine = async () => ((await req('a', 'GET', '/api/staff/alerts')).body.alerts || [])
    .filter(x => x.subject && Number(x.subject.studentId) === Number(sid));
  let al = await mine();
  ok('N17-08 control: before enrolment the deadline alert is raised',
    put4.ok && al.some(x => x.kind === 'deadline'), put4.status + ' ' + J(al.map(x => x.kind)));
  /* P4's own submission step is owed now; the office ticks it (the
     application itself stays unsubmitted, so the deadline alert stands). */
  await tick(sid, /Application submitted/);

  /* ---- N17-05: visa */
  r = (await tick(sid, /Visa documents ready/))[0];
  ok('N17-05 "Visa documents ready" is refused while the visa documents are not verified',
    r && r.status === 409 && /0 of 6/.test(r.body.error || ''), r && (r.status + ' ' + J(r.body)));
  for (const k of VISA_REQ) await upload('a', sid, k);
  for (const k of VISA_REQ) await req('a', 'POST', '/api/staff/student/' + sid + '/document/' + k, { status: 'ok' });
  r = (await tick(sid, /Visa documents ready/))[0];
  ok('N17-05 with all 6 verified it ticks', r && r.ok, r && (r.status + ' ' + J(r.body)));
  await tick(sid, /Visa application filed/);
  let st = (await req('s', 'GET', '/api/state')).body || {};
  const visaStage = ((st.journey || {}).stages || []).find(x => x.key === 'visa') || {};
  ok('N17-09 after the application is filed the student is NOT told "Visa done"',
    !/Visa done|granted/i.test(visaStage.detail || ''), visaStage.detail);
  r = (await tick(sid, /Visa decision/))[0];
  ok('N17-05 the visa decision step cannot be ticked by hand', r && r.status === 409, r && r.status);
  p = await phase(sid);
  ok('N17-05 with the visa filed and no decision the file is in Visa, not Services or Departed', p.key === 'visa', J(p));

  r = await req('a', 'PUT', '/api/staff/student/' + sid + '/visa', { decision: 'granted' });
  ok('N17-05 granted without the decision letter is refused', r.status === 409 && /decision letter/i.test((r.body || {}).error || ''), r.status + ' ' + J(r.body));
  await upload('a', sid, 'visa-decision', 'visa-letter.pdf');
  const vBefore = (await msgs(sid, /Update on your visa/)).length;
  r = await req('a', 'PUT', '/api/staff/student/' + sid + '/visa', { decision: 'refused' });
  ok('N17-05 a refusal records', r.ok, r.status + ' ' + J(r.body));
  ts = await tasksOf(sid);
  ok('N17-05 a refusal re-opens the visa documents and application steps',
    ['Visa documents ready', 'Visa application filed'].every(w => (ts.find(t => t.title.startsWith(w)) || {}).status === 'open'),
    J(ts.filter(t => /Visa/.test(t.title)).map(t => [t.title, t.status])));
  ok('N17-05 the student is told once', (await msgs(sid, /Update on your visa/)).length === vBefore + 1, (await msgs(sid, /Update on your visa/)).length - vBefore);
  await tick(sid, /Visa documents ready|Visa application filed/);
  r = await req('a', 'PUT', '/api/staff/student/' + sid + '/visa', { decision: 'granted' });
  ok('N17-05 granted records once the letter is on file', r.ok, r.status + ' ' + J(r.body));
  await req('a', 'PUT', '/api/staff/student/' + sid + '/visa', { decision: 'granted' });
  ok('N17-05 one message per decision (refused, granted — not the repeat)', (await msgs(sid, /Update on your visa/)).length === vBefore + 2, (await msgs(sid, /Update on your visa/)).length - vBefore);

  /* Enrolled at P1. */
  r = await app(P1.id, { stage: 4, outcome: 'enrolled' });
  ok('setup: enrolment recorded', r.ok, r.status);
  r = (await tick(sid, /Pre-departure/))[0];
  ok('N17-05 pre-departure is refused without a travel date', r && r.status === 409 && /travel date/i.test(r.body.error || ''), r && (r.status + ' ' + J(r.body)));
  await tickAll(sid);
  p = await phase(sid);
  ok('N17-05 granted but no travel date: never Departed', p.key !== 'departed' && !p.finished, J(p));
  r = await req('a', 'PUT', '/api/staff/student/' + sid + '/visa', { travelDate: day(30) });
  ok('N17-05 the travel date saves', r.ok, r.status + ' ' + J(r.body));
  await tickAll(sid);
  p = await phase(sid);
  ok('N17-05 granted + travel date + everything done: Departed', p.key === 'departed' && p.finished, J(p));

  /* ---- N17-08: alerts silent for the enrolled, finished file */
  al = await mine();
  ok('N17-08 no deadline / no-longer-offered / file-short / places alerts for an enrolled student',
    !al.some(x => ['deadline', 'withdrawn', 'profile', 'places'].includes(x.kind)), J(al.map(x => x.kind + ':' + x.title)));

  /* ---- N17-09: one journey */
  st = (await req('s', 'GET', '/api/state')).body || {};
  const Jy = st.journey || {};
  const cs = await caseOf(sid);
  ok('N17-09 the student journey carries the counsellor’s phase', Jy.phase && Jy.phase.key === cs.phase.key, J({ s: Jy.phase, c: cs.phase && cs.phase.key }));
  ok('N17-09 finished on both screens', Jy.finished === true && cs.phase.finished === true, J({ s: Jy.finished, c: cs.phase.finished }));
  ok('N17-09 the enrolment is in the journey', Jy.enrolment && /You are enrolled at/.test(Jy.enrolment.text || '')
    && Jy.enrolment.university, J(Jy.enrolment));
  const vs = (Jy.stages || []).find(x => x.key === 'visa') || {};
  ok('N17-09 "Visa granted" only now', /granted/i.test(vs.detail || ''), vs.detail);

  {
    const b = await chromium.launch();
    const errs = [];
    const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
    const lr = await ctx.request.post(BASE + '/api/auth/login', { data: { email: sE, password: sP + 'X' } });
    ok('setup: the student signs in in a browser', lr.ok(), lr.status());
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push(e.message));
    await pg.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(2800);
    const body = await pg.evaluate(() => document.body.innerText);
    ok('N17-09 dashboard: "You are enrolled at <University>" is shown',
      new RegExp('You are enrolled at ' + String(P1.university).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(body), body.slice(0, 300));
    const head = await pg.$eval('#progPhase', e => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
    ok('N17-09 dashboard: the progress head says finished, not "Applying"', /All done/.test(head) && !/Applying/.test(head), head);
    const acts = await pg.$$eval('#slWrap td.sl-act', l => l.map(x => x.textContent.replace(/\s+/g, ' ').trim())).catch(() => []);
    ok('N17-09 dashboard: shortlist rows with an outcome show it, not "Continue application"',
      acts.some(x => /Enrolled/.test(x)) && acts.some(x => /Not successful|No longer offered/.test(x)), J(acts));
    ok('N17-09 dashboard: the enrolled row does not say "Continue application"',
      !acts.filter(x => /Enrolled/.test(x)).some(x => /Continue application/.test(x)), J(acts));
    const next = await pg.$eval('#nextUp', e => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
    ok('N17-09 dashboard: "Next" is not the shortlist any more', !/Your shortlist is ready/.test(next), next);

    /* The counsellor's screen: locked steps and the outcome box. */
    const cctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
    await cctx.request.post(BASE + '/api/auth/login', { data: { email: 'admin@glovels.com', password: 'glovels123' } });
    const cp = await cctx.newPage();
    cp.on('pageerror', e => errs.push('counsellor: ' + e.message));
    await cp.goto(BASE + '/counsellor?student=' + lead, { waitUntil: 'domcontentloaded' });
    await cp.waitForTimeout(3000);
    await cp.click('.tab[data-t="tasks"]').catch(() => {});
    await cp.waitForTimeout(500);
    const lockUi = await cp.evaluate(() => {
      const row = [...document.querySelectorAll('#t-tasks tr')].find(r => /Profile completed/.test(r.textContent));
      if (!row) return null;
      const btn = row.querySelector('[data-task-done]');
      return { disabled: !!(btn && btn.disabled), text: row.textContent };
    });
    ok('N17-01 UI: the documents step’s "done" is disabled with the reason', lockUi && lockUi.disabled && /0 of 10/.test(lockUi.text), J(lockUi));
    const visaUi = await cp.$('#visaDecision');
    ok('N17-05 UI: the Tasks tab has the visa decision and travel date controls', !!visaUi);

    await cp.goto(BASE + '/counsellor?student=' + sid, { waitUntil: 'domcontentloaded' });
    await cp.waitForTimeout(3000);
    const boxes = await cp.$$eval('[data-outcome]', l => l.map(s => {
      const li = s.closest('li'); const st = li && li.querySelector('[data-stage]');
      return { stage: st ? st.value : null, disabled: s.disabled };
    }));
    ok('N17-03 UI: the outcome box is enabled only at Decision',
      boxes.length > 0 && boxes.every(x => (String(x.stage) === '4') === !x.disabled), J(boxes));
    ok('no page errors', !errs.length, errs.join(' | '));
    await b.close();
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
