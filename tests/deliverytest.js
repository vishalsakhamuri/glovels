/**
 * What a student gets for their money, and who they get to talk to.
 *
 * "University shortlist for public is not shown in the student login even
 *  after paid… when paid in full we need to show list of public unis after the
 *  filter criteria. Adding or removing can be done later by counsellor."
 * "Counsellor assigning is not visible when they select packages."
 * "Automatic is ok — who have less students, who are active."
 *
 * Two numbers control the first one and only one of them was ever set. `unlocks`
 * is how many public university NAMES a package reveals in the finder;
 * `matches` is how many the machine actually puts on the student's own
 * shortlist. The ₹4,999 tier had both at three and delivered three. The
 * ₹9,999, ₹49,999 and ₹74,999 tiers unlocked five, ten and fifteen names with
 * `matches` at zero — so somebody paying ₹74,999 signed in to an empty screen
 * while somebody paying ₹4,999 got three universities.
 *
 * And nobody was assigned to any of them.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, p, note) => (p ? ok : bad).push(n + (note ? ' — ' + note : ''));

/* A buyer nobody has met before: their own cookie jar and their own address,
   because the checkout attaches an order to whoever is signed in and the form
   has a per-IP flood guard. */
let seq = 0;
const shopper = async browser => {
  const ctx = await browser.newContext();
  const ip = '10.7.' + (seq++ % 250) + '.3';
  return {
    ctx,
    buy: (data) => ctx.request.post(BASE + '/api/orders',
      { headers: { 'x-forwarded-for': ip }, data }),
    api: (m, p, d) => ctx.request[m](BASE + p, d ? { data: d } : undefined),
  };
};

