/*
 * Patch 145 — what the student agents found (29 Sep 2026). No server needed:
 * the matcher and the receipt are plain functions.
 */
const path = require('path');
const M = require(path.join(__dirname, '..', 'server', 'matches.js'));
const E = require(path.join(__dirname, '..', 'server', 'emails.js'));
let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + (e ?? ''))); };
const y = new Date().getFullYear();
const row = (id, o) => Object.assign({ id, program: 'MSc Computer Science', field: 'Computer Science & IT', university: 'Uni ' + id,
  isPublic: true, level: 'master', country: 'DE', totalInr: 0, intakes: [] }, o);
const C = { DE: { minCgpaPublic: 7.5, minCgpaPrivate: 6 } };
const base = { g_country: 'Germany', g_level: "Master's", g_field: 'Computer Science', d_course: 'B.Tech CSE', d_dur: '4 years', d_cgpa: '8.5', e_test: 'IELTS', e_score: '7' };

/* 1. The intake they chose. */
const summer = 'Summer ' + (y + 1);
let r = M.plan([
  row('closed', { intakes: [{ season: 'summer', deadline: (y) + '-01-01' }] }),   // summer deadline long before a summer start next year? Jan 1 this year → for Summer y+1 it maps to Jan 1 y+1: open
  row('wrongseason', { intakes: [{ season: 'winter', deadline: (y + 1) + '-07-15' }] }),
  row('undated'),
], Object.assign({}, base, { g_intake: summer }), 3, 'public', C);
ok('a winter-only programme is not picked for a summer intake', !r.items.some(p => p.id === 'wrongseason') || r.relaxed.includes('term'), r.items.map(p => p.id));
ok('a programme with no published dates is still offered', r.items.some(p => p.id === 'undated'), r.items.map(p => p.id));

/* 2. Courses a student visa does not cover. */
r = M.plan([row('emba', { program: 'Executive MBA', level: 'mba', field: 'MBA' }), row('ft', { program: 'MBA Full-time', level: 'mba', field: 'MBA' })],
  Object.assign({}, base, { g_level: 'MBA', g_field: 'MBA', w_has: 'Yes', w_months: '36' }), 2, 'public', C);
ok('an executive / part-time / online programme is never picked', !r.items.some(p => p.id === 'emba') && r.items.some(p => p.id === 'ft'), r.items.map(p => p.id));

/* 3. No master's without a bachelor's. */
r = M.plan([row('m1')], { g_country: 'Germany', g_level: "Master's", g_field: 'Computer Science', xii_score: '85' }, 1, 'public', C);
ok('a 12th-pass student is not sold a master\'s', r.items.length === 0 && /bachelor/i.test(r.note), r.note);

/* 4. A private programme at ₹0 is an unknown fee, not inside a budget. */
r = M.plan([row('p0', { isPublic: false, totalInr: 0 }), row('p9', { isPublic: false, totalInr: 900000 })],
  Object.assign({}, base, { b_total: 'Under ₹10 Lakhs' }), 1, 'private', C);
ok('a private ₹0 row does not top an under-₹10L list', r.items[0] && r.items[0].id === 'p9', r.items.map(p => p.id));

/* 5. Words that are not subjects. */
const w = M.wants({ g_field: 'Embedded Systems', g_field2: 'VLSI' });
ok('"Interactive Media Systems" is not an embedded-systems programme', M.relevance({ program: 'Interactive Media Systems', field: 'Media & Communication' }, w) === 0);
ok('"Electronics and Communication" reads as electronics, not media',
  [...M.fieldsWanted('B.Tech Electronics and Communication').direct].join() === 'Electrical & Electronics Engineering');
ok('"Public Policy" is not public health',
  M.relevance({ program: 'MA International Economics and Public Policy', field: 'Economics' }, M.wants({ g_field: 'Public Health' })) === 0);
ok('"Dysphagia Management" is not business',
  M.relevance({ program: 'Dysphagia Management MSc', field: 'Medicine, Dentistry & Allied Health' }, M.wants({ g_field: 'Business', g_field2: 'Finance' })) === 0);

/* 6. The bachelor's subject, with only real neighbours. */
ok('an English graduate does not "fit" a Psychology bachelor\'s requirement',
  !M.subjectFits({ reqs: { bachelorSubjects: 'Psychology' } }, M.wants({ d_course: 'BA English' })));
ok('an ECE graduate fits "Electrical Engineering, IT or related"',
  M.subjectFits({ reqs: { bachelorSubjects: 'Electrical Engineering, IT or related' } }, M.wants({ d_course: 'B.Tech ECE' })));

/* 7. Usable needs a level and a field. */
ok('country and budget alone do not pick a paid list', !M.usable({ g_country: 'Germany', b_total: 'Under ₹10 Lakhs' }));

/* 8. The ₹99 receipt promises no call. */
const rc = E.orderReceipt({ name: 'A B', email: 'a@b.c', reference: 'R', packageName: 'x', grossPaise: 9900, publicUnis: 0,
  siteUrl: 'https://g', hasAccount: true, services: ['Private match preview'], matchedOnly: true });
ok('the entry-offer receipt does not promise a counsellor call', !/calls you within one working day/.test(rc.text) && /six questions/.test(rc.text));
ok('  · and does not ask somebody with an account to create one', !/Create your account/.test(rc.text));

console.log('round145test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
