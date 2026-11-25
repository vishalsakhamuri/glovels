'use strict';
/*
 * Patch 309: the words on a PDF's pages, and where each one sits.
 *
 * The office's banks hand out statements as PDF. This reads the text of a
 * PDF that was written as text (an export from internet banking) — not a
 * scan, which is a picture and has no words in it. No package is needed: a
 * PDF's page is a list of drawing commands, squeezed with zlib, and the
 * commands that draw words say where.
 *
 *   read(buffer) → [ { page: 1, lines: [ { y, items: [ { x, text } ] } ] } ]
 *
 * Lines run top to bottom, items left to right. Only what the statements
 * need is understood: Tm, Td, TD, T*, TL, Tf, Tj, TJ, ' and ", with fonts in
 * the standard Latin encoding. Anything else is skipped, never guessed.
 */
const zlib = require('zlib');

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%'].map(c => c.charCodeAt(0)));

/* cp1252's own characters in 0x80–0x9F; the rest is Latin-1. */
const CP1252 = { 0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’',
  0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š',
  0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ' };
const textOf = bytes => { let s = ''; for (const b of bytes) s += CP1252[b] || String.fromCharCode(b); return s; };

/* ---- the file: its numbered objects ---- */
function objects(buf) {
  const s = buf.toString('latin1');
  const out = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endobj', start);
    if (end < 0) break;
    out.set(Number(m[1]), { start, end });
    re.lastIndex = end;
  }
  return { s, out };
}
const dictOf = (s, o) => s.slice(o.start, Math.min(o.end, (() => { const i = s.indexOf('stream', o.start); return i < 0 || i > o.end ? o.end : i; })()));

function streamOf(buf, s, o) {
  const body = s.slice(o.start, o.end);
  const at = body.search(/stream\r?\n/);
  if (at < 0) return null;
  const head = body.slice(0, at);
  const from = o.start + at + body.slice(at).match(/stream\r?\n/)[0].length;
  let to = s.lastIndexOf('endstream', o.end);
  if (to < from) return null;
  let raw = buf.subarray(from, to);
  if (/\/Filter/.test(head)) {
    if (!/\/FlateDecode/.test(head) || /\/Filter\s*\[[^\]]*\/\w+[^\]]*\/\w+/.test(head)) return null;   /* only plain zlib */
    try { raw = zlib.inflateSync(raw); } catch (e) {
      try { raw = zlib.inflateSync(raw, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); } catch (e2) { return null; }
    }
  }
  return raw;
}

/* The pages in reading order: Catalog → Pages → Kids, as far as it can be
   followed; the content streams in file order if it cannot. */
function pageStreams(buf) {
  const { s, out } = objects(buf);
  const ref = t => { const m = /(\d+)\s+\d+\s+R/.exec(t || ''); return m ? Number(m[1]) : 0; };
  const refs = t => (String(t || '').match(/\d+\s+\d+\s+R/g) || []).map(r => Number(r.split(/\s+/)[0]));
  const pages = [];
  const seen = new Set();
  const walk = n => {
    if (!n || seen.has(n) || !out.has(n)) return;
    seen.add(n);
    const d = dictOf(s, out.get(n));
    if (/\/Type\s*\/Pages\b/.test(d)) {
      const k = /\/Kids\s*\[([^\]]*)\]/.exec(d);
      (k ? refs(k[1]) : []).forEach(walk);
    } else if (/\/Type\s*\/Page\b/.test(d)) {
      const arr = /\/Contents\s*\[([^\]]*)\]/.exec(d);
      const one = /\/Contents\s+(\d+\s+\d+\s+R)/.exec(d);
      pages.push(arr ? refs(arr[1]) : one ? [ref(one[1])] : []);
    }
  };
  let root = 0;
  for (const [n, o] of out) { if (/\/Type\s*\/Catalog\b/.test(dictOf(s, o))) { root = ref((/\/Pages\s+(\d+\s+\d+\s+R)/.exec(dictOf(s, o)) || [])[1]); break; } }
  walk(root);
  const read = list => Buffer.concat(list.map(n => out.has(n) ? streamOf(buf, s, out.get(n)) : null).filter(Boolean).map(b => Buffer.concat([b, Buffer.from('\n')])));
  if (pages.length) return pages.map(read);
  /* no page tree found: every stream that draws text, in file order */
  const all = [];
  for (const [, o] of out) { const b = streamOf(buf, s, o); if (b && b.includes('BT') && (b.includes('Tj') || b.includes('TJ'))) all.push(b); }
  return all;
}

