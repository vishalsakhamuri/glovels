/**
 * The showcase grid on the home page — "Real universities, matched to what
 * you're looking for".
 *
 * Three things were wrong with it and each is checked here by looking at the
 * rendered page rather than at the code:
 *
 *   · a note to developers about build scripts was printed on it, in a blue
 *     box, for every visitor to read;
 *   · it rendered a list frozen when the site was generated, so a university
 *     added on the Catalogue screen never appeared in it;
 *   · three names carried a double-escaped ampersand and read "AI &amp;
 *     Machine Learning" on the card.
 *
 * And one thing that was missing: choosing which programmes lead it.
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:8089';
/* A name unique to this run. Featuring is persistent by design, so a fixed
   name means the second run starts with the programme already featured and
   "it is not leading its band yet" fails against its own history. */
const UNI = 'Aberdeen Institute ' + Math.random().toString(36).slice(2, 7);

const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

const showcase = async (ctx, expect) => {
  const p = await ctx.newPage();
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  /* Wait for the repaint, not for a stopwatch. The loader chains /api/content
     then /api/catalogue, and on a cold server that is slower than any delay
     worth hard-coding — a fixed wait reports "the university never appeared",
     which is a lie about working code. */
  if (expect) {
    await p.waitForFunction(
      name => [...document.querySelectorAll('#catalogue .ccard .cuni')]
        .some(e => e.textContent.trim() === name),
      expect, { timeout: 15000 },
    ).catch(() => {});
  } else {
    await p.waitForTimeout(2600);
  }
  const out = {
    text: await p.textContent('#catalogue'),
    cards: await p.$$eval('#catalogue .ccard h4', els => els.map(e => e.textContent.trim())),
    rows: await p.$$eval('#catalogue .ccard', els => els.map(e => ({
      uni: e.querySelector('.cuni').textContent.trim(),
      band: e.getAttribute('data-band'),
    }))),
    unis: await p.$$eval('#catalogue .ccard .cuni', els => els.map(e => e.textContent.trim())),
    types: await p.$$eval('#catalogue .ccard .ctype', els => els.map(e => e.textContent.trim())),
    fees: await p.$$eval('#catalogue .ccard .cfee', els => els.map(e => e.textContent.trim())),
    modebar: await p.$('#catalogue .modebar'),
  };
  await p.close();
  return out;
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await ctx.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  let s = await showcase(ctx);

  /* ------------------------------------------------ the developer's note */
  check('the note about build scripts is gone', s.modebar === null);
  check('nothing on the page mentions a build script',
    !/build_block34|CATALOGUE_MODE/.test(s.text));

  /* ----------------------------------------------------- the ampersands */
  check('no card reads "&amp;"', !s.text.includes('&amp;'),
    (s.cards.find(c => c.includes('&amp;')) || ''));
  const amp = s.cards.find(c => c.includes(' & '));
  check('an ampersand renders as "&"', !!amp, amp || 'no card has one');

  /* ------------------------------------------------ private, with fees */
  check('more than two cards per band now', s.cards.length > 8, s.cards.length + ' cards');
  check('every card is a private university',
    s.types.every(t => t === 'Private'), [...new Set(s.types)].join(','));
  check('every card shows a fee',
    s.fees.every(f => /₹/.test(f)), s.fees.slice(0, 3).join(' | '));

  /* --------------------------------- a new university reaches the grid */
  const added = await ctx.request.put(BASE + '/api/staff/programme', {
    data: {
      program: 'MSc Marine Robotics', university: UNI,
      city: 'Aberdeen', country: 'GB', level: 'master', field: 'Aerospace & Robotics',
      isPublic: false, totalInr: 1450000, active: true,
    },
  });
  check('a private university can be added', added.ok(), added.status());
  const newId = (await added.json()).programme.id;

  /* It is in the catalogue, so the finder has it — but the showcase shows only
     the six cheapest in each price band, and at ₹14.5L this one does not make
     that cut. Which is exactly the situation featuring exists for. */
  check('the new university is in the catalogue',
    (await (await ctx.request.get(BASE + '/api/catalogue')).json())
      .programmes.some(x => x.university === UNI));

  s = await showcase(ctx);
  check('but it is not in the showcase — six cheapest per band win',
    !s.unis.includes(UNI), s.unis.length + ' cards');

  /* ------------------------------------------- choosing what leads it */

  const feat = await ctx.request.put(BASE + '/api/staff/programme', {
    data: { id: newId, program: 'MSc Marine Robotics',
      university: UNI, city: 'Aberdeen', country: 'GB',
      level: 'master', field: 'Aerospace & Robotics', isPublic: false,
      totalInr: 1450000, active: true, featured: true, featureSort: 1 },
  });
  check('it can be featured', feat.ok(), feat.status());

  s = await showcase(ctx, UNI);
  check('featuring puts it in the showcase', s.unis.includes(UNI),
    s.unis.join(' | ').slice(0, 120));

  /* Within its own price band. The grid groups by band, so "first on the page"
     would mean the cheapest band, which is not what featuring promises. */
  const band = (s.rows.find(r => r.uni === UNI) || {}).band;
  const inBand = s.rows.filter(r => r.band === band).map(r => r.uni);
  check('and puts it at the front of its price band', inBand[0] === UNI,
    inBand.join(' | '));

  /* Featuring must not have changed anything else about it. */
  const back = (await (await ctx.request.get(BASE + '/api/staff/catalogue')).json())
    .programmes.find(p => p.id === newId);
  check('featuring left the fee alone', back.totalInr === 1450000, back.totalInr);
  check('and the position is stored', back.featureSort === 1, back.featureSort);

  /* An edit that says nothing about featuring must not silently unfeature it. */
  await ctx.request.put(BASE + '/api/staff/programme', {
    data: { id: newId, program: 'MSc Marine Robotics',
      university: UNI, city: 'Aberdeen', country: 'GB',
      level: 'master', field: 'Aerospace & Robotics', isPublic: false,
      totalInr: 1500000, active: true },
  });
  const after = (await (await ctx.request.get(BASE + '/api/staff/catalogue')).json())
    .programmes.find(p => p.id === newId);
  check('an unrelated edit does not unfeature it', after.featured === true, after.featured);

  /* ------------------------------------------------------ the spreadsheet */
  const dl = await ctx.request.get(BASE + '/api/staff/catalogue.csv');
  const csv = await dl.text();
  check('the sheet carries the showcase columns',
    /showcase/.test(csv.split('\n')[0]) && /showcase position/.test(csv.split('\n')[0]),
    csv.split('\n')[0].slice(-60));

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
