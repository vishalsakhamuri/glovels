/**
 * Patch 276: photos made smaller — new ones in the browser, old ones from the
 * Organisation screen's Storage card. PDFs untouched.
 *
 *   node shrinktest.js        (starts its own server on 8276)
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8276, BASE = 'http://localhost:' + PORT;
const ok = [], bad = [];
const check = (n, pass, note) => (pass ? ok : bad).push(n + (note != null && note !== '' ? ' — ' + note : ''));
const wait = ms => new Promise(r => setTimeout(r, ms));
const ping = () => new Promise(r => http.get(BASE + '/api/health', x => { x.resume(); r(x.statusCode); }).on('error', () => r(0)));
const S = Date.now();

/* A big, busy photo (noise does not compress), made by the browser. */
async function bigPhoto(page, type, w, h) {
  return page.evaluate(async ([type, w, h]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    const im = g.createImageData(w, h);
    let x = 12345;
    for (let i = 0; i < im.data.length; i += 4) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      const v = (x >> 16) & 255;
      im.data[i] = v; im.data[i + 1] = (v * 7) & 255; im.data[i + 2] = (v * 13) & 255; im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    g.fillStyle = '#000'; g.font = '120px sans-serif'; g.fillText('PASSPORT 1234567', 100, 300);
    const b = await new Promise(r => c.toBlob(r, type, 0.97));
    const a = new Uint8Array(await b.arrayBuffer());
    let s = ''; for (let i = 0; i < a.length; i += 32768) s += String.fromCharCode.apply(null, a.subarray(i, i + 32768));
    return btoa(s);
  }, [type, w, h]);
}

