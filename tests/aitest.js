/**
 * The SOP and LOR studio, driven from the public home page.
 *
 * The thing this has to prove is not that a draft appears. It is that the draft
 * is made of what the student entered, that pressing "write it again" gives
 * different words, that a signed-in student's draft is kept, and that their
 * counsellor can see it — because the paid service is a human rewrite of
 * exactly this draft, and a counsellor who has to ask for it by email is a
 * counsellor who will not use it.
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

const openStudio = async (page, which) => {
  /* Close whatever is open first. Clicking the trigger with the modal still up
     means clicking the modal's own backdrop, which swallows the press and then
     the wait times out on a selector that was never going to appear. */
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(250);
  /* openAI is a top-level function in the page's own script, not a property of
     window from outside it — so the studio is opened the way a visitor opens
     it, by pressing the button on the service card. */
  const btn = page.locator('[data-ai="' + which + '"]').first();
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await page.waitForSelector('#aiGo', { timeout: 10000 });
  await page.waitForTimeout(300);
};

(async () => {
  const browser = await chromium.launch();

  /* ------------------------------------------------- a visitor, signed out */
  const guest = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await guest.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => m.type() === 'error'
    && !/ERR_TUNNEL|fonts\.googleapis|favicon/.test(m.text()) && errs.push(m.text()));

  await page.goto(BASE + '/#services', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  await openStudio(page, 'sop');
  check('the studio opens', await page.isVisible('#aiGo'));

  const chips = await page.$$('[data-chip]');
  check('the chips are there', chips.length >= 8, chips.length);

  /* Nothing ticked: it must refuse rather than write scaffolding with no
     evidence in it. */
  await page.click('#aiGo');
  await page.waitForTimeout(700);
  check('it refuses to write with nothing picked',
    /Pick at least one/.test(await page.textContent('#aiOut')),
    (await page.textContent('#aiOut')).slice(0, 80));

  await page.fill('#aiProg', 'M.Sc. Robotics');
  await page.fill('#aiUni', 'TU Delft');
  await page.click('[data-chip="work"]');
  await page.click('[data-chip="project"]');
  await page.click('[data-chip="deep"]');
  await page.click('#aiGo');
  await page.waitForSelector('#aiAgain', { timeout: 15000 });

  const first = await page.textContent('.ai-draft');
  check('it writes a draft', first.length > 400, first.length + ' characters');
  check('the draft names the programme the student typed', first.includes('M.Sc. Robotics'));
  check('and the university', first.includes('TU Delft'));
  check('it uses the thing they ticked',
    /real team|final-year project/.test(first), first.slice(0, 120));
  check('it does not invent a grade or a title',
    !/(GPA|CGPA|first class|gold medal|published|award)/i.test(first));
  check('the caveat is on the screen',
    /draft, not a submission/i.test(await page.textContent('#aiOut')));

  /* ------------------------------------------- write it again means AGAIN */
  await page.click('#aiAgain');
  await page.waitForTimeout(1200);
  const second = await page.textContent('.ai-draft');
  check('"write it again" produces different words', second !== first,
    second === first ? 'byte-identical' : 'different');
  check('and it still names the programme', second.includes('M.Sc. Robotics'));
  check('the draft is numbered so you can tell them apart',
    /Draft 2/.test(await page.textContent('.steps-lbl')), await page.textContent('.steps-lbl'));

  await page.click('#aiAgain');
  await page.waitForTimeout(1200);
  const third = await page.textContent('.ai-draft');
  check('a third press is different again', third !== second && third !== first);

  check('a signed-out visitor is told their draft is not kept',
    /Sign in before you write/.test(await page.textContent('#aiOut')));

  /* ------------------------------------------------------------- the LOR */
  await openStudio(page, 'lor');
  await page.fill('#aiProg', 'MSc Computer Science');
  await page.fill('#aiUni', 'TU Munich');
  await page.selectOption('#aiWho', { index: 1 });
  await page.selectOption('#aiSpan', { index: 2 });
  await page.fill('#aiInst', 'rebuilt the lab data pipeline in a week');
  await page.click('[data-chip="analysis"]');
  await page.click('#aiGo');
  await page.waitForSelector('#aiAgain', { timeout: 15000 });
  const lor = await page.textContent('.ai-draft');
  check('the letter is written', lor.length > 300);
  check('it says who is writing it and for how long',
    /supervisor|professor|mentor|manager|head of department/.test(lor)
    && /semester|year/.test(lor), lor.slice(0, 150));
  check('the specific example the referee gave is in it',
    lor.includes('rebuilt the lab data pipeline in a week'));
  await guest.close();

  /* ------------------------------------------- a student who is signed in */
  const stu = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await stu.request.post(BASE + '/api/auth/login',
    { data: { email: 'student@glovels.com', password: 'glovels123' } });
  const sp = await stu.newPage();
  await sp.goto(BASE + '/#services', { waitUntil: 'domcontentloaded' });
  await sp.waitForTimeout(1400);
  await openStudio(sp, 'sop');
  await sp.fill('#aiProg', 'M.Sc. Data Science');
  await sp.fill('#aiUni', 'RWTH Aachen University');
  await sp.click('[data-chip="research"]');
  await sp.click('#aiGo');
  await sp.waitForSelector('#aiAgain', { timeout: 15000 });
  check('a signed-in student is told it was saved',
    /Saved to your account/.test(await sp.textContent('#aiOut')),
    (await sp.textContent('#aiOut')).slice(-120));

  const state = await (await stu.request.get(BASE + '/api/state')).json();
  check('the draft is on their account', (state.drafts || []).length >= 1,
    (state.drafts || []).length);
  check('it carries the programme it was written for',
    (state.drafts[0] || {}).programme === 'M.Sc. Data Science',
    (state.drafts[0] || {}).programme);

  /* ------------------------------------- and the counsellor can read it */
  const staff = await browser.newContext();
  await staff.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });
  const students = await (await staff.request.get(BASE + '/api/staff/students')).json();
  const me = (students.students || []).find(x => x.email === 'student@glovels.com');
  check('the student is visible to staff', !!me, me && me.id);
  const rec = await (await staff.request.get(BASE + '/api/staff/student/' + me.id)).json();
  check('the counsellor sees the draft the student wrote',
    (rec.drafts || []).length >= 1, (rec.drafts || []).length);
  check('with the words in it, not just a filename',
    (((rec.drafts || [])[0] || {}).paragraphs || []).join(' ').includes('RWTH Aachen University'),
    JSON.stringify((rec.drafts || [])[0] || {}).slice(0, 140));

  /* --------------------------------- the wording is editable from the office */
  const bankBefore = await (await staff.request.get(BASE + '/api/staff/content')).json();
  check('the writing bank reaches the operations site',
    !!(bankBefore.writing && bankBefore.writing.sop.openings.length),
    bankBefore.writing && bankBefore.writing.sop.openings.length);

  const edited = JSON.parse(JSON.stringify(bankBefore.writing));
  edited.sop.openings = ['A test opening for the {programme} at {university}, written in Hyderabad.'];
  const put = await staff.request.put(BASE + '/api/staff/content/writing', { data: { value: edited } });
  check('it saves', put.ok(), put.status());

  const after = await (await stu.request.post(BASE + '/api/ai/draft', {
    data: { kind: 'sop', programme: 'M.Sc. Data Science', university: 'RWTH Aachen University',
      signals: ['research'], pass: 0 },
  })).json();
  check('the edited wording is what the next draft opens with',
    (after.draft.paragraphs[0] || '').includes('written in Hyderabad'),
    (after.draft.paragraphs[0] || '').slice(0, 90));

  /* An empty bank would leave the studio with nothing to say. */
  const empty = JSON.parse(JSON.stringify(edited));
  empty.sop.openings = [];
  empty.sop.closings = [];
  const refused = await staff.request.put(BASE + '/api/staff/content/writing', { data: { value: empty } });
  check('emptying the bank is refused with a reason', refused.status() === 422,
    refused.status());

  check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
