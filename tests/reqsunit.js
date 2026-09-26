/**
 * server/reqs.js and the one bug in server/sheet.js it uncovered — unit,
 * no server. What a programme asks for: read from a form or a sheet, refused
 * when it cannot be read, checked against what a student said.
 */
const assert = require('node:assert');
const R = require('../server/reqs.js');
const S = require('../server/sheet.js');
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

/* clean(): every key present, blank is null, never zero */
const c = R.clean({ ieltsMin: '6.5', tuitionEurSem: '', germanLevel: 'a2', papersRequired: 'Yes', workExpMonths: '2 years', greRequired: 'Required' }).reqs;
check('blank is null, not zero', c.tuitionEurSem === null);
check('a level is upper-cased', c.germanLevel === 'A2');
check('yes/no reads words', c.papersRequired === true && c.greRequired === true);
check('"2 years" is 24 months', c.workExpMonths === 24);
check('"20 weeks" is 5 months', R.clean({ workExpMonths: '20 weeks' }).reqs.workExpMonths === 5);
check('"english" is level none', R.clean({ germanLevel: 'English-taught' }).reqs.germanLevel === 'none');
check('every field is present', R.FIELDS.every(f => f.key in c));

/* problems(): refused, never clamped, in the form's own words */
const p = R.problems({ ieltsMin: 12, greMin: 'yes', germanLevel: 'fluent', papersRequired: 'maybe', workExpMonths: 'lots', bachelorYears: 7 });
check('six mistakes, six refusals', p.length === 6, p.length);
check('the IELTS sentence names the bounds', p.some(x => x.why === 'IELTS minimum has to be between 4 and 9. You entered "12".'));
check('the level sentence lists the levels', p.some(x => /none, A1, A2, B1, B2, C1 or C2/.test(x.why)));
check('a refused value is stored as null, not the guess', R.clean({ ieltsMin: 12 }).reqs.ieltsMin === null);

/* the sheet, both ways */
const row = R.toSheet(R.clean({ ieltsMin: 6.5, papersRequired: false, germanLevel: 'none' }).reqs);
check('the sheet writes yes/no as words', row[R.SHEET_HEADERS.indexOf('papers required')] === 'no');
check('the sheet has one column per field', row.length === R.FIELDS.length && R.SHEET_HEADERS.length === R.FIELDS.length);
const back = R.fromSheet(h => ({ 'ielts': '7', 'german language level': 'B1', 'work experience required': 'yes', 'gre': 'no' })[h]);
check('aliases are read — "ielts", "german language level"', back.ieltsMin === '7' && back.germanLevel === 'B1');
check('"gre" alone is the required flag, not a minimum', back.greRequired === 'no' && back.greMin === undefined);
check('"work experience required" lands on the flag', back.workExpRequired === 'yes');
check('parse() never throws on an old row', R.parse('').ieltsMin === null && R.parse('not json').ieltsMin === null);

/* check(): stated + answered + short = fail; stated + unanswered = unknown; unstated = nothing */
let v = R.check({ ieltsMin: 6.5, toeflMin: 88 }, { ielts: 6 });
check('short on IELTS fails, and says both tests', v.fails.length === 1 && v.fails[0].want === 'IELTS 6.5 or TOEFL 88');
v = R.check({ ieltsMin: 6.5, toeflMin: 88 }, { toefl: 90 });
check('either test clears', v.ok);
v = R.check({ ieltsMin: 6.5 }, {});
check('no score is unknown, not a fail', v.unknown.includes('english') && !v.fails.length);
v = R.check({ ieltsMin: 6.5 }, { englishNone: true });
check('"not taken yet" fails a stated English test', v.fails.length === 1 && v.fails[0].have === 'not taken yet');
v = R.check({}, {});
check('a programme that states nothing cannot be failed', v.ok);
v = R.check({ greRequired: true }, { gre: false });
check('GRE required, not taken — fails', v.fails[0] && v.fails[0].have === 'not taken');
v = R.check({ greRequired: true }, { gre: 305 });
check('GRE required with no figure — any score clears', v.ok);
v = R.check({ greMin: 310 }, { gre: 305 });
check('a GRE floor is a floor', v.fails[0] && v.fails[0].key === 'gre');
v = R.check({ germanLevel: 'A2' }, { germanLevel: 'A1' });
check('A1 does not clear A2', v.fails[0] && v.fails[0].key === 'germanLevel');
v = R.check({ germanLevel: 'none' }, {});
check('German "none" asks nothing', v.ok);
v = R.check({ bachelorYears: 4 }, { bachelorYears: 3 });
check('a three-year bachelor fails a four-year ask', v.fails[0] && v.fails[0].key === 'bachelorYears');
v = R.check({ workExpRequired: true }, { workExpMonths: 0 });
check('work experience required, none — fails', v.fails[0] && v.fails[0].want === 'some work experience');
v = R.check({ workExpRequired: true, workExpMonths: 24 }, { workExpMonths: 12 });
check('a stated floor beats the flag', v.fails[0] && v.fails[0].want === '24 months');
v = R.check({ workExpRequired: false }, { workExpMonths: 0 });
check('"not required" asks nothing', v.ok);
v = R.check({ papersRequired: true }, {});
check('a paper unanswered is unknown', v.unknown.includes('papers'));

/* sheet.js: an empty styled cell must not swallow the next one */
const xml = '<?xml version="1.0"?><worksheet><sheetData>'
  + '<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="B1" t="inlineStr"><is><t>b</t></is></c><c r="C1" t="inlineStr"><is><t>c</t></is></c></row>'
  + '<row r="2"><c r="A2" t="inlineStr"><is><t>x</t></is></c><c r="B2" s="2"/><c r="C2"><v>71</v></c></row>'
  + '</sheetData></worksheet>';
const zip = S.zip([
  { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
  { name: 'xl/workbook.xml', data: Buffer.from('<workbook/>') },
  { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(xml) },
]);
const rows = S.readXlsx(zip);
check('an empty styled cell reads as blank', rows[1][1] === '', JSON.stringify(rows[1]));
check('and the cell after it keeps its own column', rows[1][2] === '71', JSON.stringify(rows[1]));

console.log('reqsunit: ' + ok.length + ' passed, ' + bad.length + ' failed');
bad.forEach(b => console.log('  FAIL ' + b));
process.exit(bad.length ? 1 : 0);