(async () => {
  const dir = '/tmp/db-shrink-' + PORT;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ['serve.js'], { cwd: ROOT, detached: true, stdio: 'ignore',
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: dir, FX_AUTO: 'off', GEO_AUTO: 'off', GUARD: 'off' }) });
  let b;
  try {
    for (let i = 0; i < 80; i++) { await wait(400); if (await ping() === 200) break; }
    b = await chromium.launch();
    const stu = await b.newContext({ viewport: { width: 1300, height: 900 } });
    const email = 'shrink' + S + '@example.com';
    const su = await stu.request.post(BASE + '/api/auth/signup', { data: { name: 'Shrink Student', email, phone: '+919876500011', password: 'a-real-password-' + S, terms: true } });
    check('a student signs up', su.ok(), su.status());

    const page = await stu.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.goto(BASE + '/documents.html', { waitUntil: 'networkidle' });
    check('the documents page carries the photo shrinker', await page.evaluate(() => !!window.glovelsShrink));

    /* ---- a new photo, through the page */
    const jpg = await bigPhoto(page, 'image/jpeg', 4000, 3000);
    const jpgBytes = Buffer.from(jpg, 'base64').length;
    const sent = await page.evaluate(async (b64) => {
      const bin = atob(b64), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      const fd = new FormData(); fd.append('key', 'passport'); fd.append('file', new File([a], 'passport.jpg', { type: 'image/jpeg' }));
      const r = await fetch('/api/documents', { method: 'POST', credentials: 'same-origin', body: fd });
      return r.status;
    }, jpg);
    check('a ' + (jpgBytes / 1048576).toFixed(1) + ' MB phone photo uploads', sent === 200, sent);
    let st = await (await stu.request.get(BASE + '/api/state')).json();
    let pp = JSON.stringify(st.docs || st).match(/"bytes":(\d+)/g) || [];
    const stored = Math.min.apply(null, pp.map(x => Number(x.split(':')[1])));
    check('…and is stored much smaller', stored > 0 && stored < jpgBytes * 0.6, (stored / 1048576).toFixed(2) + ' MB of ' + (jpgBytes / 1048576).toFixed(2));
    const sid = (await (await stu.request.get(BASE + '/api/auth/me')).json()).user.id;
    const files = fs.readdirSync(path.join(dir, 'uploads', String(sid)));
    const onDisk = files.map(f => fs.readFileSync(path.join(dir, 'uploads', String(sid), f)));
    check('the stored copy is a real JPEG', onDisk.some(x => x[0] === 0xff && x[1] === 0xd8 && x.length < jpgBytes * 0.6));
    const dims = await page.evaluate(async () => {
      const r = await fetch('/api/state', { credentials: 'same-origin' }); const d = await r.json();
      return d;
    });
    void dims;

    /* ---- a small photo and a PDF go as they are */
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(900 * 1024, 0x41)]);
    const pdfOk = await page.evaluate(async (n) => {
      const a = new Uint8Array(n); const h = '%PDF-1.4\n'; for (let i = 0; i < h.length; i++) a[i] = h.charCodeAt(i); a.fill(0x41, h.length);
      const fd = new FormData(); fd.append('key', 'cv'); fd.append('file', new File([a], 'cv.pdf', { type: 'application/pdf' }));
      return (await fetch('/api/documents', { method: 'POST', credentials: 'same-origin', body: fd })).status;
    }, pdf.length);
    check('a PDF uploads', pdfOk === 200, pdfOk);
    const pdfOnDisk = fs.readdirSync(path.join(dir, 'uploads', String(sid))).map(f => fs.statSync(path.join(dir, 'uploads', String(sid), f)).size);
    check('…untouched, to the byte', pdfOnDisk.includes(pdf.length), pdfOnDisk.join(','));

    /* ---- an old photo, from before patch 276 (sent without a browser) */
    const png = Buffer.from(await bigPhoto(page, 'image/png', 2600, 2000), 'base64');
    const old = await stu.request.post(BASE + '/api/documents', { multipart: { key: 'photo', file: { name: 'photo.png', mimeType: 'image/png', buffer: png } } });
    check('an old ' + (png.length / 1048576).toFixed(1) + ' MB PNG is on the disk', old.ok(), old.status());

    /* ---- the Storage card */
    const adm = await b.newContext({ viewport: { width: 1400, height: 950 } });
    const ap = await adm.newPage();
    ap.on('pageerror', e => errs.push('admin: ' + e));
    await ap.goto(BASE + '/login'); await ap.fill('#lEmail', 'admin@glovels.com'); await ap.fill('#lPass', 'glovels123'); await ap.click('#submit-btn'); await ap.waitForTimeout(1500);
    const rep = await (await adm.request.get(BASE + '/api/staff/storage')).json();
    check('the storage report counts the files', rep.files >= 3 && rep.bigCount >= 1, JSON.stringify({ files: rep.files, big: rep.bigCount, bytes: rep.bytes }));
    check('…and a student cannot read it', (await stu.request.get(BASE + '/api/staff/storage')).status() === 403);
    await ap.goto(BASE + '/admin#settings', { waitUntil: 'networkidle' });
    await ap.evaluate(() => { if (typeof showTab === 'function') showTab('settings'); });
    await ap.evaluate(() => { const c = document.querySelector('#stCard'); if (c) c.scrollIntoView(); });
    await ap.waitForTimeout(1500);
    const says = await ap.$eval('#stSays', e => e.textContent).catch(() => '');
    check('the Organisation screen shows the storage', /uploaded files/.test(says) && /can be made smaller/.test(says), says);
    ap.on('dialog', d => d.accept());
    await ap.click('#stGo');
    await ap.waitForFunction(() => /saved/.test((document.querySelector('#stProg') || {}).textContent || '') && !/Reading/.test(document.querySelector('#stSays').textContent), null, { timeout: 60000 }).catch(() => {});
    await ap.waitForTimeout(2000);
    const prog = await ap.$eval('#stProg', e => e.textContent).catch(() => '');
    check('"Make old photos smaller" runs', /made smaller/.test(prog), prog);
    const rep2 = await (await adm.request.get(BASE + '/api/staff/storage')).json();
    check('afterwards nothing is left to make smaller', rep2.bigCount === 0, rep2.bigCount);
    check('a photo already made smaller is not offered again', rep.bigCount === 1, rep.bigCount);
    check('and the uploads take less space', rep2.bytes < rep.bytes - png.length / 2, (rep.bytes / 1048576).toFixed(1) + ' → ' + (rep2.bytes / 1048576).toFixed(1) + ' MB');
    const left = fs.readdirSync(path.join(dir, 'uploads', String(sid)));
    check('the old PNG file is gone from the disk', !left.some(f => /\.png$/i.test(f)), left.join(','));
    const sizes = left.map(f => fs.statSync(path.join(dir, 'uploads', String(sid), f)).size).reduce((a, x) => a + x, 0);
    check('the disk agrees with the report', Math.abs(sizes - rep2.bytes) < 64 * 1024, sizes + ' vs ' + rep2.bytes);

    /* ---- the student still opens the photo */
    st = await (await stu.request.get(BASE + '/api/state')).json();
    const txt = JSON.stringify(st);
    check('the student\'s file is now named .jpg', /photo\.jpg/.test(txt));
    const id = (txt.match(/"id":(\d+),"file":"photo\.jpg"/) || [])[1];
    if (id) {
      const f = await stu.request.get(BASE + '/api/documents/file/' + id);
      const body = await f.body();
      check('and downloads as a JPEG', f.ok() && body[0] === 0xff && body[1] === 0xd8, f.status() + ' ' + body.length);
    } else check('and downloads as a JPEG', false, 'no id in the state');
    check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  } catch (e) {
    bad.push('the suite threw: ' + (e && e.stack || e));
  } finally {
    if (b) await b.close().catch(() => {});
    try { process.kill(-child.pid); } catch (e) {}
  }
  ok.forEach(t => console.log('  ok   ' + t));
  bad.forEach(t => console.log('  FAIL ' + t));
  console.log(ok.length + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})();