/* ---- one page's drawing commands → the words and where they are ---- */
function itemsOf(stream) {
  const b = stream;
  const items = [];
  let i = 0;
  const stack = [];
  let tm = [1, 0, 0, 1, 0, 0], lm = [1, 0, 0, 1, 0, 0], lead = 0, size = 0;
  const num = v => (typeof v === 'number' ? v : 0);
  const show = bytes => {
    const t = textOf(bytes);
    if (t.trim()) items.push({ x: tm[4], y: tm[5], size, text: t });
    /* move on by a rough width, so two strings shown one after the other on
       a line do not land on the same spot */
    tm = tm.slice(); tm[4] += t.length * (size || 9) * 0.5 * (tm[0] || 1);
  };
  const str = () => {            /* at '(' */
    const out = []; let depth = 1; i++;
    while (i < b.length && depth > 0) {
      let c = b[i];
      if (c === 0x5c) {          /* backslash */
        const n = b[++i];
        if (n === 0x6e) out.push(10); else if (n === 0x72) out.push(13); else if (n === 0x74) out.push(9);
        else if (n === 0x62) out.push(8); else if (n === 0x66) out.push(12);
        else if (n >= 0x30 && n <= 0x37) { let v = n - 0x30, k = 0; while (k < 2 && b[i + 1] >= 0x30 && b[i + 1] <= 0x37) { v = v * 8 + (b[++i] - 0x30); k++; } out.push(v & 255); }
        else if (n === 10) { /* line continuation */ } else if (n === 13) { if (b[i + 1] === 10) i++; }
        else out.push(n);
        i++; continue;
      }
      if (c === 0x28) depth++;
      else if (c === 0x29) { depth--; if (!depth) { i++; break; } }
      out.push(c); i++;
    }
    return out;
  };
  const hex = () => {            /* at '<' (not '<<') */
    let h = ''; i++;
    while (i < b.length && b[i] !== 0x3e) { const c = String.fromCharCode(b[i]); if (/[0-9a-fA-F]/.test(c)) h += c; i++; }
    i++;
    if (h.length % 2) h += '0';
    const out = []; for (let k = 0; k < h.length; k += 2) out.push(parseInt(h.slice(k, k + 2), 16));
    return out;
  };
  const move = (tx, ty) => { lm = [lm[0], lm[1], lm[2], lm[3], lm[0] * tx + lm[2] * ty + lm[4], lm[1] * tx + lm[3] * ty + lm[5]]; tm = lm.slice(); };
  while (i < b.length) {
    const c = b[i];
    if (WS.has(c)) { i++; continue; }
    if (c === 0x25) { while (i < b.length && b[i] !== 10 && b[i] !== 13) i++; continue; }   /* % comment */
    if (c === 0x28) { stack.push(str()); continue; }
    if (c === 0x3c) { if (b[i + 1] === 0x3c) { stack.push('<<'); i += 2; } else stack.push(hex()); continue; }
    if (c === 0x3e) { i += b[i + 1] === 0x3e ? 2 : 1; stack.push('>>'); continue; }
    if (c === 0x5b) { stack.push('['); i++; continue; }
    if (c === 0x5d) {            /* ] — gather back to the [ */
      const arr = []; let v;
      while (stack.length && (v = stack.pop()) !== '[') arr.unshift(v);
      stack.push({ arr }); i++; continue;
    }
    if (c === 0x2f) { let j = i + 1; while (j < b.length && !WS.has(b[j]) && !DELIM.has(b[j])) j++; stack.push('/' + b.toString('latin1', i + 1, j)); i = j; continue; }
    let j = i;
    while (j < b.length && !WS.has(b[j]) && !DELIM.has(b[j])) j++;
    if (j === i) { i++; continue; }
    const tok = b.toString('latin1', i, j); i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) { stack.push(Number(tok)); continue; }
    /* an operator */
    switch (tok) {
      case 'BT': tm = [1, 0, 0, 1, 0, 0]; lm = tm.slice(); break;
      case 'Tf': size = num(stack[stack.length - 1]); break;
      case 'TL': lead = num(stack[stack.length - 1]); break;
      case 'Tm': if (stack.length >= 6) { lm = stack.slice(-6).map(num); tm = lm.slice(); } break;
      case 'Td': move(num(stack[stack.length - 2]), num(stack[stack.length - 1])); break;
      case 'TD': lead = -num(stack[stack.length - 1]); move(num(stack[stack.length - 2]), num(stack[stack.length - 1])); break;
      case 'T*': move(0, -lead); break;
      case 'Tj': { const v = stack[stack.length - 1]; if (Array.isArray(v)) show(v); break; }
      case "'": { move(0, -lead); const v = stack[stack.length - 1]; if (Array.isArray(v)) show(v); break; }
      case '"': { move(0, -lead); const v = stack[stack.length - 1]; if (Array.isArray(v)) show(v); break; }
      case 'TJ': {
        const v = stack[stack.length - 1];
        if (v && v.arr) { let all = []; v.arr.forEach(p => { if (Array.isArray(p)) all = all.concat(p); else if (typeof p === 'number' && p < -200) all.push(32); }); show(all); }
        break;
      }
      default: break;
    }
    stack.length = 0;
  }
  return items;
}

/* Words on the same height are one line. */
function linesOf(items) {
  const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  sorted.forEach(it => {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= 2.2) last.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  });
  lines.forEach(l => {
    l.items.sort((a, b) => a.x - b.x);
    l.text = l.items.map(i => i.text.trim()).filter(Boolean).join(' ');
  });
  return lines;
}

function read(buf) {
  if (!Buffer.isBuffer(buf) || buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('That is not a PDF file.');
  if (/\/Encrypt\b/.test(buf.subarray(Math.max(0, buf.length - 4096)).toString('latin1'))) throw new Error('That PDF is locked with a password. Download it without one, or open it and print it to a new PDF.');
  const pages = pageStreams(buf).map((st, n) => ({ page: n + 1, lines: linesOf(itemsOf(st)) }));
  if (!pages.some(p => p.lines.length)) throw new Error('No text was found in that PDF. A scanned statement is a picture; download the statement from internet banking instead.');
  return pages;
}

module.exports = { read };
