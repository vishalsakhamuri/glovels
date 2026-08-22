/**
 * Every internal link on every page, followed.
 *
 * A menu item that 404s is invisible in the source and obvious to the first
 * visitor who presses it.
 */
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:8097';
const DIR = '/home/claude/glovels/build';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.html'));
  const links = new Map();          // href -> the page it was found on

  for (const f of files) {
    const r = await page.goto(BASE + '/' + f, { waitUntil: 'domcontentloaded' }).catch(() => null);
    if (!r) continue;
    await page.waitForTimeout(250);
    const hs = await page.$$eval('a[href]', els => els.map(e => e.getAttribute('href')))
      .catch(() => []);
    for (const h of hs) {
      if (!h || /^(#|mailto:|tel:|https?:|javascript:|data:)/.test(h)) continue;
      const target = h.split('#')[0];
      if (target && !links.has(target)) links.set(target, f);
    }
  }

  const bad = [];
  for (const [href, from] of links) {
    const r = await ctx.request.get(BASE + '/' + href.replace(/^\//, ''),
      { maxRedirects: 5 }).catch(() => null);
    if (!r || r.status() >= 400) bad.push(`${href}  (linked from ${from})  -> ${r ? r.status() : 'no response'}`);
  }

  console.log(`${files.length} pages, ${links.size} distinct internal links`);
  if (bad.length) {
    console.log('\nBROKEN');
    bad.forEach(x => console.log('  ✗ ' + x));
  } else {
    console.log('no broken internal links');
  }
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
