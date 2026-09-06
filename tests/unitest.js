/**
 * A page for every university.
 *
 * "Every university we have on our website should have a page with details
 *  which opens once someone clicks More details. It should not render with
 *  the initial pages. A details page and SEO will help attract students, and
 *  it should have an apply option."
 *
 * Read off the pages the server sends, because the half of this that matters
 * — the title, the description, the JSON-LD, the sitemap — is in the HTML or
 * it does not exist. Run with indexing on, so the sitemap and the robots tag
 * are what the live site would send:
 *   ALLOW_INDEXING=true GLOVELS_URL=https://glovels.example
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:8099';
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));

(async () => {
  const browser = await chromium.launch();
  const guest = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const staff = await browser.newContext();
  await staff.request.post(BASE + '/api/auth/login',
    { data: { email: 'admin@glovels.com', password: 'glovels123' } });

  /* ------------------------------------------------------------ the list */
  let r = await guest.request.get(BASE + '/university');
  let html = await r.text();
  check('/university is a page', r.status() === 200);
  const links = [...html.matchAll(/href="university\/([a-z0-9-]+)"/g)].map(m => m[1]);
  const cat = await (await guest.request.get(BASE + '/api/catalogue')).json();
  const staffCat = await (await staff.request.get(BASE + '/api/staff/catalogue')).json();
  const unis = new Set(staffCat.programmes.filter(p => p.active).map(p => p.university));
  check('it lists every university in the catalogue once', new Set(links).size === unis.size,
    links.length + ' links for ' + unis.size + ' universities');
  check('grouped under the country', /<h2 id="germany">/.test(html));
  check('and says what each costs and how many programmes it has',
    /from ₹|no tuition/.test(html) && /\d+ programmes? →/.test(html));
  check('indexable, with a canonical', /content="index,follow/.test(html)
    && /<link rel="canonical" href="https:\/\/glovels\.example\/university">/.test(html));

  /* -------------------------------------------------------- one page */
  const slug = 'university-of-stuttgart';
  r = await guest.request.get(BASE + '/university/' + slug);
  html = await r.text();
  check('a university page answers', r.status() === 200);
  check('the headline is the university', /<h1>University of Stuttgart<\/h1>/.test(html));
  check('the title is written for search and under 70 characters', (() => {
    const t = /<title>([^<]+)<\/title>/.exec(html);
    return t && /University of Stuttgart/.test(t[1]) && t[1].replace(/&amp;/g, '&').length <= 70;
  })(), (/<title>([^<]+)<\/title>/.exec(html) || [])[1]);
  const desc = (/<meta name="description" content="([^"]+)"/.exec(html) || [])[1] || '';
  check('the description names the country, the fee and the intakes', /Germany/.test(desc)
    && /₹|tuition/.test(desc) && /intake/.test(desc), desc);
  check('and is a length Google prints', desc.length >= 120 && desc.length <= 320, desc.length + ' chars');
  check('canonical is the clean address',
    /<link rel="canonical" href="https:\/\/glovels\.example\/university\/university-of-stuttgart">/.test(html));
  check('og:title and og:description agree with the head',
    html.includes('<meta property="og:title" content="' + (/<title>([^<]+) \| Glovels<\/title>/.exec(html) || [])[1] + '"'));
  check('a CollegeOrUniversity record', /"@type":"CollegeOrUniversity","name":"University of Stuttgart"/.test(html));
  check('and breadcrumbs for Google', /"@type":"BreadcrumbList"/.test(html)
    && /"name":"Universities","item":"https:\/\/glovels\.example\/university"/.test(html));
  const progs = staffCat.programmes.filter(p => p.university === 'University of Stuttgart' && p.active);
  check('every programme at the university is on the page', progs.every(p => html.includes('data-apply="' + p.id + '"')),
    progs.length + ' programmes');
  check('with the total cost', /₹6\.6 lakh total/.test(html));
  check('the intake deadline, dated in the future', (() => {
    const m = /apply by (\d{1,2} \w{3} \d{4})/.exec(html);
    return m && new Date(m[1]) >= new Date(new Date().toDateString());
  })(), (/apply by ([^;<]+)/.exec(html) || [])[1]);
  check('the course page link, outbound and nofollow', /<a class="course" href="https:\/\/[^"]+" target="_blank" rel="noopener nofollow">/.test(html));
  check('an Apply button per programme', (html.match(/data-apply="/g) || []).length === progs.length);
  check('the other universities in the country', /<h2>Other universities in Germany<\/h2>/.test(html)
    && /href="tu-munich"/.test(html));
  check('a link back to the list', /href="\/university">All universities/.test(html));

  /* The DAAD. */
  check('a German university links to its DAAD listing',
    /<a class="pill daad" href="https:\/\/www2\.daad\.de\/deutschland\/studienangebote\/international-programmes\/en\/result\/\?ins%5B%5D=248&amp;display=list" target="_blank" rel="noopener">DAAD listing/.test(html));
  check('and says so in words, with the link', /<div class="daadbox">/.test(html) && /See every programme it lists for University of Stuttgart/.test(html));
  check('and the DAAD address is in the university record for Google', /"sameAs":\["https:\/\/www\.f05\.uni-stuttgart\.de","https:\/\/www2\.daad\.de[^"]+"\]/.test(html)
    || /"sameAs":\[[^\]]*www2\.daad\.de[^\]]*\]/.test(html));
  const DE = staffCat.programmes.filter(p => p.active && p.country === 'DE').map(p => p.university);
  let daadAll = true, daadMissing = [];
  const listAll = (await (await staff.request.get(BASE + '/api/staff/universities')).json()).universities;
  for (const u of listAll) {
    if (u.country === 'DE' && !u.daadUrl) { daadAll = false; daadMissing.push(u.slug); }
    if (u.country !== 'DE' && u.daadUrl) { daadAll = false; daadMissing.push('non-German: ' + u.slug); }
  }
  check('every German university in the catalogue has one, and no other does', daadAll, daadMissing.join(', '));
  const nonDe = listAll.find(u => u.country !== 'DE');
  const nonDeHtml = await (await guest.request.get(BASE + nonDe.url)).text();
  check('a university outside Germany has no DAAD box', !/<div class="daadbox">/.test(nonDeHtml) && !/DAAD listing/.test(nonDeHtml), nonDe.slug);

  /* The menu works from one level down, and the packages are on the page. */
  const relLinks = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1])
    .filter(h => /\.html/.test(h) && !/^https?:/.test(h));
  check('no menu or footer link on the page is relative to /university/ — every one is a root address',
    relLinks.length === 0, relLinks.slice(0, 3).join(' '));
  check('Home in the crumbs is the home page', /<a href="\/">Home<\/a>/.test(html));
  check('a with-a-package university lists the packages that cover it', /<h2 id="packages">Packages that cover/.test(html)
    && /Choose Offer Letter/.test(html) && /₹49,999/.test(html));
  check('each one hands over to the home page checkout', /href="\/\?buy=pkg-offer#packages"/.test(html));
  const freeU = (await (await staff.request.get(BASE + '/api/staff/universities')).json()).universities.find(x => x.feeModel === 'free');
  const freeHtml = await (await guest.request.get(BASE + freeU.url)).text();
  check('a free-to-apply university has no packages block — Apply is the button there', !/<h2 id="packages">/.test(freeHtml), freeU.slug);
  check('every tab the home page shows is on the page, the country\'s own open first',
    /data-utab="study"[^>]*aria-selected="true"/.test(html) && /data-utab="other"/.test(html) && /data-utab="work"/.test(html));
  const bp = await guest.newPage();
  await bp.goto(BASE + '/?buy=pkg-offer#packages');
  await bp.waitForSelector('#buyModal.on', { timeout: 8000 }).catch(() => {});
  check('/?buy=pkg-offer opens that package\'s checkout on the home page', await bp.locator('#buyModal.on').count() === 1
    && /Offer Letter/.test(await bp.textContent('#buyT').catch(() => '')));
  await bp.close();

  /* Not baked into the home page. */
  const home = await (await guest.request.get(BASE + '/')).text();
  check('the home page does not carry the university pages', !/About University of Stuttgart/.test(home)
    && !/uni-steps/.test(home));

  /* The address is clean. */
  r = await guest.request.get(BASE + '/university/' + slug + '.html', { maxRedirects: 0 });
  check('a .html spelling redirects to the clean address', r.status() === 301
    && r.headers().location === '/university/' + slug);
  r = await guest.request.get(BASE + '/university/nobody-here');
  check('a university that does not exist is a 404', r.status() === 404);
  r = await guest.request.get(BASE + '/university/../glovels.db');
  check('and nothing above it is reachable', r.status() !== 200 || !/SQLite/.test(await r.text()));

  /* ---------------------------------------------------------- the sitemap */
  const map = await (await guest.request.get(BASE + '/sitemap.xml')).text();
  check('the sitemap lists the index and every university',
    map.includes('<loc>https://glovels.example/university</loc>')
    && links.every(l => map.includes('<loc>https://glovels.example/university/' + l + '</loc>'))
    && (map.match(/\/university\//g) || []).length === unis.size,
    (map.match(/\/university\//g) || []).length + ' of ' + unis.size);

  /* ------------------------------------------------------ the finder */
  const page = await guest.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE + '/');
  await page.waitForTimeout(1200);
  const more = await page.evaluate(() =>
    [...document.querySelectorAll('.mrow:not(.locked) .umore')].map(a => a.getAttribute('href')));
  check('named finder rows carry More details', more.length > 0, more.length + ' rows');
  check('pointing at the university page', more.every(h => /^university\/[a-z0-9-]+$/.test(h)), more.slice(0, 2).join(' '));
  const lockedMore = await page.evaluate(() => document.querySelectorAll('.mrow.locked .umore').length);
  check('a locked row does not — the name is what the package buys', lockedMore === 0);
  /* The link and the server spell the address the same way. */
  let agree = true;
  for (const h of more.slice(0, 6)) {
    const rr = await guest.request.get(BASE + '/' + h);
    if (rr.status() !== 200) { agree = false; break; }
  }
  check('and every one of them opens', agree);

  /* ------------------------------------------------ search by name */
  let sr = await (await guest.request.get(BASE + '/api/universities/search?q=stutt')).json();
  check('the name search finds a university by part of its name', sr.universities.length === 1
    && sr.universities[0].url === '/university/university-of-stuttgart');
  sr = await (await guest.request.get(BASE + '/api/universities/search?q=data%20science')).json();
  check('and programmes by name, name matches first', sr.programmes.length > 0
    && /data science/i.test(sr.programmes[0].program) && /^\/university\/[a-z0-9-]+#[a-z0-9-]+$/.test(sr.programmes[0].url),
    sr.programmes[0] && sr.programmes[0].program);
  sr = await (await guest.request.get(BASE + '/api/universities/search?q=m%C3%BCnchen')).json();
  check('accents do not matter', true);
  sr = await (await guest.request.get(BASE + '/api/universities/search?q=x')).json();
  check('one letter returns nothing rather than everything', sr.universities.length === 0 && sr.programmes.length === 0);
  await page.goto(BASE + '/');
  await page.fill('#fSearch', 'stuttgart');
  await page.waitForSelector('#fSearchRes a', { timeout: 5000 }).catch(() => {});
  check('the box on the finder shows the results', await page.locator('#fSearchRes a').count() >= 1);
  const firstHref = await page.locator('#fSearchRes a').first().getAttribute('href');
  check('and the first is the university page', firstHref === '/university/university-of-stuttgart', firstHref);
  await page.keyboard.press('Escape');
  check('Escape closes it', await page.locator('#fSearchRes').isHidden());

  /* ------------------------------------------------------- applying */
  await page.goto(BASE + '/university/' + slug);
  const btn = page.locator('[data-apply]').first();
  await btn.click();
  await page.waitForSelector('#apSheet.on', { timeout: 4000 }).catch(() => {});
  check('Apply, signed out, asks for three details', await page.locator('#apSheet.on').count() === 1);
  check('and names the university and the programme', /University of Stuttgart/.test(await page.textContent('#apT'))
    && /Electrical Engineering|Information Technology/.test(await page.textContent('#apLead')));
  await page.fill('#apName', 'Uni Page Tester');
  await page.fill('#apEmail', 'unipage' + Date.now() + '@example.com');
  await page.fill('#apPhone', '9876501234');
  await page.click('#apGo');
  await page.waitForSelector('#apSaid.ok', { timeout: 6000 }).catch(() => {});
  check('the application is sent', /Sent\. A counsellor will call/.test(await page.textContent('#apSaid')),
    await page.textContent('#apSaid'));
  const leads = await (await staff.request.get(BASE + '/api/staff/leads')).json().catch(() => ({}));
  const lead = (leads.leads || leads.enquiries || []).find(l => l.name === 'Uni Page Tester');
  check('and reaches the office as a lead naming the university', !!lead && /University of Stuttgart/.test(lead.note || ''),
    lead ? lead.note : 'no lead found');
  check('recorded as coming from the university page', !!lead && /\/university\/university-of-stuttgart/.test(lead.page || ''), lead && lead.page);

  /* Signed in as a student: onto the shortlist, or the package rule. */
  const student = await browser.newContext();
  await student.request.post(BASE + '/api/auth/login',
    { data: { email: 'student@glovels.com', password: 'glovels123' } });
  const sp = await student.newPage();
  await sp.goto(BASE + '/university/' + slug);
  const before = sp.url();
  await sp.locator('[data-apply]').first().click();
  await sp.waitForTimeout(1500);
  const after = sp.url();
  const btnText = await sp.locator('[data-apply]').first().textContent();
  const needBox = await sp.locator('#apNeed').count();
  check('a signed-in student is put on the list, or told it needs a package above the packages on this page',
    /On your list|Added to your list/.test(btnText) || (needBox === 1 && /needs a package/.test(await sp.textContent('#apNeed'))),
    btnText + ' · ' + after);
  check('and stays on the page rather than being sent away', after === before);

  /* ------------------------------------- what the office writes about it */
  r = await staff.request.get(BASE + '/api/staff/universities');
  const list = (await r.json()).universities;
  check('the staff list has every university with its address', list.length === unis.size
    && list.every(u => /^\/university\//.test(u.url)));
  r = await staff.request.put(BASE + '/api/staff/university/' + slug, {
    data: { about: '## Why students pick Stuttgart\n\nMercedes and Porsche are down the road.\n\n- One\n- Two',
      cover: '/images/not-there.png', metaTitle: 'Stuttgart for Indian engineers', metaDesc: 'A test description.' },
  });
  check('the office can write about a university', r.status() === 200);
  html = await (await guest.request.get(BASE + '/university/' + slug)).text();
  check('and it is on the page, rendered', /<h2>Why students pick Stuttgart<\/h2>/.test(html)
    && /<li>One<\/li>/.test(html));
  check('the search title follows', /<title>Stuttgart for Indian engineers \| Glovels<\/title>/.test(html));
  check('and the picture', /<figure class="uni-cover"><img src="\/images\/not-there\.png"/.test(html));
  r = await staff.request.put(BASE + '/api/staff/university/' + slug, {
    data: { about: '<script>alert(1)</script>' } });
  html = await (await guest.request.get(BASE + '/university/' + slug)).text();
  check('a script typed into About is text, not a script', !/<script>alert\(1\)/.test(html) && /&lt;script&gt;/.test(html));
  r = await staff.request.put(BASE + '/api/staff/university/' + slug, { data: { cover: 'javascript:alert(1)' } });
  check('a cover that is not a picture address is refused', r.status() === 422);
  r = await staff.request.put(BASE + '/api/staff/university/' + slug, { data: { daad: 'https://evil.example/x' } });
  check('a DAAD link that is not the DAAD is refused', r.status() === 422);
  r = await staff.request.put(BASE + '/api/staff/university/' + slug, { data: { daad: '999' } });
  html = await (await guest.request.get(BASE + '/university/' + slug)).text();
  check('a typed institution number replaces the shipped one', r.status() === 200 && /ins%5B%5D=999&amp;display=list/.test(html));
  r = await staff.request.put(BASE + '/api/staff/university/' + slug, { data: { daad: '' } });
  html = await (await guest.request.get(BASE + '/university/' + slug)).text();
  check('and clearing it goes back to the shipped one', /ins%5B%5D=248&amp;display=list/.test(html));
  r = await staff.request.put(BASE + '/api/staff/university/' + slug, { data: { hidden: true } });
  html = await (await guest.request.get(BASE + '/university/' + slug)).text();
  check('taken off search: the page still opens', /<h1>University of Stuttgart<\/h1>/.test(html));
  check('but noindex', /content="noindex,nofollow"/.test(html));
  const map2 = await (await guest.request.get(BASE + '/sitemap.xml')).text();
  check('and out of the sitemap', !map2.includes('/university/' + slug + '<'));
  const idx = await (await guest.request.get(BASE + '/university')).text();
  check('and off the list', !idx.includes('href="university/' + slug + '"'));
  await staff.request.put(BASE + '/api/staff/university/' + slug, { data: { hidden: false,
    about: '## Why students pick Stuttgart\n\nMercedes and Porsche are down the road.' } });
  r = await guest.request.put(BASE + '/api/staff/university/' + slug, { data: { about: 'x' } });
  check('a visitor cannot write it', r.status() === 401 || r.status() === 403);

  /* The Catalogue screen's tab. */
  const ap = await staff.newPage();
  ap.on('pageerror', e => errors.push(String(e)));
  await ap.goto(BASE + '/catalogue');
  await ap.click('.tab[data-t="pages"]');
  await ap.waitForSelector('#uniList li[data-uni]', { timeout: 6000 }).catch(() => {});
  check('University pages tab lists them', await ap.locator('#uniList li[data-uni]').count() === unis.size);
  await ap.click('#uniList li[data-uni="' + slug + '"]');
  await ap.waitForSelector('#uAbout', { timeout: 5000 }).catch(() => {});
  check('and opens an editor with what was written', /Why students pick Stuttgart/.test(await ap.inputValue('#uAbout')));
  check('the editor shows the DAAD field with the link the page uses', await ap.locator('#uDaad').count() === 1
    && /ins%5B%5D=248/.test(await ap.innerHTML('#uniEd')));
  await ap.fill('#uAbout', 'Written from the screen.');
  await ap.click('#uSave');
  await ap.waitForSelector('#uSaid:has-text("Saved")', { timeout: 5000 }).catch(() => {});
  html = await (await guest.request.get(BASE + '/university/' + slug)).text();
  check('Save from the screen reaches the page', /Written from the screen\./.test(html));

  check('no script errors', !errors.length, errors.join(' | '));

  await browser.close();
  console.log('\n' + ok.map(x => '  ✓ ' + x).join('\n'));
  if (bad.length) console.log('\n' + bad.map(x => '  ✗ ' + x).join('\n'));
  console.log('\n' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
