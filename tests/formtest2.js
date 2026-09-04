/**
 * The profile, after Student View Changes.
 *
 * Five items from that document, and one fault found underneath them.
 *
 *   THE PASSING GRADE IS PREFILLED WITH 5. It shipped with no default at all,
 *   on the argument that the pass mark decides the German grade — the same 6.84
 *   is 2.5 where the pass mark is 4 and 2.8 where it is 5 — so a wrong default
 *   is a wrong grade. Right about the arithmetic, wrong about people: almost
 *   nobody knows their pass mark, the box sat empty, and an empty box produces
 *   no German grade at all rather than a careful one.
 *
 *   BACKLOGS ARE A NUMBER. "1-2", "3-5" and "More than 5" all have to be turned
 *   back into a figure by whoever fills the real application — from a range that
 *   cannot be.
 *
 *   AND UNDERNEATH THAT, the fault that would have made the change destructive:
 *   a select whose stored value is not in its list matched no option, so the
 *   browser showed the blank one and the next save wrote that blank back. Every
 *   student who had answered "1-2" would have had it emptied by the act of
 *   opening the form. Checked here, because it is the kind of thing that is
 *   invisible until somebody's data is gone.
 *
 *   A MASTER'S DEGREE, for the people who have one — and nothing at all for the
 *   people who do not. One question, and the other eight fields appear only on
 *   yes. Deliberately not read by the matcher: German master's admission is
 *   decided on the bachelor.
 *
 *   THE TESTS ASK WHAT THE UNIVERSITY ASKS. TOEFL at home is not accepted
 *   everywhere; a Medium of Instruction letter from the college is refused where
 *   the university's own is taken; and a GRE is three scores and three
 *   percentiles, not one number — a quant-heavy programme reads a different half
 *   of it from a taught master's in the humanities.
 *
 *   AND A FINISHED TEST FOLDS AWAY, to one line: the test and the score. The
 *   trap in that, hit while building it, is folding on the test NAME — choosing
 *   IELTS then hid the box asking for the score, so the form closed itself over
 *   the work still to do. It folds only when it is answered, and never while
 *   somebody is working in it.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
const S = Date.now();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };
const W = 850;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  const email = 'frm' + S + '@example.com';
  await ctx.request.post(BASE + '/api/auth/signup',
    { data: { name: 'Form Two', email, phone: '9876500091',
      password: 'a-real-password-' + S } });

  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  const open = async () => {
    await page.goto(BASE + '/profile.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
  };
  await open();

  const nav = () => page.$$eval('#secNav button',
    b => b.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  const go = async re => {
    const i = (await nav()).findIndex(x => re.test(x));
    await page.click('#secNav [data-i="' + i + '"]');
    await page.waitForTimeout(W);
    return (await page.textContent('#pForm h3') || '').replace(/\s+/g, ' ').trim();
  };
  const has = async k => (await page.$$('#pForm .field[data-k="' + k + '"]')).length === 1;
  const pick = async (k, v) => {
    await page.selectOption('#pForm .field[data-k="' + k + '"] select', v);
    await page.waitForTimeout(W);
  };

  /* ============================================ 1. the bachelor block */
  /* NOT /gre/i for the aptitude section further down — "Bachelor deGREe"
     matches it, which cost half an hour. */
  const head = await go(/bachelor/i);
  ok(/bachelor/i.test(head), 'the bachelor section opens — ' + head);

  const passGrade = await page.inputValue('#pForm .field[data-k="d_pass"] input');
  ok(passGrade === '5', 'the minimum passing grade is prefilled with 5 — ' + passGrade);
  const passHelp = (await page.textContent('#pForm .field[data-k="d_pass"]')) || '';
  ok(/filled in 5|commonest/i.test(passHelp),
    'and says it is an assumption to check, not a fact about them — '
    + passHelp.replace(/\s+/g, ' ').slice(0, 110));

  const backlogs = await page.$$eval('#pForm .field[data-k="d_backlog"] option',
    o => o.map(x => x.value));
  ok(backlogs.includes('4') && backlogs.includes('7'),
    'backlogs are numbers — ' + backlogs.join(','));
  ok(!backlogs.some(x => /-/.test(x)),
    'and not ranges — ' + backlogs.filter(x => /-/.test(x)).join(','));
  ok(backlogs.includes('More than 10'),
    'with a way out at the top end — ' + backlogs.slice(-1));

  /* ===== AN ANSWER ALREADY GIVEN SURVIVES A LIST THAT HAS CHANGED ===== */
  /* Written straight to the server the way a record from before this patch
     holds it, then read back through the form. Without the fix the select
     shows blank and the next save stores blank — the answer is destroyed by
     opening the page. */
  await ctx.request.put(BASE + '/api/profile',
    { data: { profile: { d_backlog: '3-5', fullName: 'Form Two' } } });
  await open();
  await go(/bachelor/i);
  const kept = await page.inputValue('#pForm .field[data-k="d_backlog"] select');
  ok(kept === '3-5', 'an old range answer is still selected, not blanked — ' + kept);
  const shown = await page.$$eval('#pForm .field[data-k="d_backlog"] option',
    o => o.map(x => x.textContent.trim()));
  ok(shown.some(x => /what you answered before/i.test(x)),
    'and is marked as the old answer it is — ' + shown.filter(x => /3-5/.test(x)));
  /* And saving does not eat it. */
  await page.click('#saveBtn');
  await page.waitForTimeout(2400);
  const back = await (await ctx.request.get(BASE + '/api/state')).json();
  ok((back.profile || {}).d_backlog === '3-5',
    'and saving the form keeps it — ' + JSON.stringify((back.profile || {}).d_backlog));

  /* ================================================= 2. the master's */
  await go(/master/i);
  ok(await has('m_has'), 'there is a master\'s section, with one question in it');
  ok(!(await has('m_uni')), 'and nothing else until it is answered');
  await pick('m_has', 'No');
  ok(!(await has('m_uni')),
    'answering No keeps the other eight fields off the screen');
  const navNow = await nav();
  ok(/100%/.test(navNow.find(x => /master/i.test(x)) || ''),
    'and completes the section — ' + navNow.find(x => /master/i.test(x)));
  await pick('m_has', 'Yes');
  for (const k of ['m_uni', 'm_course', 'm_year', 'm_cgpa', 'm_max', 'm_pass', 'm_backlog']) {
    ok(await has(k), 'answering Yes asks for ' + k);
  }

  /* THE MATCHER IS NOT TOUCHED BY IT. German master's admission is decided on
     the bachelor, which is what every bar in the catalogue is written against.
     A master's grade quietly joining that comparison would change who
     qualifies for what. */
  await page.fill('#pForm .field[data-k="m_cgpa"] input', '9.5');
  await page.fill('#pForm .field[data-k="m_max"] input', '10');
  await page.click('#saveBtn');
  await page.waitForTimeout(2400);
  const st = await (await ctx.request.get(BASE + '/api/state')).json();
  ok((st.profile || {}).m_cgpa === '9.5', 'a master\'s grade is stored');
  ok(!(st.profile || {}).d_cgpa || (st.profile || {}).d_cgpa !== '9.5',
    'and is not written over the bachelor grade the matcher reads');

  /* ============================================= 3. the English test */
  await go(/english test/i);
  await pick('e_test', 'TOEFL');
  ok(await has('e_mode'), 'TOEFL asks where it was sat');
  const modes = await page.$$eval('#pForm .field[data-k="e_mode"] option',
    o => o.map(x => x.value).filter(Boolean));
  ok(modes.some(x => /home/i.test(x)) && modes.some(x => /centre/i.test(x)),
    'home or centre — ' + modes.join(' | '));
  ok(await has('e_score'), 'and still asks for the score');

  await pick('e_test', 'IELTS');
  ok(!(await has('e_mode')),
    'IELTS does not ask it, because IELTS does not have that distinction');

  await pick('e_test', 'Medium of Instruction letter');
  ok(await has('e_moi_from'), 'a Medium of Instruction letter asks who issued it');
  const froms = await page.$$eval('#pForm .field[data-k="e_moi_from"] option',
    o => o.map(x => x.textContent.trim()).filter(Boolean));
  ok(froms.some(x => /college/i.test(x)) && froms.some(x => /university/i.test(x)),
    'the college or the university, which is the distinction that decides '
    + 'whether it is accepted — ' + froms.join(' | '));

  await pick('e_test', 'Not taken yet');
  ok(!(await has('e_score')) && !(await has('e_date')),
    'somebody who has not sat one is asked for no score and no date');
  ok(!(await has('e_low')), 'and no bands');

  /* ========================================== 4. the aptitude tests */
  await go(/gmat/i);
  const apt = await page.$$eval('#pForm .field[data-k="a_test"] option',
    o => o.map(x => x.value).filter(Boolean));
  ok(apt.includes('Not taken yet'),
    '"not taken yet" is an answer — it was not, so somebody who had simply not '
    + 'sat one had to claim it was not required — ' + apt.join(' | '));

  await pick('a_test', 'GRE');
  for (const [k, what] of [['a_q', 'quantitative score'], ['a_q_pc', 'quantitative percentile'],
    ['a_v', 'verbal score'], ['a_v_pc', 'verbal percentile'],
    ['a_aw', 'analytical writing score'], ['a_aw_pc', 'analytical writing percentile']]) {
    ok(await has(k), 'the GRE asks for the ' + what);
  }
  ok(await has('a_mode'), 'and where it was sat');

  await pick('a_test', 'GATE');
  ok(!(await has('a_q')), 'GATE is not asked for a GRE breakdown it does not have');
  ok(await has('a_score'), 'but is still asked for its score');

  await pick('a_test', 'Not taken yet');
  ok(!(await has('a_score')) && !(await has('a_date')),
    'and nothing is asked of somebody who has not sat one');

  /* ================================== 5. a finished test folds away */
  await pick('a_test', 'GRE');
  await page.fill('#pForm .field[data-k="a_score"] input', '322');
  await page.waitForTimeout(W);
  /* THE TRAP. Folding on the test name alone hid the box asking for the score
     the moment a test was chosen — the form closing itself over the work still
     to do. Nothing folds while somebody is working in it. */
  ok(await has('a_score'),
    'typing a score does not fold the group away under the person typing it');

  await page.click('#saveBtn');
  await page.waitForTimeout(2400);
  await open();
  await go(/gmat/i);
  const sum = (await page.textContent('.fgrp .grpsum').catch(() => '')) || '';
  ok(/GRE/.test(sum) && /322/.test(sum),
    'coming back to it, it is one line: the test and the score — ' + sum.trim());
  ok(!(await has('a_q')), 'and the six boxes behind it are put away');

  await page.click('.grptog');
  await page.waitForTimeout(W);
  ok(await has('a_score'), 'and it opens again on a press');
  ok(await has('a_q'), 'with everything back');

  /* A group that is NOT answered never folds, or the fold is hiding work. */
  await go(/english test/i);
  await pick('e_test', 'PTE');
  ok(await has('e_score'),
    'a test with no score yet stays open — that is the whole point of "after '
    + 'filling it"');

  ok(errs.length === 0, 'no page errors anywhere — ' + errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
