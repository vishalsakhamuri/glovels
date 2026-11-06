/*
 * Patch 276: photos made smaller before they leave the phone.
 *
 * Owner, 6 Nov 2026: "compress all files which are uploaded by students and
 * make sure they are not taking too much space". A phone photo of a
 * certificate is 3–8 MB and 4000 px wide; a passport page reads perfectly at
 * 2400 px. So every JPG or PNG over 600 KB sent to a document or message
 * upload is redrawn at most 2400 px on its long side and saved as a JPEG at
 * quality 0.85 — usually a tenth of the size, and still sharp enough to read
 * the smallest print on an A4 page.
 *
 * Nothing on the pages changes: window.fetch is wrapped, and only a POST to
 * one of the upload addresses below with a FormData body is touched. If the
 * browser cannot read the picture (HEIC outside Safari, a broken file), or
 * the smaller copy saves less than a fifth, the original goes as it was.
 * PDFs and Word files are sent untouched.
 *
 * The office's "Make old photos smaller" button (Organisation screen) uses
 * the same window.glovelsShrink.photo().
 */
(function () {
  'use strict';
  if (window.glovelsShrink) return;
  var MAX_SIDE = 2400, QUALITY = 0.85, MIN_BYTES = 600 * 1024, MIN_SAVING = 0.8;
  var UPLOADS = /^\/api\/(documents|messages\/attach|partner\/student\/\d+\/document|staff\/student\/\d+\/(attach|document\/[^/]+\/file))$/;

  function isPhoto(f) {
    if (!f || typeof f.size !== 'number') return false;
    var t = String(f.type || '').toLowerCase(), n = String(f.name || '').toLowerCase();
    return /^image\/(jpeg|jpg|png|webp)$/.test(t) || /\.(jpe?g|png|webp)$/.test(n);
  }

  function decode(blob) {
    if (window.createImageBitmap) {
      return createImageBitmap(blob, { imageOrientation: 'from-image' })
        .catch(function () { return createImageBitmap(blob); })
        .catch(function () { return viaImg(blob); });
    }
    return viaImg(blob);
  }
  function viaImg(blob) {
    return new Promise(function (ok, no) {
      var u = URL.createObjectURL(blob), im = new Image();
      im.onload = function () { URL.revokeObjectURL(u); ok(im); };
      im.onerror = function () { URL.revokeObjectURL(u); no(new Error('unreadable')); };
      im.src = u;
    });
  }

  /** A smaller File, or the same one when there is nothing worth saving. */
  function photo(file, opts) {
    opts = opts || {};
    var min = opts.minBytes != null ? opts.minBytes : MIN_BYTES;
    if (!isPhoto(file) || file.size < min) return Promise.resolve(file);
    return decode(file).then(function (img) {
      var w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
      if (!w || !h) return file;
      var k = Math.min(1, MAX_SIDE / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
      var c = document.createElement('canvas'); c.width = cw; c.height = ch;
      var g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, cw, ch);   /* a transparent PNG on white, not black */
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, cw, ch);
      if (img.close) try { img.close(); } catch (e) {}
      return new Promise(function (ok) { c.toBlob(ok, 'image/jpeg', QUALITY); }).then(function (b) {
        if (!b || b.size >= file.size * MIN_SAVING) return file;
        var name = String(file.name || 'photo').replace(/\.(jpe?g|png|webp)$/i, '') + '.jpg';
        try { return new File([b], name, { type: 'image/jpeg', lastModified: Date.now() }); }
        catch (e) { b.name = name; return b; }
      });
    }).catch(function () { return file; });
  }

  function shrinkForm(fd) {
    var entries = [], any = false;
    fd.forEach(function (v, k) { entries.push([k, v]); if (isPhoto(v) && v.size >= MIN_BYTES) any = true; });
    if (!any) return Promise.resolve(fd);
    return Promise.all(entries.map(function (e) {
      return isPhoto(e[1]) ? photo(e[1]).then(function (f) { return [e[0], f]; }) : Promise.resolve(e);
    })).then(function (list) {
      var out = new FormData();
      list.forEach(function (e) {
        if (e[1] && typeof e[1] === 'object' && typeof e[1].size === 'number') out.append(e[0], e[1], e[1].name || 'file');
        else out.append(e[0], e[1]);
      });
      return out;
    }).catch(function () { return fd; });
  }

  var realFetch = window.fetch;
  if (realFetch) {
    window.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var p = new URL(url, location.href);
        if (init && init.body instanceof FormData && p.origin === location.origin && UPLOADS.test(p.pathname)
            && String(init.method || 'GET').toUpperCase() === 'POST') {
          var self = this, args = arguments;
          return shrinkForm(init.body).then(function (fd) {
            var i2 = Object.assign({}, init, { body: fd });
            return realFetch.call(self, input, i2);
          });
        }
      } catch (e) { /* any doubt: the request goes as it was */ }
      return realFetch.apply(this, arguments);
    };
  }

  window.glovelsShrink = { photo: photo, isPhoto: isPhoto, MAX_SIDE: MAX_SIDE, QUALITY: QUALITY };
}());
