/**
 * The profile form, after the Student View Corrections document.
 *
 * Nine changes, and two of them are not form-filling:
 *
 *   THE NAME IS TWO BOXES NOW. Every university form, every visa form and
 *   every airline ticket asks for a given name and a surname separately, and
 *   splitting one "full name" ourselves means guessing which half is the
 *   surname — which for a great many Indian names is the wrong way round.
 *   `fullName` still exists and is still what the account, the matcher, the
 *   alerts, the caseload and the partner portal read; it is composed on the
 *   server from the two boxes. So the thing to prove is not that two boxes
 *   exist, it is that everything downstream still gets one name.
 *
 *   FIVE FIELDS OF STUDY, NOT ONE. "so student can give more options for us,
 *   instead of just 1." A student open to Data Science, AI and Computer
 *   Science was being made to pick which one we would search on. That is only
 *   worth anything if the MATCHER reads all five, so this buys a package with
 *   a field typed into box three and nothing in box one, and checks the
 *   shortlist that comes back is about that field.
 *
 * The rest are fields and lists, checked by walking the form the way a student
 * does — one section at a time, because that is how it renders.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
const S = Date.now();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };

/* Walk every section and collect what is on it. The form shows one section at
   a time, so a check that looks at the page once sees Personal details and
   concludes the other sixty fields are missing. */
async function walk(page) {
  const seen = new Set();
  const labels = {};
  const opts = {};
  for (let i = 0; i < 20; i++) {
    const got = await page.evaluate(() => {
      const out = { names: [], labels: {}, opts: {} };
      document.querySelectorAll('#pForm [name]').forEach(el => {
        out.names.push(el.name);
        const f = el.closest('.field');
        const l = f && f.querySelector('label');
        if (l) out.labels[el.name] = l.textContent.trim();
        if (el.tagName === 'SELECT') {
          out.opts[el.name] = [...el.options].map(o => o.textContent.trim());
        }
      });
      return out;
    }).catch(() => ({ names: [], labels: {}, opts: {} }));
    got.names.forEach(n => seen.add(n));
    Object.assign(labels, got.labels);
    Object.assign(opts, got.opts);
    const moved = await page.evaluate(() => {
      const n = document.querySelector('#nextBtn');
      if (!n || n.disabled || n.hidden || n.offsetParent === null) return false;
      n.click();
      return true;
    }).catch(() => false);
    if (!moved) break;
    await page.waitForTimeout(320);
  }
  return { seen, labels, opts };
}

