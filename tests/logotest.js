/**
 * Patch 292: the handed-over Glovels logo, everywhere, at its own shape.
 *
 * Owner, 24 Nov: "please use this logo in glovels.com and the login screen.
 * The logo in the login screen also looks distorted."
 *
 * Reads the delivered pages and boots its own server. Checks: every page that
 * carries the mark carries the same vector artwork as assets/glovels-logo.svg
 * and none still embeds the old picture; the artwork is the handover's colours
 * and is cropped to the drawing; the picture file used by emails and the
 * office screens is that artwork too, and is asked for at its own proportions;
 * and on the login screen the mark is on a white plate, undistorted, on a
 * phone as well.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = '/home/claude/glovels/build';
const PORT = 8294;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note ? ' — ' + note : ''));
const get = p => new Promise(resolve => { const req = http.get({ host: 'localhost', port: PORT, path: p }, res => { const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body: Buffer.concat(ch) })); }); req.on('error', () => resolve({ status: 0, type: '', body: Buffer.alloc(0) })); });

(async () => {
  /* ---- the files ---- */
  const svg = fs.readFileSync(path.join(ROOT, 'assets/glovels-logo.svg'), 'utf8').trim();
  const b64 = Buffer.from(svg, 'utf8').toString('base64');
  check('the artwork is the handover\'s navy and green', svg.includes('#164282') && svg.includes('#AFCA05'));
  const vb = (/viewBox="([\d. ]+)"/.exec(svg) || [])[1] || '';
  const [, , vw, vh] = vb.split(' ').map(Number);
  check('cropped to the drawing, not the 360 × 360 artboard', vw > 300 && vw < 345 && vh > 125 && vh < 145, vb);
  const ratio = vw / vh;
  const pages = fs.readdirSync(ROOT).filter(f => /\.html$/.test(f));
  const withMark = pages.filter(f => fs.readFileSync(path.join(ROOT, f), 'utf8').includes('--logo-src'));
  check('the mark is on the pages it was on', withMark.length >= 60, String(withMark.length));
  const wrong = withMark.filter(f => !fs.readFileSync(path.join(ROOT, f), 'utf8').includes('--logo-src:url("data:image/svg+xml;base64,' + b64 + '")'));
  check('every one of them carries this artwork', wrong.length === 0, wrong.slice(0, 6).join(', '));
  const old = pages.filter(f => /--logo-src:url\("data:image\/png/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  check('none still embeds the old picture', old.length === 0, old.slice(0, 6).join(', '));
  const png = fs.readFileSync(path.join(ROOT, 'assets/glovels-logo.png'));
  const pw = png.readUInt32BE(16), ph = png.readUInt32BE(20);
  check('the picture file is the same artwork at the same shape', Math.abs(pw / ph - ratio) < 0.02 && pw >= 600, pw + ' × ' + ph);
  const imgs = [];
  pages.forEach(f => { const m = fs.readFileSync(path.join(ROOT, f), 'utf8').match(/<img[^>]*glovels-logo\.png[^>]*width="(\d+)" height="(\d+)"/g) || []; m.forEach(t => { const x = /width="(\d+)" height="(\d+)"/.exec(t); imgs.push([f, +x[1] / +x[2]]); }); });
  check('office screens ask for it at its own proportions', imgs.length >= 4 && imgs.every(x => Math.abs(x[1] - ratio) < 0.06), JSON.stringify(imgs.map(x => x[0] + ':' + x[1].toFixed(2))));
  const mail = fs.readFileSync(path.join(ROOT, 'server/emails.js'), 'utf8');
  const mm = /glovels-logo\.png'\)\}"[^>]*width="(\d+)" height="(\d+)" style="[^"]*width:(\d+)px;height:(\d+)px/.exec(mail) || [];
  check('and so do the emails', mm.length === 5 && Math.abs(mm[1] / mm[2] - ratio) < 0.06 && mm[1] === mm[3] && mm[2] === mm[4], mm.slice(1).join(' '));

  /* ---- drawn ---- */
  const dir = '/tmp/db-logo-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off' }) });
  const br = await chromium.launch();
  try {
    for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 400)); if ((await get('/api/health')).status === 200) break; }
    const s = await get('/assets/glovels-logo.svg'), g = await get('/assets/glovels-logo.png');
    check('the server hands out both files', s.status === 200 && /svg/.test(s.type) && g.status === 200 && /png/.test(g.type), s.status + ' ' + s.type + ' / ' + g.status + ' ' + g.type);
    const look = async (ctx, url) => { const p = await ctx.newPage(); await p.goto('http://localhost:' + PORT + url); await p.waitForTimeout(1200);
      const out = await p.evaluate(() => [...document.querySelectorAll('.logo-img')].filter(e => e.getBoundingClientRect().width > 2).map(el => {
        const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        let e = el, ground = [255, 255, 255]; while (e) { const m = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(getComputedStyle(e).backgroundColor); if (m && (m[4] === undefined || Number(m[4]) > 0.5)) { ground = [+m[1], +m[2], +m[3]]; break; } e = e.parentElement; }
        return { w: r.width, h: r.height, vector: cs.backgroundImage.includes('svg+xml'), size: cs.backgroundSize, lum: Math.round(0.299 * ground[0] + 0.587 * ground[1] + 0.114 * ground[2]) }; }));
      await p.close(); return out; };
    const desk = await br.newContext({ viewport: { width: 1280, height: 800 } });
    const L = await look(desk, '/login');
    check('the login screen shows the mark', L.length === 1 && L[0].vector, JSON.stringify(L));
    check('on a white plate, not straight on the dark panel', L[0] && L[0].lum > 240, String(L[0] && L[0].lum));
    check('at the artwork\'s own shape, so nothing is stretched', L[0] && Math.abs(L[0].w / L[0].h - ratio) < 0.03 && L[0].size === 'contain', L[0] && (L[0].w + ' × ' + L[0].h));
    check('and large enough to read', L[0] && L[0].w >= 140);
    const phone = await br.newContext({ viewport: { width: 390, height: 800 } });
    const M = await look(phone, '/login');
    check('on a phone too', M.length === 1 && M[0].vector && M[0].lum > 200 && Math.abs(M[0].w / M[0].h - ratio) < 0.03, JSON.stringify(M));
    for (const u of ['/', '/study-in-germany', '/blog', '/contact-us']) {
      const H = await look(desk, u);
      check(u + ' shows the new mark, on a light ground, never cropped', H.length >= 1 && H.every(x => x.vector && x.size === 'contain' && x.lum > 200), JSON.stringify(H.map(x => [Math.round(x.w), Math.round(x.h), x.lum])));
    }
    const pg = await desk.newPage();
    await pg.request.post('http://localhost:' + PORT + '/api/auth/login', { data: { email: 'admin@glovels.com', password: 'glovels123' } });
    await pg.goto('http://localhost:' + PORT + '/ops'); await pg.waitForTimeout(1200);
    const im = await pg.$eval('img[src*="glovels-logo"]', e => ({ w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height, nat: e.naturalWidth / e.naturalHeight }));
    check('the command centre draws the picture unstretched', Math.abs(im.w / im.h - im.nat) < 0.05, JSON.stringify(im));
  } catch (e) {
    bad.push('the suite ran to the end — ' + (e && e.stack || e));
  } finally {
    try { await br.close(); } catch (e) {}
    try { process.kill(-child.pid); } catch (e) {}
  }
  ok.forEach(n => console.log('  ✓ ' + n));
  bad.forEach(n => console.log('  ✗ ' + n));
  console.log('\nlogotest: ' + ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
