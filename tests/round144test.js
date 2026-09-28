/*
 * Patch 144 — intakes by term, with the real date.
 *
 * "Filters are not working on exact date … priority is this semester, but
 * dates are passed we show next semester." The intake dropdown now offers
 * the terms that have not started — this semester first, then next — and a
 * programme appears under a term only while its deadline for that term is
 * ahead. Every row under a term, locked or not, carries that exact date.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + (e ?? ''))); };
const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Sept: 8, Oct: 9, Nov: 10, Dec: 11 };
const parse = s => { const m = /Closes (\d+) (\w+) (\d{4})/.exec(s); return m ? new Date(Number(m[3]), MON[m[2]], Number(m[1])) : null; };

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(2500);
  await p.selectOption('#fCountry', 'DE').catch(() => {}); await p.waitForTimeout(400);
  const opts = await p.$$eval('#fIntake option', o => o.map(x => ({ v: x.value, t: x.textContent })).filter(x => x.v));
  ok('the intake list offers terms that have not started yet', opts.length > 0, JSON.stringify(opts));
  ok('  · named "This semester" / "Next semester" first, with when each starts',
    opts.length && /(This|Next) semester/.test(opts[0].t) && /starts/.test(opts[0].t), opts[0] && opts[0].t);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const starts = opts.map(o => { const m = /^(summer|winter)-(\d{4})$/.exec(o.v); return m ? new Date(Number(m[2]), m[1] === 'summer' ? 3 : 9, 1) : null; });
  ok('  · in order, and none already started', starts.every((d, i) => d && d > today && (!i || d > starts[i - 1])), opts.map(o => o.v).join(','));

  for (const o of opts.slice(0, 2)) {
    await p.selectOption('#fIntake', o.v); await p.click('#fGo').catch(() => {}); await p.waitForTimeout(900);
    const texts = [];
    for (const tab of ['pub', 'priv']) {
      await p.click('.rtab[data-rt="' + tab + '"]').catch(() => {}); await p.waitForTimeout(400);
      texts.push(...await p.evaluate(() => [...document.querySelectorAll('#results .mrow')].map(r => r.innerText)));
    }
    const dates = texts.map(parse);
    ok(o.v + ': every programme listed shows its closing date', texts.length === 0 || dates.every(Boolean),
      texts.filter((t, i) => !dates[i]).slice(0, 1).join('').slice(0, 120));
    ok(o.v + ':   · and none of those dates has passed', dates.filter(Boolean).every(d => d >= today),
      dates.filter(d => d && d < today).slice(0, 2).join(' | '));
  }
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close();
  console.log('round144test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('crashed: ' + (e && e.stack || e)); process.exit(1); });