(async () => {
  const browser = await chromium.launch();
  const admin = await browser.newContext();
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  const email = 'fm' + S + '@student.example';
  const password = 'a-real-password-' + S;
  const stu = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await stu.request.post(BASE + '/api/auth/signup',
    { data: { name: 'Form Student', email, phone: '9876543210', password } });

  const page = await stu.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/profile.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const { seen, labels, opts } = await walk(page);
  ok(seen.size > 40, 'the form has its fields — ' + seen.size);

  /* ------------------------------------------------------------ the name */
  ok(seen.has('firstName') && seen.has('lastName'),
    'the name is asked for in two boxes');
  ok(!seen.has('fullName'),
    'and the single box is gone from the form');
  ok(/first name|given/i.test(labels.firstName || ''),
    'labelled the way a passport is — ' + labels.firstName);
  ok(/last name|surname/i.test(labels.lastName || ''),
    'and so is the other — ' + labels.lastName);

  /* ------------------------------------------------------------ new fields */
  ok(seen.has('pob'), 'place of birth is asked for');
  ok(/place of birth/i.test(labels.pob || ''), 'and says as on the passport — '
    + labels.pob);
  ['addr1', 'city', 'state', 'pin', 'addr_country'].forEach(k => {
    ok(seen.has(k), 'the address section has ' + k);
  });
  ok(seen.has('d_start'), 'the degree asks when they joined');
  ok(/joining|start/i.test(labels.d_start || ''), 'in those words — ' + labels.d_start);
  ok(/total backlog/i.test(labels.d_backlog || ''),
    'and asks for TOTAL backlogs, not active ones — ' + labels.d_backlog);

  /* --------------------------------------------------------- the board lists */
  const x = opts.x_board || [];
  ok(x.length > 25, 'Class 10 offers the boards of India, not four of them — '
    + x.length + ' options');
  ok(x.some(o => /CBSE/.test(o)) && x.some(o => /Telangana/i.test(o))
    && x.some(o => /Maharashtra/i.test(o)),
    'including the state boards by name');
  ok(x[x.length - 1] === 'Other', 'with Other last — ' + x[x.length - 1]);
  ok(!x.includes('State board'),
    'and no bare "State board", which is the answer that told us nothing');

  const xii = opts.xii_board || [];
  ok(xii.length > 25, 'Class 12 has its own list — ' + xii.length);
  ok(xii.some(o => /Intermediate|Higher Secondary|HSC|PUC|Plus Two/i.test(o)),
    'and it is the intermediate boards, not the Class 10 ones');

  /* The escape box, which is NOT in the walk above and should not be.
   *
   * It has a `show` rule, so it only exists in the DOM once the board is
   * "Other" — a box asking which board, shown to somebody who found theirs on
   * the list, is a question with no answer. So it is checked by working the
   * control rather than by looking for the field, and it has to be checked
   * BOTH ways: a box that is always there and a box that is never there both
   * pass a one-sided check. */
  const escapeBox = async (sel, other, listed) => {
    await page.evaluate(k => {
      const el = document.querySelector('#pStepsWrap, #pForm');
      if (el) el.scrollIntoView();
    }).catch(() => {});
    /* Back to the section that holds it — the walk left the form on the last
       one, and the control is not on the page any more. */
    await page.goto(BASE + '/profile.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    for (let i = 0; i < 20; i++) {
      if (await page.$('[name="' + sel + '"]')) break;
      const moved = await page.evaluate(() => {
        const n = document.querySelector('#nextBtn');
        if (!n || n.disabled || n.hidden || n.offsetParent === null) return false;
        n.click();
        return true;
      }).catch(() => false);
      if (!moved) break;
      await page.waitForTimeout(280);
    }
    const set = async v => {
      await page.evaluate(([k, val]) => {
        const s = document.querySelector('[name="' + k + '"]');
        if (!s) return;
        s.value = val;
        s.dispatchEvent(new Event('change', { bubbles: true }));
      }, [sel, v]).catch(() => {});
      await page.waitForTimeout(500);
      return page.evaluate(k => !!document.querySelector('[name="' + k + '"]'),
        sel + '_other').catch(() => false);
    };
    return { onList: await set(listed), onOther: await set(other) };
  };

  const esc10 = await escapeBox('x_board', 'Other',
    'CBSE — Central Board of Secondary Education');
  ok(esc10.onOther, 'choosing Other opens a box to type the Class 10 board in');
  ok(!esc10.onList, 'and it is not there when the board was on the list — '
    + JSON.stringify(esc10));

  const esc12 = await escapeBox('xii_board', 'Other',
    'CBSE — Central Board of Secondary Education');
  ok(esc12.onOther, 'Class 12 has the same escape');
  ok(!esc12.onList, 'and hides it the same way — ' + JSON.stringify(esc12));

  /* --------------------------------------------------------- the two tests */
  ok(seen.has('e2_test') && seen.has('e2_score'),
    'a second English test can be recorded');
  ok(seen.has('a2_test') && seen.has('a2_score'),
    'and a second aptitude test');
  const a1 = opts.a_test || [];
  ok(a1.some(o => /^GATE$/.test(o)),
    'GATE is on the aptitude list — ' + JSON.stringify(a1));

  /* ---------------------------------------------------------- five fields */
  ['g_field', 'g_field2', 'g_field3', 'g_field4', 'g_field5'].forEach(k => {
    ok(seen.has(k), 'the goals section has ' + k);
  });

  ok(!errs.length, 'no page errors filling the form — ' + errs.slice(0, 2).join(' | '));

  /* ================================================================= saving
   *
   * Two boxes in, one name out — to the profile, to the account, and to the
   * caseload the office reads. That is the whole reason the split was safe. */
  const save = await stu.request.put(BASE + '/api/profile', {
    data: { profile: {
      firstName: 'Ananya', lastName: 'Rao', pob: 'Vijayawada',
      addr1: 'Plot 60', city: 'Hyderabad', state: 'Telangana', pin: '500081',
      x_board: 'Other', x_board_other: 'Anglo-Indian Board',
      d_start: '2020', d_backlog: 'None',
      g_level: "Master's", g_country: 'Germany',
      b_total: '₹10-20 Lakhs', d_cgpa: '8.1',
    } },
  });
  ok(save.ok(), 'the profile saves — ' + save.status());

  const state = await (await stu.request.get(BASE + '/api/state')).json();
  ok(state.profile.fullName === 'Ananya Rao',
    'the two boxes become one full name on the server — '
    + JSON.stringify(state.profile.fullName));
  ok(state.user.name === 'Ananya Rao',
    'the account is renamed with it — ' + JSON.stringify(state.user.name));
  ok(state.profile.firstName === 'Ananya' && state.profile.lastName === 'Rao',
    'and the halves are kept as they were typed');
  ok(state.profile.x_board_other === 'Anglo-Indian Board',
    'a board that was not on the list is kept — '
    + JSON.stringify(state.profile.x_board_other));

  const roster = await (await admin.request.get(BASE + '/api/staff/students')).json();
  const row = (roster.students || []).find(x => x.email === email);
  ok(row && row.name === 'Ananya Rao',
    'and the office sees the same name — ' + (row && row.name));

  /* An old record — fullName and neither half — still shows a name in the
     boxes rather than opening empty and being blanked on the next save. */
  const oldEmail = 'fmold' + S + '@student.example';
  const old = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await old.request.post(BASE + '/api/auth/signup',
    { data: { name: 'Old Record', email: oldEmail, phone: '9876543210',
      password: 'a-real-password-' + S } });
  await old.request.put(BASE + '/api/profile',
    { data: { profile: { fullName: 'Sai Kiran Reddy' } } });
  const op = await old.newPage();
  await op.goto(BASE + '/profile.html', { waitUntil: 'domcontentloaded' });
  await op.waitForTimeout(2500);
  const split = await op.evaluate(() => ({
    first: (document.querySelector('[name="firstName"]') || {}).value,
    last: (document.querySelector('[name="lastName"]') || {}).value,
  })).catch(() => null);
  ok(split && split.first === 'Sai Kiran' && split.last === 'Reddy',
    'a name written before the split opens in the two boxes, surname last — '
    + JSON.stringify(split));
  await op.close();

  /* ================================================ five fields, in the matcher
   *
   * The point of the extra boxes. A field typed into box THREE with box one
   * empty must drive the shortlist — under the old code only box one was read,
   * so this student would have been matched on nothing at all. */
  const buy = async (tag, profile) => {
    const c = await browser.newContext();
    const e = tag + S + '@student.example';
    await c.request.post(BASE + '/api/auth/signup',
      { data: { name: 'T', email: e, phone: '9876543210', password: 'a-real-password-' + S } });
    await c.request.put(BASE + '/api/profile', { data: { profile } });
    await c.request.post(BASE + '/api/orders', { data: { packageId: 'pkg-roadmap',
      name: 'T', email: e, phone: '9876543210', acceptedTerms: true } });
    const st = await (await c.request.get(BASE + '/api/state')).json();
    return (st.shortlist || []).map(x => String(x.program || ''));
  };
  const base = { firstName: 'A', lastName: 'B', g_level: "Master's",
    g_country: 'Germany', b_total: '₹10-20 Lakhs', d_cgpa: '8.1' };

  const box1 = await buy('fb1', Object.assign({}, base, { g_field: 'Robotics' }));
  const box3 = await buy('fb3', Object.assign({}, base, { g_field3: 'Robotics' }));
  const none = await buy('fb0', base);

  const robots = list => list.filter(n => /robot/i.test(n)).length;
  ok(box1.length > 0 && box3.length > 0 && none.length > 0,
    'all three students get a shortlist — '
    + [box1.length, box3.length, none.length].join('/'));
  ok(robots(box1) > 0, 'a field in box one matches — ' + JSON.stringify(box1.slice(0, 2)));
  ok(robots(box3) > 0,
    'and a field in box THREE matches just as well — ' + JSON.stringify(box3.slice(0, 2)));
  ok(robots(box3) > robots(none),
    'which a student who said nothing does not get — '
    + robots(box3) + ' vs ' + robots(none));

  /* ------------------------------------------- signing up asks for a name */
  const lp = await browser.newContext();
  const lpage = await lp.newPage();
  await lpage.goto(BASE + '/login.html', { waitUntil: 'domcontentloaded' });
  await lpage.waitForTimeout(1200);
  const signup = await lpage.evaluate(() => {
    const el = document.querySelector('#lName');
    if (!el) return null;
    const f = el.closest('label') || el.parentElement;
    return { ph: el.getAttribute('placeholder') || '',
      label: (f ? f.textContent : '').trim() };
  }).catch(() => null);
  ok(signup && !/passport/i.test(signup.ph + ' ' + signup.label),
    'signing up does not send somebody to find their passport — '
    + JSON.stringify(signup));
  ok(signup && /name/i.test(signup.label), 'it just asks for a name — '
    + (signup || {}).label);

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASHED: ' + (e && e.stack || e)); process.exit(1); });
