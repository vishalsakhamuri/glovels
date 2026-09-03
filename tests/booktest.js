/**
 * The agency's book: what they can filter, close, remove — and what the screen
 * must never say.
 *
 * Patch 58 turned four dead counters into filters, moved adding a student into
 * a dialog, gave an agency a way to take a student off the list, and stripped
 * our name off every pixel of the screen. The last of those is the one that
 * needs a test rather than a look: a partner may show this screen to their own
 * student, so "Glovels" appearing anywhere on it is a product bug, and the
 * word can arrive from any of four shared files none of which are about
 * partners.
 *
 * Two things are deliberately separated here and must stay separated:
 *
 *   Close  — the agency is finished with a student. The record lives, the
 *            counsellor keeps the case, the student keeps their login. It
 *            comes off the agency's list and nothing else happens.
 *   Remove — the record should never have existed. It is deleted. Allowed
 *            ONLY while nobody has picked the student up and no money has
 *            changed hands.
 *
 * Confusing the two would let an agency erase a live case, so the refusal is
 * checked on the server, not on the button.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const stamp = Date.now();

(async () => {
  const browser = await chromium.launch();
  const admin = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await admin.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  /* An agency, and a second one to try the doors with. */
  const mk = async (name, email, password) => {
    await admin.request.post(BASE + '/api/staff/people',
      { data: { name, email, password, role: 'partner' } });
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await ctx.request.post(BASE + '/api/auth/login', { data: { email, password } });
    /* Somebody else chose it, so it opens one thing until replaced — and
       replacing it rotates the session, which is why signing in happens
       twice rather than once. */
    await ctx.request.post(BASE + '/api/auth/change',
      { data: { current: password, password: password + 'X' } });
    await ctx.request.post(BASE + '/api/auth/login',
      { data: { email, password: password + 'X' } });
    return ctx;
  };

  const emailA = 'book-a' + stamp + '@agency.example';
  const emailB = 'book-b' + stamp + '@agency.example';
  const A = await mk('Book Agency ' + stamp, emailA, 'book-a-' + stamp);
  const B = await mk('Other Agency ' + stamp, emailB, 'book-b-' + stamp);

  const page = await A.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/partner.html');
  await page.waitForSelector('#stuRows');

  /* ------------------------------------------ nothing of ours on the screen */

  /* What actually reaches a person: the text on the screen, and the attributes
     a screen reader or a tooltip reads out. Deliberately NOT the raw HTML —
     the build leaves sentinel comments like GLOVELS-CHAT-WIDGET in the source,
     and those are markers for us, not words for anybody. */
  const surface = await page.$eval('body', b => {
    const bits = [b.innerText];
    b.querySelectorAll('[aria-label],[title],[alt],[placeholder]').forEach(el => {
      ['aria-label', 'title', 'alt', 'placeholder']
        .forEach(a => { if (el.hasAttribute(a)) bits.push(el.getAttribute(a)); });
    });
    return bits.join(' \n ');
  });
  const hit = /.{0,80}Glovels.{0,50}/i.exec(surface);
  check('the partner screen never says our name', !hit, hit && hit[0]);
  check('the browser tab does not either', !/Glovels/i.test(await page.title()),
    await page.title());
  check('there is no mark in the sidebar',
    (await page.$$('.p-logo .logo-img')).length === 0);

  /* The public chat widget was reaching this page because the set that lists
     signed-in screens never grew when the page was added. A B2B portal
     offering a WhatsApp chat "Hi Glovels" is both wrong and off-brief — the
     partner contacts the office directly and has no chat at all. */
  check('and no marketing chat corner',
    (await page.$$('a[href*="wa.me"], .chat-fab, #glovelsChat')).length === 0);

  /* ------------------------------------------------- adding, from a dialog */

  check('the add dialog starts closed', (await page.$$('#addModal.on')).length === 0);
  await page.click('#openAdd');
  await page.waitForSelector('#addModal.on');
  check('Add a student opens it', true);

  const add = async (name, email, country) => {
    if ((await page.$$('#addModal.on')).length === 0) {
      await page.click('#openAdd');
      await page.waitForSelector('#addModal.on');
    }
    await page.fill('#aName', name);
    await page.fill('#aEmail', email);
    if (country) await page.selectOption('#aCountry', country);
    await page.click('#addOne');
    await page.waitForTimeout(700);
  };

  await add('Meera N' + stamp, 'meera' + stamp + '@ex.example', 'Germany');
  check('the dialog closes once the record exists',
    (await page.$$('#addModal.on')).length === 0);
  check('and the student is on the list', (await page.$$('.prow')).length === 1);

  await add('Owen T' + stamp, 'owen' + stamp + '@ex.example', 'Ireland');
  check('a second student goes in', (await page.$$('.prow')).length === 2);
  check('two countries brings out the destination strip',
    await page.$eval('#dests', e => !e.hidden));

  /* A record made with nothing but a name and an email — which is the whole
     point of the dialog being small. The rest goes in by pressing the row. */
  await add('Bare' + stamp, 'bare' + stamp + '@ex.example', '');
  check('name and email alone are enough to open a record',
    (await page.$$('.prow')).length === 3);

  /* ------------------------------------------------- the counters are doors */

  check('there are five counters', (await page.$$('#tiles .outgo')).length === 5);
  check('all students is pressed to begin with',
    await page.$eval('#tiles .outgo[data-tile="all"]',
      e => e.getAttribute('aria-pressed')) === 'true');
  check('and it counts the open book',
    (await page.textContent('#kStudents')).trim() === '3');

  await page.click('#tiles .outgo[data-tile="assigned"]');
  await page.waitForTimeout(300);
  check('with-a-counsellor filters to nobody yet',
    (await page.$$('.prow')).length === 0);
  check('and the screen says which slice it is showing',
    /only students with a counsellor/i.test(await page.textContent('#tileChip')));
  check('the empty table explains itself too',
    /No students with a counsellor/i.test(await page.textContent('#stuRows')));

  await page.click('#tileAll');
  await page.waitForTimeout(300);
  check('and there is always a way back to everyone',
    (await page.$$('.prow')).length === 3);

  await page.fill('#findStu', 'Owen');
  await page.waitForTimeout(300);
  check('search narrows to one student', (await page.$$('.prow')).length === 1);
  await page.fill('#findStu', '');
  await page.waitForTimeout(300);

  /* --------------------------------------------------- closing a finished file */

  await page.$eval('.prow [data-close-file]', el => el.click());
  await page.waitForTimeout(700);
  check('closing a file takes it off the list', (await page.$$('.prow')).length === 2);
  check('the closed counter picks it up',
    (await page.textContent('#kClosed')).trim() === '1');
  check('and the open book shrinks by one',
    (await page.textContent('#kStudents')).trim() === '2');

  await page.click('#tiles .outgo[data-tile="closed"]');
  await page.waitForTimeout(300);
  check('the closed tile is where it went', (await page.$$('.prow')).length === 1);
  check('and it offers a way back', (await page.$$('[data-open-again]')).length === 1);
  await page.$eval('[data-open-again]', el => el.click());
  await page.waitForTimeout(700);
  await page.click('#tiles .outgo[data-tile="all"]');
  await page.waitForTimeout(300);
  check('reopening puts it back on the book', (await page.$$('.prow')).length === 3);

  /* Closing is not deleting. The student is still ours, still theirs, and
     still able to sign in — an agency losing interest must not take a live
     application with it. */
  const list = await (await A.request.get(BASE + '/api/partner/students')).json();
  const meera = list.students.find(s => /^Meera N/.test(s.name));
  await A.request.put(BASE + '/api/partner/student/' + meera.id + '/closed',
    { data: { closed: true } });
  const staffSees = await (await admin.request.get(
    BASE + '/api/staff/student/' + meera.id)).json();
  check('a closed file is untouched on our side',
    !!staffSees && (staffSees.student || staffSees).id === meera.id);
  await A.request.put(BASE + '/api/partner/student/' + meera.id + '/closed',
    { data: { closed: false } });

  /* ------------------------------------------------------------- removing */

  check('a student nobody has picked up can be removed', meera.canRemove === true);
  const owen = list.students.find(s => /^Owen T/.test(s.name));
  const gone = await A.request.delete(BASE + '/api/partner/student/' + owen.id);
  check('and removing one works', gone.ok(), gone.status() + '');
  const after = await (await A.request.get(BASE + '/api/partner/students')).json();
  check('it leaves the book', !after.students.find(s => s.id === owen.id));
  const reads = await A.request.get(BASE + '/api/partner/student/' + owen.id);
  check('and the record is really gone', reads.status() === 404, reads.status() + '');

  /* Once we are on it, it stops being theirs to erase. */
  const co = await (await admin.request.post(BASE + '/api/staff/people',
    { data: { name: 'Book C' + stamp, email: 'bookc' + stamp + '@glovels.com',
              password: 'bookc-' + stamp, role: 'counsellor' } })).json();
  const coId = co.person ? co.person.id : co.id;
  await admin.request.put(BASE + '/api/staff/student/' + meera.id + '/counsellor',
    { data: { counsellorId: coId } });
  const now = await (await A.request.get(BASE + '/api/partner/students')).json();
  const held = now.students.find(s => s.id === meera.id);
  check('an assigned student cannot be removed', held.canRemove === false);
  const refused = await A.request.delete(BASE + '/api/partner/student/' + meera.id);
  check('the server refuses it, not the button', refused.status() === 409,
    refused.status() + '');
  check('and the refusal offers closing instead',
    /close the file/i.test((await refused.json()).error || ''));

  /* The button is not offered where it would refuse. A control that always
     says no teaches people to distrust every other control on the page. */
  await page.reload();
  await page.waitForSelector('.prow');
  await page.waitForTimeout(500);
  const rows = await page.$$eval('.prow', rs => rs.map(r => ({
    name: r.querySelector('b').textContent,
    canRemove: !!r.querySelector('[data-rm]'),
    canClose: !!r.querySelector('[data-close-file], [data-open-again]'),
  })));
  const heldRow = rows.find(r => /^Meera N/.test(r.name));
  check('so an assigned student shows no Remove', heldRow && !heldRow.canRemove);
  check('but can still be closed', heldRow && heldRow.canClose);

  /* --------------------------------------------- one agency, one book, still */

  const spoofClose = await B.request.put(
    BASE + '/api/partner/student/' + meera.id + '/closed', { data: { closed: true } });
  check('another agency cannot close your student',
    spoofClose.status() === 404, spoofClose.status() + '');
  const spoofKill = await B.request.delete(BASE + '/api/partner/student/' + meera.id);
  check('nor remove them', spoofKill.status() === 404, spoofKill.status() + '');

  /* Staff are refused both, like every other partner route. */
  const staffClose = await admin.request.put(
    BASE + '/api/partner/student/' + meera.id + '/closed', { data: { closed: true } });
  check('and staff are refused the partner routes',
    staffClose.status() === 403, staffClose.status() + '');

  /* --------------------------------------- the colleagues panel is switched off */

  check('the team panel is off for now',
    (await page.$$('#teamSec, #addMate')).length === 0);
  /* Switched off in the build, not torn out — the endpoints and their scoping
     are what keep one agency out of another's book and must keep working. */
  const team = await A.request.get(BASE + '/api/partner/team');
  check('though the endpoint behind it still answers', team.ok(), team.status() + '');

  check('no page errors', errs.length === 0, errs[0] || '');

  await browser.close();
  ok.forEach(n => console.log('  ok   ' + n));
  bad.forEach(n => console.log('  BAD  ' + n));
  console.log('\n' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
