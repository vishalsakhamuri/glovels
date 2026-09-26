/*
 * The 26 September round — eleven screenshots from the functional testers.
 * Most of it is layout, which a screenshot shows and a test cannot; what a
 * test CAN hold is that the markup and the rules the fixes rest on are there,
 * so a rebuild that loses one is caught before a tester has to find it twice.
 */
const BASE = process.env.BASE || 'http://localhost:8099';
let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + (e ?? ''))); };
/* The server lifts a page's inline scripts into one external file — so the
   page's text plus that file is "the page" for these checks. */
const get = async p => {
  const r = await fetch(BASE + p); let text = await r.text();
  for (const m of text.matchAll(/<script src="(\/js\/[^"]+\.js)"/g)) text += '\n' + await (await fetch(BASE + m[1])).text();
  return { status: r.status, text, h: r.headers };
};

(async () => {
  let r = await get('/');
  ok('the home page answers', r.status === 200, r.status);
  ok('finder rows: the name track has a floor and the last track can shrink', /52px minmax\(9em,19em\) 120px 116px 150px minmax\(0,1fr\)/.test(r.text));
  ok('finder rows: the action cell wraps', /\.mact\{justify-self:end;display:flex;flex-wrap:wrap/.test(r.text));
  ok('showcase: the trending badge keeps a gap from the link', /\.ctrend\+\.cmore\{vertical-align:middle\}|\.ctrend \+ \.cmore\{vertical-align:middle\}/.test(r.text));
  ok('showcase: the gold packages band is gone', !/class="gatepanel"/.test(r.text));
  ok('showcase: "More universities" without a count', /'Show fewer' : 'More ' \+ label;/.test(r.text) && !/' more\)'/.test(r.text));
  ok('showcase: no "showing N of M"', !/'Showing '\+shaped\.length/.test(r.text) && /id="ccount" hidden/.test(r.text));
  ok('showcase: the counsellor button sits to the right', /justify-content:flex-end;margin-top:22px">\s*<a class="btn btn-primary" href="#counsel">Talk to a counsellor/.test(r.text));
  ok('counselling form: three asterisks', (r.text.match(/<span class="req" aria-hidden="true">\*<\/span>/g) || []).length === 3);
  ok('nav: an open menu closes on scroll', /addEventListener\('scroll', \(\) => \$\$\('\.nav-drop\.open'\)/.test(r.text));
  ok('hero: the proof line is inline beside the subtitle', /\.hero-sub\{display:inline-block;/.test(r.text) && /\.hero-rate\{display:inline-flex;/.test(r.text));
  ok('footer: the map box with its Google address', /id="fMap" data-src="https:\/\/www\.google\.com\/maps\?q=Metro\+Pillar\+C1734/.test(r.text));
  ok('footer: the map loads only when the footer is in view', /IntersectionObserver/.test(r.text) && /box\.replaceChildren\(f\)/.test(r.text));
  const csp = r.h.get('content-security-policy') || '';
  ok('CSP lets the Google frame in, and nothing else new', /frame-src https:\/\/\*\.razorpay\.com https:\/\/www\.google\.com https:\/\/maps\.google\.com/.test(csp), csp.slice(0, 120));

  r = await get('/dashboard');
  ok('dashboard: the serial number does not wrap', /\.sl-num\{[^}]*white-space:nowrap/.test(r.text));
  r = await get('/services');
  ok('services: the buttons pin to the foot of the card', /class="sl-go" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:auto;padding-top:12px"/.test(r.text));
  r = await get('/applications');
  ok('applications: five steps on a line', /\.track\{list-style:none;margin:0;padding:6px 0 0;display:grid;grid-template-columns:repeat\(5,1fr\)/.test(r.text));
  ok('  · with a word under each step', /const word = cls === 'done' \? 'Done' : cls === 'now' \? 'In progress' : 'Awaiting';/.test(r.text));
  ok('  · and upright on a phone', /@media\(max-width:720px\)\{\s*\.track\{grid-template-columns:1fr/.test(r.text));
  r = await get('/partner');
  ok('partner: the action cell is a table cell again', /\.pacts\{text-align:right;white-space:nowrap\}/.test(r.text) && !/\.pacts\{display:flex/.test(r.text));

  console.log('round140test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('crashed: ' + (e && e.stack || e)); process.exit(1); });
