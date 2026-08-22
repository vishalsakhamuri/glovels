/**
 * What a visitor who has not paid may see.
 *
 * The single commercial lever on the site, and it was a string in the page. The
 * checks that matter are not "does the setting save" but "does the NAME leave
 * the server", because a page that hides a name with CSS has already sent it —
 * and that is exactly what this site did: 153 universities, their fees and
 * their course URLs, in every visitor's View Source.
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

const setGate = async (ctx, gate) => {
  const c = await (await ctx.request.get(BASE + '/api/staff/content')).json();
  const f = c.finder;
  f.gate = gate;
  await ctx.request.put(BASE + '/api/staff/content/finder', { data: { value: f } });
};

const asVisitor = async (browser) => {
  const c = await browser.newContext();
  const p = await c.newPage();
  await p.goto(BASE + '/#results', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);
  const out = {
    source: await p.content(),
    results: await p.textContent('#results'),
    api: await p.evaluate(async () => {
      const r = await fetch('/api/catalogue');
      const d = await r.json();
      const pub = (d.programmes || []).filter(x => x.isPublic);
      return {
        gate: d.gate,
        pub: pub.length,
        named: pub.filter(x => x.university).length,
        priced: pub.filter(x => x.totalInr).length,
      };
    }),
  };
  await c.close();
  return out;
};

(async () => {
  const browser = await chromium.launch();
  const admin = await browser.newContext();
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  /* ------------------------------------------------------------- gated */
  await setGate(admin, 'gated');
  let v = await asVisitor(browser);
  check('gated: the server names nothing public', v.api.named === 0,
    v.api.named + ' of ' + v.api.pub);
  check('gated: and no name is in the page source either',
    !/University of Lubeck|Ulm University|Bauhaus-Universit/.test(v.source),
    'found one');
  check('gated: the visitor sees blurred filler', /nemo enim/.test(v.results));

  /* ------------------------------------------------------------- names */
  await setGate(admin, 'names');
  v = await asVisitor(browser);
  check('names: every public university is named', v.api.named === v.api.pub,
    v.api.named + ' of ' + v.api.pub);
  check('names: but no fee comes with it', v.api.priced === 0, v.api.priced);
  check('names: the filler is gone', !/nemo enim/.test(v.results));

  /* -------------------------------------------------------------- open */
  await setGate(admin, 'open');
  v = await asVisitor(browser);
  check('open: names are there', v.api.named === v.api.pub, v.api.named);
  check('open: and so are the fees', v.api.priced > 0, v.api.priced);

  /* --------------------------------------------- back to the business model */
  await setGate(admin, 'gated');
  v = await asVisitor(browser);
  check('gated again: the names go back behind the gate', v.api.named === 0, v.api.named);

  /* ------------------------------------------ what a package actually buys */
  const pw = 'testing12345';
  const email = 'gate' + Date.now() + '@glovels.com';
  await admin.request.post(BASE + '/api/staff/people',
    { data: { name: 'Gate Test', email, role: 'student', password: pw } });

  const stu = await browser.newContext();
  await stu.request.post(BASE + '/api/auth/login', { data: { email, password: pw } });

  const seen = async () => {
    const d = await (await stu.request.get(BASE + '/api/catalogue')).json();
    const named = d.programmes.filter(p => p.isPublic && p.university);
    return { programmes: named.length, universities: new Set(named.map(p => p.uKey)).size };
  };

  check('a student who has not paid sees no public name', (await seen()).programmes === 0);

  const order = await (await stu.request.post(BASE + '/api/orders', {
    data: { packageId: 'pkg-roadmap', name: 'G', email, phone: '9876543210' },
  })).json();
  const after = await seen();
  check('the package promises universities, and delivers exactly that many',
    after.universities === order.publicUnis,
    order.publicUnis + ' promised, ' + after.universities + ' delivered');
  check('and every programme at those universities comes with it',
    after.programmes >= after.universities,
    after.programmes + ' programmes across ' + after.universities + ' universities');

  await browser.close();
  console.log('\nPASS');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
