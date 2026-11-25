/**
 * Patch 308: "Students" is in the side menu of every staff screen.
 *
 * Patch 298 added it to the Command centre and the Leads command only, so it
 * vanished the moment somebody opened Conversations (owner, 25 Nov).
 * No server needed: this reads the pages.
 *
 *   node navstudentstest.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

const pages = fs.readdirSync(ROOT).filter(f => /\.html$/.test(f) && /<a href="ops\.html"[^>]*>/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
check('the staff screens are found', pages.length >= 11, pages.join(', '));
const anchors = html => (html.match(/<a href="[^"]*"[^>]*>[\s\S]*?<\/a>/g) || []);
const icons = new Set();
pages.forEach(f => {
  const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const as = anchors(html);
  const i = as.findIndex(a => /^<a href="ops\.html"[\s>]/.test(a) && /Command centre<\/a>$/.test(a));
  const next = i >= 0 ? as[i + 1] || '' : '';
  check(f + ': Students comes straight after Command centre', /^<a href="ops\.html#students"/.test(next) && /Students<\/a>$/.test(next), next.slice(0, 60));
  check(f + ': …once', (html.match(/href="ops\.html#students"/g) || []).length === 1);
  const need = a => (a.match(/data-need="([^"]*)"/) || [, ''])[1];
  check(f + ': …shown to the same people as Command centre', i >= 0 && need(as[i]) === need(next), need(as[i] || '') + ' / ' + need(next));
  check(f + ': …and is not marked as the open screen by the page itself', f === 'ops.html' || !/class="[^"]*\bon\b/.test(next.split('>')[0]));
  const icon = (next.match(/<svg[^>]*>([\s\S]*?)<\/svg>/) || [, ''])[1];
  if (icon) icons.add(icon);
});
check('it is the same picture everywhere', icons.size === 1, icons.size + ' different');

/* Patch 312 (owner, 26 Nov: "unable to scroll down … unable to see last option"):
   the menu is pinned to the height of the window, and with Students and
   Finance in it it is taller than a laptop screen. Where it is pinned it
   scrolls by itself. */
['ops.html', 'leads-command.html', 'marketing.html', 'languages.html', 'finance.html'].forEach(f => {
  const css = (fs.readFileSync(path.join(ROOT, f), 'utf8').match(/\.rail\{[^}]*\}/) || [''])[0];
  check(f + ': a menu taller than the window scrolls', /height:100vh/.test(css) && /overflow-y:auto/.test(css), css.slice(0, 80));
});

bad.forEach(b => console.log('FAIL  ' + b));
console.log(ok.length + ' passed, ' + bad.length + ' failed');
process.exit(bad.length ? 1 : 0);
