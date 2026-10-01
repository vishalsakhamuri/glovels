/*
 * Patch 149 — GRE and MOI in the staff matcher.
 *
 * The testing team: "GRE and MOI filters are not visible in counsellor view."
 * They were not there. Now: the panel asks GRE (taken + score / not taken) and
 * offers "MOI letter" as an English answer; programmes carry "moi accepted"
 * (from the team's v8 sheet); an MOI student clears only where the programme
 * says it accepts the letter; "GRE not taken" misses where the GRE is required.
 * Node only — the browser half is in round147test.
 */
const R = require('../server/reqs.js'), M = require('../server/matches.js');
let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + (e ?? ''))); };

const moi = M.answersOf({ e_test: 'Medium of Instruction letter' });
ok('an MOI letter is read from the profile', moi.moi === true && moi.englishNone === false, JSON.stringify(moi));
ok('MOI clears where it is accepted', R.check({ ieltsMin: 6.5, moiAccepted: true }, moi).fails.length === 0);
const no = R.check({ ieltsMin: 6.5, moiAccepted: false }, moi);
ok('MOI misses where the programme says no', no.fails.length === 1 && /not accepted/.test(no.fails[0].want), JSON.stringify(no));
const ns = R.check({ ieltsMin: 6.5 }, moi);
ok('MOI misses where acceptance is not stated', ns.fails.length === 1 && /not confirmed/.test(ns.fails[0].want), JSON.stringify(ns));
ok('a programme with no English bar is not affected', R.check({}, moi).fails.length === 0);
ok('an IELTS score still wins over an MOI letter',
  R.check({ ieltsMin: 6.5, moiAccepted: false }, M.answersOf({ e_test: 'IELTS', e_score: '7', e2_test: 'Medium of Instruction letter' })).fails.length === 0);

const gNo = M.answersOf({ a_test: 'Not taken yet' });
ok('"GRE not taken" is an answer', gNo.gre === false, JSON.stringify(gNo));
ok('  · and misses a programme that requires the GRE', R.check({ greRequired: true }, gNo).fails.length === 1);
ok('"Planning to take" stays a question', M.answersOf({ a_test: 'Planning to take' }).gre === undefined);
const g = M.answersOf({ a_test: 'GRE', a_score: '310' });
ok('a GRE score clears "required"', R.check({ greRequired: true }, g).fails.length === 0);
ok('  · and is measured against a stated minimum', R.check({ greRequired: true, greMin: 320 }, g).fails.length === 1);

ok('the import knows the "moi accepted" column', R.SHEET_HEADERS.includes('moi accepted'));

/* The screen: an empty bachelor's is a question, not a miss. */
const cat = [{ id: 'a', program: 'Computer Science', university: 'U', level: 'master', field: 'Computer Science & IT', country: 'DE', isPublic: true, totalInr: 0, intakes: [], reqs: {} }];
const sc = M.screen(cat, { g_country: 'Germany', g_level: "Master's", g_field: 'Computer Science' }, { DE: 'Germany', Germany: 'DE' }, {});
ok('with no bachelor’s on file the screen asks rather than misses',
  sc.fits.length === 1 && sc.fits[0].ask.some(a => /bachelor/.test(a)) , JSON.stringify(sc).slice(0, 200));

console.log('round149test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