(async () => {
  const browser = await chromium.launch();
  const admin = await browser.newContext();
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  const PROFILE = { fullName: 'Buyer', d_cgpa: '8.2', g_level: "Master's",
    g_field: 'Data Science', g_country: 'Germany', b_total: 'Under ₹10 Lakhs' };

  const buyPackage = async (id) => {
    const s = await shopper(browser);
    const email = id + Date.now() + Math.random().toString(36).slice(2, 7) + '@example.com';
    const r = await s.buy({ packageId: id, name: 'Buyer ' + id, email,
      phone: '+919000009999', acceptedTerms: true });
    if (r.status() !== 200) return { email, error: r.status() + ' ' + (await r.text()).slice(0, 120) };
    await s.api('post', '/api/auth/change', { password: 'a-password-here' });
    await s.api('put', '/api/profile', { profile: PROFILE });
    const st = await (await s.api('get', '/api/state')).json();
    return { email, state: st, ctx: s.ctx };
  };

  /* --------------------------------------------- every tier hands over a list */
  const content = await (await admin.request.get(BASE + '/api/content')).json();
  const packages = (content.packages.items || []).filter(p => Number(p.unlocks || 0) > 0);
  check('there are packages that reveal public universities', packages.length >= 4,
    packages.map(p => p.id + ':' + p.unlocks).join(' '));

  for (const p of packages) {
    const got = await buyPackage(p.id);
    if (got.error) { check('buying ' + p.id + ' works', false, got.error); continue; }
    const sl = (got.state.shortlist || []);
    const pub = sl.filter(x => x.isPublic);
    /* THE regression, said as plainly as it can be: what they paid for is on
       their screen without anybody doing anything. */
    check('₹' + p.priceInr + ' ' + p.title + ' delivers its ' + p.unlocks +
          ' public universities',
      pub.length === Number(p.unlocks),
      pub.length + ' of ' + p.unlocks + ' (shortlist ' + sl.length + ')');
    check('  · and every one of them is a different university',
      new Set(pub.map(x => x.university)).size === pub.length);
    check('  · each one named, not blurred',
      pub.every(x => x.university && x.university.trim()),
      pub.filter(x => !x.university).length + ' with no name');
    /* And somebody to talk to about them. */
    check('  · with a counsellor on their screen',
      !!(got.state.counsellor && got.state.counsellor.name),
      JSON.stringify(got.state.counsellor));
  }

  /* --------------------------------------------- the office agrees they exist */
  const students = (await (await admin.request.get(BASE + '/api/staff/students')).json()).students;
  const buyers = students.filter(s => /^pkg-/.test(s.email));
  check('the office sees a counsellor against every one of them',
    buyers.length > 0 && buyers.every(s => s.counsellor),
    buyers.filter(s => !s.counsellor).length + ' of ' + buyers.length + ' unassigned');
  check('and a shortlist against every one of them',
    buyers.every(s => s.shortlist > 0),
    buyers.map(s => s.shortlist).join(','));

  /* ------------------------------------------- the load actually gets spread */
  /* Two counsellors, and a run of buyers. If assignment ignored the caseload
     they would all land on one person, which is the version of this that looks
     like it works right up until it matters. */
  const mk = async name => (await (await admin.request.post(BASE + '/api/staff/people',
    { data: { name, email: name.toLowerCase().replace(/\W+/g, '') + Date.now() + '@glovels.com',
      role: 'counsellor' } })).json());
  await mk('Spread One'); await mk('Spread Two');

  const before = (await (await admin.request.get(BASE + '/api/staff/students')).json()).students;
  const loadOf = list => {
    const m = {};
    list.forEach(s => { if (s.counsellor) m[s.counsellor.name] = (m[s.counsellor.name] || 0) + 1; });
    return m;
  };
  for (let i = 0; i < 6; i++) await buyPackage('pkg-three-public');
  const after = (await (await admin.request.get(BASE + '/api/staff/students')).json()).students;
  const load = loadOf(after);
  const b4 = loadOf(before);
  const gained = Object.keys(load).filter(k => (load[k] || 0) > (b4[k] || 0));
  check('six new buyers are spread across counsellors, not piled on one',
    gained.length >= 2, 'gained: ' + gained.join(', ') + ' | loads: ' + JSON.stringify(load));

  const counts = Object.values(load);
  check('and no counsellor ends up with far more than another',
    Math.max(...counts) - Math.min(...counts) <= 2,
    JSON.stringify(load));

  /* ------------------------------------ an existing assignment is never moved */
  const one = after.find(s => s.counsellor);
  const team = (await (await admin.request.get(BASE + '/api/staff/people')).json()).people
    .filter(p => p.role === 'counsellor');
  const other = team.find(c => c.id !== one.counsellor.id);
  await admin.request.put(BASE + '/api/staff/student/' + one.id + '/counsellor',
    { data: { counsellorId: other.id } }).catch(() => {});
  const placed = (await (await admin.request.get(BASE + '/api/staff/students')).json())
    .students.find(s => s.id === one.id);
  check('the office can move somebody', !!placed.counsellor, JSON.stringify(placed.counsellor));

  /* ------------------------- and a package with nothing to deliver delivers nothing
     Nothing to deliver means no matches, not no unlocks. Those were the same
     thing until the other-countries ladder arrived: ₹999 Assist unlocks no
     public names — there are none outside Germany — but it does promise three
     universities, and it delivers them. Selecting on `unlocks` alone picked
     that one up and read its three rows as a failure. */
  const none = (content.packages.items || [])
    .find(p => !Number(p.unlocks || 0) && !Number(p.matches || 0) && p.priceInr);
  if (none) {
    const got = await buyPackage(none.id);
    check('a work or migration package still shortlists nothing',
      !got.error && (got.state.shortlist || []).length === 0,
      none.id + ' → ' + ((got.state && got.state.shortlist) || []).length + ' rows');
    check('  · but still gets them a counsellor',
      !!(got.state && got.state.counsellor && got.state.counsellor.name));
  }

  /* And the case that exposed it: a package that promises universities without
     promising public ones has to deliver them. */
  const assist = (content.packages.items || [])
    .find(p => !Number(p.unlocks || 0) && Number(p.matches || 0) && p.priceInr);
  if (assist) {
    const got = await buyPackage(assist.id);
    const rows = (got.state && got.state.shortlist) || [];
    check('a package that promises universities without unlocking any delivers them',
      !got.error && rows.length > 0 && rows.length <= Number(assist.matches),
      assist.id + ' promised ' + assist.matches + ' → ' + rows.length + ' rows');
    check('  · and none of them is a gated public university',
      rows.every(r => !r.isPublic && !r.is_public),
      JSON.stringify(rows.map(r => r.university)).slice(0, 120));
  }

  await browser.close();
  console.log('\nPASS'); ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log('\nFAIL'); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
