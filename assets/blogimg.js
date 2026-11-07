/*
 * Patch 283 (team checklist, items 6 and 11): blog pictures made fast, in the
 * office's own browser — the server has no image library.
 *
 * For one picture on /images/ it draws:
 *   --v480.webp, --v960.webp, --v1600.webp   (never wider than the original)
 *   --og.jpg                                 1200×630, centre-cropped, ≤250 KB
 * and sends them to /api/staff/images/<name>/variants. The original stays.
 *
 * window.glvFastPicture(name)          one picture (called after every upload)
 * window.glvFastAll(onProgress)        every picture that has no copies yet
 */
(function () {
  'use strict';
  const WIDTHS = [480, 960, 1600];
  const OG_MAX = 250 * 1024;

  function load(url) {
    return new Promise((ok, no) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = () => no(new Error('Could not read the picture'));
      im.src = url + (url.indexOf('?') < 0 ? '?fast=' : '&fast=') + Date.now();
    });
  }
  function blob(canvas, type, q) {
    return new Promise(ok => canvas.toBlob(b => ok(b), type, q));
  }
  function draw(im, w, h, crop) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    if (crop) {
      const s = Math.max(w / im.naturalWidth, h / im.naturalHeight);
      const sw = w / s, sh = h / s;
      g.drawImage(im, (im.naturalWidth - sw) / 2, (im.naturalHeight - sh) / 2, sw, sh, 0, 0, w, h);
    } else g.drawImage(im, 0, 0, w, h);
    return c;
  }
  async function webpOk() {
    const c = document.createElement('canvas'); c.width = c.height = 2;
    const b = await blob(c, 'image/webp', 0.8);
    return !!(b && b.type === 'image/webp');
  }

  async function fastPicture(name) {
    if (!/^[a-z0-9][a-z0-9-]{0,120}\.(?:jpg|png|gif|webp)$/.test(name) || /--(v480|v960|v1600|og)\./.test(name)) return { skipped: true };
    if (/\.gif$/.test(name)) return { skipped: true };              // moving pictures stay as they are
    if (!(await webpOk())) throw new Error('This browser cannot make WebP — use Chrome or Edge.');
    const im = await load('/images/' + name);
    const W = im.naturalWidth, H = im.naturalHeight;
    /* An icon or a dot needs no copies. */
    if (W < 320 || H < 160) return { skipped: true, small: true };
    const fd = new FormData();
    fd.append('w', String(W)); fd.append('h', String(H));
    /* Each width up to the original's; the first one at or past it is the
       original's own width, and the larger ones are not made at all. */
    for (const w of WIDTHS) {
      const tw = Math.min(w, W), th = Math.max(1, Math.round(H * tw / W));
      const b = await blob(draw(im, tw, th, false), 'image/webp', w >= 1600 ? 0.78 : 0.8);
      if (b) fd.append('v' + w, b, 'v' + w + '.webp');
      if (w >= W) break;
    }
    let q = 0.86, og = null;
    const oc = draw(im, 1200, 630, true);
    while (q >= 0.5) { og = await blob(oc, 'image/jpeg', q); if (og && og.size <= OG_MAX) break; q -= 0.08; }
    if (og) fd.append('og', og, 'og.jpg');
    const r = await fetch('/api/staff/images/' + encodeURIComponent(name) + '/variants', { method: 'POST', credentials: 'same-origin', body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    return d;
  }

  async function fastAll(onProgress) {
    const r = await fetch('/api/staff/images?all=1', { credentials: 'same-origin' });
    const d = await r.json();
    const todo = (d.images || []).filter(x => !x.optimised && !/\.gif$/.test(x.name));
    let done = 0, failed = 0, before = 0, after = 0;
    for (const x of todo) {
      try {
        const out = await fastPicture(x.name);
        before += x.bytes;
        after += ((out.saved || []).find(s => /--v960\./.test(s.name)) || {}).bytes || 0;
      } catch (e) { failed++; }
      done++;
      if (onProgress) onProgress({ done, total: todo.length, failed, before, after, name: x.name });
    }
    return { total: todo.length, done, failed, before, after };
  }

  window.glvFastPicture = fastPicture;
  window.glvFastAll = fastAll;
})();
