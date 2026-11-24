/**
 * Patch 288: "1 document to check" says which, and the file opens on it.
 *
 * Owner, 24 Nov: "when I click open file I don't see one doc to check."
 * The document was there — sixth of twelve, in upload order, "In review".
 *
 * Boots its own server (the demo student has documents in review) and checks:
 * the board's row names the documents; its link carries the document; the
 * file opens on Their file with that document outlined; the documents in
 * review are listed first; and a strip names them with a button to each.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const ROOT = '/home/claude/glovels/build';
const PORT = 8288;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const call = (path, opts) => new Promise(resolve => {
  const req = http.request({ host: 'localhost', port: PORT, path, method: (opts && opts.method) || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, (opts && opts.headers) || {}) }, res => {
    let out = ''; res.on('data', c => { out += c; }); res.on('end', () => {
      let j = null; try { j = JSON.parse(out || '{}'); } catch (e) { j = { raw: out }; }
      resolve({ status: res.statusCode, body: j, headers: res.headers });
    });
  });
  req.on('error', () => resolve({ status: 0, body: {}, headers: {} }));
  if (opts && opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
  req.end();
});
const login = async (email) => {
  const r = await call('/api/auth/login', { method: 'POST', body: { email, password: 'glovels123' } });
  return String((r.headers['set-cookie'] || [])[0] || '').split(';')[0];
};

(async () => {
  const dir = '/tmp/db-doccheck-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off' }) });
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); if ((await call('/api/health')).status === 200) break; }
    const admin = await login('admin@glovels.com');
    const H = { Cookie: admin };
    const c = (await call('/api/staff/command', { headers: H })).body;
    const row = (c.queues.find(q => q.key === 'docs') || { rows: [] }).rows[0];
    check('the demo student has documents to check on the board', !!row && row.count >= 1, JSON.stringify(row).slice(0, 140));
    const sid = row.studentId;
    const file = (await call('/api/staff/student/' + sid, { headers: H })).body;
    const waitKeys = [...new Set(file.docs.filter(d => (d.slot || d.status) === 'wait').map(d => d.key))];
    check('the file agrees: the same number of files in review', file.docs.filter(d => d.status === 'wait').length === row.count,
      file.docs.filter(d => d.status === 'wait').length + ' vs ' + row.count);
    check('the row names the documents, not only a count', /documents? to check: \S/.test(row.what), row.what);
    check('and carries the first one for the link', waitKeys.includes(row.docKey), row.docKey + ' in ' + waitKeys.join(','));

    const br = await chromium.launch();
    const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addCookies([{ name: admin.split('=')[0], value: admin.split('=').slice(1).join('='), url: 'http://localhost:' + PORT }]);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errs.push(m.text()); });
    await p.goto('http://localhost:' + PORT + '/ops'); await p.waitForTimeout(1500);
    await p.click('[data-q="docs"]'); await p.waitForTimeout(500);
    const link = await p.$('#dList a.go');
    const href = link ? await link.getAttribute('href') : '';
    check('the board link says "Open the document" and points at it', /Open the document/.test(await link.textContent())
      && href.includes('student=' + sid) && href.includes('doc=' + row.docKey), href);

    await p.goto('http://localhost:' + PORT + '/' + href); await p.waitForTimeout(3000);
    check('the link opens Their file, not the conversation', (await p.getAttribute('.tab[data-t="file"]', 'aria-selected')) === 'true');
    const marked = await p.$eval('#docs .docgroup[data-dockey="' + row.docKey + '"]', el => ({ shadow: el.style.boxShadow, top: el.getBoundingClientRect().top, h: innerHeight }));
    check('with that document outlined', /rgb|#1a4fb4/.test(marked.shadow), JSON.stringify(marked));
    check('and scrolled into view', marked.top > -50 && marked.top < marked.h, JSON.stringify(marked));
    const order = await p.$$eval('#docs .docgroup', a => a.map(li => (li.querySelector('.st') || {}).textContent || ''));
    const firstDone = order.findIndex(t => /Accepted/.test(t));
    check('documents in review are listed before the accepted ones', order.length > 0 && /In review/.test(order[0])
      && (firstDone < 0 || order.slice(firstDone).every(t => !/In review/.test(t))), order.join(' | '));
    const strip = (await p.$('.doccheck')) ? await p.textContent('.doccheck') : '';
    check('a strip says how many are waiting to be checked, by name', new RegExp(waitKeys.length + ' documents? (is|are) waiting to be checked').test(strip)
      && (await p.$$('.doccheck [data-show-doc]')).length === waitKeys.length, strip.slice(0, 200));
    /* from the conversation tab, the strip's button goes to the document */
    await p.click('.tab[data-t="chat"]'); await p.waitForTimeout(300);
    const last = waitKeys[waitKeys.length - 1];
    await p.click('.doccheck [data-show-doc="' + last + '"]'); await p.waitForTimeout(900);
    check('the strip\'s button opens Their file on that document', (await p.getAttribute('.tab[data-t="file"]', 'aria-selected')) === 'true'
      && /rgb|#1a4fb4/.test(await p.$eval('#docs .docgroup[data-dockey="' + last + '"]', el => el.style.boxShadow)));
    await p.screenshot({ path: '/tmp/doccheck.png' });
    /* "Open file" on any other row lands on Their file too */
    await p.goto('http://localhost:' + PORT + '/ops'); await p.waitForTimeout(1500);
    const stop = await p.$('.stop.has'); if (stop) { await stop.click(); await p.waitForTimeout(500); }
    const h2 = stop ? await (await p.$('#dList a.go')).getAttribute('href') : '';
    check('"Open file" on another row asks for Their file', /tab=file/.test(h2), h2);
    await p.goto('http://localhost:' + PORT + '/' + h2); await p.waitForTimeout(3000);
    check('and the file opens there, not on the conversation', (await p.getAttribute('.tab[data-t="file"]', 'aria-selected')) === 'true');
    check('with what is waiting at the top of the page, above the tabs',
      await p.evaluate(() => { const a = document.querySelector('.doccheck'), b = document.querySelector('.tabs'); return !!a && !!b && a.getBoundingClientRect().top < b.getBoundingClientRect().top; }));
    /* a file with nothing in review has no strip */
    for (const k of waitKeys) await call('/api/staff/student/' + sid + '/document/' + k, { method: 'POST', headers: H, body: { status: 'rescan' } });
    await p.goto('http://localhost:' + PORT + '/counsellor.html?student=' + sid); await p.waitForTimeout(2500);
    check('with nothing in review there is no such strip', !(await p.$('.doccheck')));
    const c2 = (await call('/api/staff/command', { headers: H })).body;
    check('and the board no longer lists the student under Documents to check',
      !(c2.queues.find(q => q.key === 'docs').rows || []).some(r => Number(r.studentId) === Number(sid)));
    check('the pages have no script errors', errs.length === 0, errs.join(' | '));
    await br.close();
  } catch (e) {
    bad.push('the suite ran to the end — ' + (e && e.stack || e));
  } finally {
    try { process.kill(-child.pid); } catch (e) {}
  }
  ok.forEach(n => console.log('  ✓ ' + n));
  bad.forEach(n => console.log('  ✗ ' + n));
  console.log('\ndoccheckshowtest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
