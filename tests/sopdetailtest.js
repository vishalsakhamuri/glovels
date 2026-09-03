/**
 * The studio asks what the experience actually was.
 *
 * Before this, the SOP tab had two text fields — Programme and University —
 * and after that only chips, each carrying one fixed phrase. Everyone who
 * ticked "Work experience" got the words "my time working in a real team". The
 * draft was structurally correct and evidentially empty, which is the one
 * thing a statement of purpose cannot be.
 *
 * Two properties are worth more than the prose and are what this checks:
 *
 *   The detail goes in VERBATIM. The page promises the draft will never invent
 *   a grade, a title or a publication, and the only way to keep that promise
 *   is to add nothing to what was typed.
 *
 *   A detail belongs to its chip. Type into a box, untick the chip, and the
 *   words must not appear in the draft — the chip is the claim, the box is
 *   only its detail. Enforced on the server, not only in the page.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

const WORK = 'two years at TCS on payment reconciliation tools';
const PROJ = 'a Telugu OCR pipeline for handwritten land records';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1050 } });

  /* ------------------------------------------------ the bank reaches the page */
  const chips = await (await ctx.request.get(BASE + '/api/ai/chips')).json();
  const work = (chips.sop.signals || []).find(c => c.key === 'work');
  check('every SOP chip arrives with its own question',
    (chips.sop.signals || []).every(c => c.ask && c.ask.length > 6),
    (chips.sop.signals || []).filter(c => !c.ask).map(c => c.key).join(',') || 'all have one');
  check('and the question is specific to the chip',
    work && /work/i.test(work.ask), work ? work.ask : 'no work chip');
  check('and carries an example for the box',
    !!(work && work.eg), work ? work.eg : '');
  /* The phrase is what the draft is ALLOWED to say. It stays on the server, so
     a page cannot dictate a claim by editing its own copy. */
  check('but the phrase does not leave the server',
    (chips.sop.signals || []).every(c => !('phrase' in c)));
  check('a motive is not asked to elaborate on itself',
    (chips.sop.motives || []).every(c => !c.ask));

  /* ------------------------------------------------------------ the draft ---- */
  const draft = async body => {
    const r = await ctx.request.post(BASE + '/api/ai/draft', {
      data: Object.assign({ kind: 'sop', programme: 'M.Sc. Data Science',
        university: 'RWTH Aachen University', pass: 0 }, body),
    });
    return (await r.json()).draft;
  };

  const plain = await draft({ signals: ['work', 'project'], motives: ['research'] });
  const rich = await draft({
    signals: ['work', 'project'], motives: ['research'],
    details: { work: WORK, project: PROJ },
  });

  check('a draft with no details still writes', plain && plain.paragraphs.length >= 4,
    plain ? plain.paragraphs.length + ' paragraphs' : 'nothing came back');
  check('and gains a paragraph when the boxes are filled in',
    rich.paragraphs.length === plain.paragraphs.length + 1,
    plain.paragraphs.length + ' -> ' + rich.paragraphs.length);

  const text = rich.paragraphs.join('\n');
  check('what the student typed is in the draft, word for word',
    text.includes(WORK) && text.includes(PROJ));
  check('and it is not in the draft when it was not typed',
    !plain.paragraphs.join('\n').includes('TCS'));

  /* The promise printed under the button. Nothing concrete may appear that was
     not entered — so the only proper nouns in the draft are the ones supplied. */
  check('nothing was invented around it',
    !/\b(CGPA|GPA|first class|distinction|published|IEEE)\b/i.test(text),
    text.slice(0, 80));

  /* ------------------------------- a detail without its chip is not evidence */
  const orphan = await draft({
    signals: ['project'], motives: ['research'],
    details: { work: WORK, project: PROJ },
  });
  const oText = orphan.paragraphs.join('\n');
  check('a detail whose chip is not ticked is dropped',
    !oText.includes(WORK) && oText.includes(PROJ));

  /* ------------------------------------------------------- and it is capped */
  const long = 'x'.repeat(900);
  const capped = await draft({ signals: ['work'], details: { work: long } });
  check('a very long answer is cut rather than printed whole',
    !capped.paragraphs.join('').includes('x'.repeat(400)));

  /* -------------------------------------------------------- the studio, live */
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/');
  await page.waitForSelector('[data-ai="sop"]');
  await page.click('[data-ai="sop"]');
  /* They are all hidden until a chip is ticked, so wait for one to EXIST
     rather than to be visible. */
  await page.waitForSelector('.lv-ask', { state: 'attached' });

  check('no box is open before anything is ticked',
    (await page.$$('.lv-ask:not([hidden])')).length === 0);

  await page.click('[data-chip="work"][data-group="sig"]');
  await page.waitForTimeout(200);
  check('ticking a chip opens its question',
    (await page.$$('.lv-ask:not([hidden])')).length === 1);
  check('and the question is the one for that chip',
    /work/i.test(await page.$eval('.lv-ask[data-ask="sig:work"] label', e => e.textContent)));
  check('and the cursor is already in it',
    await page.evaluate(() => document.activeElement
      && document.activeElement.dataset.detail === 'work'));

  /* 'research' is a chip in BOTH lists. Without the group in the selector, a
     click on the motive opened the signal's box. */
  await page.click('[data-chip="research"][data-group="mot"]');
  await page.waitForTimeout(200);
  check('a motive that shares a key with a signal opens nothing',
    (await page.$$('.lv-ask:not([hidden])')).length === 1);

  await page.click('[data-chip="work"][data-group="sig"]');
  await page.waitForTimeout(200);
  check('unticking closes the question again',
    (await page.$$('.lv-ask:not([hidden])')).length === 0);

  /* End to end: type, generate, and read the words back off the page. */
  await page.click('[data-chip="work"][data-group="sig"]');
  await page.fill('#d_work', WORK);
  await page.click('#aiGo');
  await page.waitForSelector('#aiOut .ai-draft p');
  await page.waitForTimeout(400);
  const shown = await page.$eval('#aiOut', e => e.innerText);
  check('the studio puts it in the draft on the page', shown.includes(WORK),
    shown.slice(0, 100));

  check('no page errors', errs.length === 0, errs[0] || '');

  await browser.close();
  ok.forEach(n => console.log('  ok   ' + n));
  bad.forEach(n => console.log('  BAD  ' + n));
  console.log('\n' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
