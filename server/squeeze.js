'use strict';
/*
 * Compression, in one place.
 *
 * The home page is half a megabyte of HTML — the finder's table, the
 * stylesheet and the scripts are all in it, which is what makes it work on
 * static hosting — and it went down the wire as-is. On a phone that is the
 * first three seconds Lighthouse counts. Brotli or gzip, whichever the
 * browser asked for, on anything textual over a kilobyte; pictures and fonts
 * are already compressed and are left alone.
 *
 * Quality 5 brotli / level 6 gzip: a 540 KB page squeezes to ~90 KB in about
 * 20 ms, and the levels above that cost more time than they save bytes.
 */
const zlib = require('zlib');

const TEXTUAL = /^(text\/|application\/(json|javascript|xml|manifest\+json|ld\+json|xhtml\+xml)|image\/svg\+xml)/i;

/**
 * Pick an encoding the request accepts, squeeze the body, and return
 * { body, headers } with Content-Encoding, Vary and Content-Length set.
 * Untouched when the body is small, binary, or nobody asked.
 */
function squeeze(req, body, type, headers) {
  const out = Object.assign({}, headers || {});
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body == null ? '' : body));
  const accept = String((req && req.headers && req.headers['accept-encoding']) || '');
  if (buf.length < 1024 || !TEXTUAL.test(String(type || '')) || out['Content-Encoding']) {
    out['Content-Length'] = buf.length;
    return { body: buf, headers: out };
  }
  out.Vary = out.Vary ? out.Vary + ', Accept-Encoding' : 'Accept-Encoding';
  let enc = '';
  let squeezed = buf;
  if (/\bbr\b/.test(accept)) {
    enc = 'br';
    squeezed = zlib.brotliCompressSync(buf, { params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    } });
  } else if (/\bgzip\b/.test(accept)) {
    enc = 'gzip';
    squeezed = zlib.gzipSync(buf, { level: 6 });
  }
  if (enc) out['Content-Encoding'] = enc;
  out['Content-Length'] = squeezed.length;
  return { body: squeezed, headers: out };
}

module.exports = { squeeze };
