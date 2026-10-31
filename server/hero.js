/*
 * Round 15 Oct (item 6) — the inside-page banner.
 *
 * Every public inside page (the shared template, the forty static pages, the
 * blog, the university pages, Find University) opens with
 *   <section class="page-hero"><div class="wrap">
 *     <div class="crumbs">…</div><h1>…</h1><p>…</p>
 *   </div></section>
 * and that markup lives in fifty files. So it is redrawn here, once, on the
 * way out (serve.js send → upgrade): a rounded navy card inside the page
 * width, the breadcrumb, a small gold eyebrow, the title with its last
 * word(s) in italic gold, the subtitle, and on the right an illustration (a
 * night city for study pages, a globe with a flight path for work and
 * migrate pages) with two or three glassy chips.
 *
 * What a page says is data, not code:
 *   - the section may carry data-eyebrow, data-italic (the trailing words to
 *     set in italic), data-tail (italic words appended to the title),
 *     data-art (city | globe | none) and data-chips ("big|small;;big|small",
 *     or "none") — the template's {{HERO}} hole is where a renderer puts them;
 *   - otherwise PAGES below, by address;
 *   - otherwise a default from the address and the title: the eyebrow from
 *     the section of the site, the title's last word in italic (or what
 *     follows " — ").
 *
 * Owner rule: no programme or match COUNTS in a banner. A chip is a fact
 * about the office or the page (hours, city, steps), never a tally.
 */
'use strict';

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const unattr = s => String(s || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/* Titles that read better with a word added in italic than with their own
   last word italicised. The browser uses the same table (CLIENT_JS). */
const TAILS = { 'Find your university': 'abroad' };

const OFFICE = [['Mon–Sat', '9:30am–7:30pm IST'], ['Hyderabad', 'office, or online']];
/* 31 Oct (owner): a global site — the office is on the contact page only. */
const COUNSEL = [['Free', 'first counselling call'], ['Online', 'from anywhere in the world']];

/* Per address. Steps are the page's own, in its own order. */
const PAGES = {
  '/contact-us': { eyebrow: 'Contact', chips: OFFICE },
  '/find-university': { eyebrow: 'Find university' },
  '/migrate-canada-pr': { eyebrow: 'Migrate', art: 'globe', chips: [['01', 'ECA & language test'], ['02', 'CRS profile'], ['03', 'Invitation draws']] },
  '/migrate-australia-pr': { eyebrow: 'Migrate', art: 'globe', chips: [['01', 'Skills assessment'], ['02', 'EOI & points'], ['03', 'State nomination']] },
  '/work-opportunity-card': { eyebrow: 'Work in Germany', art: 'globe', italic: 'Opportunity Card', chips: [['01', 'Qualify on points'], ['02', 'Funds & visa'], ['03', 'Search on the ground']] },
  '/work-nursing-germany': { eyebrow: 'Work in Germany', art: 'globe', italic: 'Germany', chips: [['01', 'Recognition'], ['02', 'B2 German'], ['03', 'Work visa']] },
  '/work-pharma-germany': { eyebrow: 'Work in Germany', art: 'globe', italic: 'Germany', chips: [['01', 'B2 German'], ['02', 'Fachsprachprüfung'], ['03', 'Approbation']] },
  '/work-medical-pg-germany': { eyebrow: 'Work in Germany', art: 'globe', italic: 'Germany', chips: [['01', 'German B2 → C1'], ['02', 'Approbation'], ['03', 'Paid residency']] },
  '/visa-processing': { eyebrow: 'Visa', art: 'globe', chips: [['01', 'The checklist'], ['02', 'Funds & forms'], ['03', 'The interview']] },
  '/about-us': { eyebrow: 'About us', chips: OFFICE.slice(1).concat([['Study', 'work & migrate']]) },
  '/blog': { eyebrow: 'Blog', chips: [['Guides', 'from our counsellors'], ['Free', 'first counselling call']] },
  '/careers': { eyebrow: 'Careers', chips: OFFICE.slice(1) },
  '/refer': { eyebrow: 'Refer a friend' },
  '/glossary': { eyebrow: 'Glossary' },
  '/success-stories': { eyebrow: 'Success stories', chips: COUNSEL },
  '/404': { eyebrow: 'Not found', chips: [] },
  '/language-german': { eyebrow: 'Language classes', chips: COUNSEL },
  '/language-french': { eyebrow: 'Language classes', chips: COUNSEL },
  '/test-ielts-toefl-pte': { eyebrow: 'Test prep', chips: COUNSEL },
  '/test-gre-gmat-sat': { eyebrow: 'Test prep', chips: COUNSEL },
};
const LEGAL = ['/terms', '/privacy', '/refunds', '/grievance', '/disclaimers'];

function clean(pathname) {
  let p = String(pathname || '/').replace(/\.html$/, '').replace(/\/+$/, '');
  return p || '/';
}

/* The defaults for an address with no entry above. */
function defaultsFor(p, crumbsText) {
  if (PAGES[p]) return PAGES[p];
  if (LEGAL.includes(p)) return { eyebrow: 'Legal', chips: [] };
  if (/^\/study-in-/.test(p)) return { eyebrow: 'Study abroad', chips: COUNSEL };
  if (/^\/work-/.test(p)) return { eyebrow: 'Work abroad', art: 'globe', chips: COUNSEL };
  if (/^\/migrate-/.test(p)) return { eyebrow: 'Migrate', art: 'globe', chips: COUNSEL };
  if (/^\/test-/.test(p)) return { eyebrow: 'Test prep', chips: COUNSEL };
  if (/^\/language-/.test(p)) return { eyebrow: 'Language classes', chips: COUNSEL };
  if (/^\/post\//.test(p)) return { eyebrow: 'Blog', chips: [] };
  if (p === '/university') return { eyebrow: 'Universities', chips: COUNSEL };
  if (/^\/university\//.test(p)) return { eyebrow: 'University', chips: [] };
  if (p === '/find-university') return PAGES['/find-university'];
  const last = String(crumbsText || '').split('/').map(s => s.trim()).filter(Boolean).pop();
  return { eyebrow: last || 'Glovels', chips: [] };
}

/* "Canada PR — Express Entry" → "Canada PR — <em>Express Entry</em>";
   "Contact us" → "Contact <em>us</em>". Plain text in, HTML out. A title
   that already carries markup is left alone. */
function italicHtml(h1Html, italic, tail) {
  const raw = String(h1Html || '').trim();
  if (!raw || /<[a-z]/i.test(raw)) return raw;
  const text = unattr(raw);
  if (tail) return esc(text) + ' <em>' + esc(tail) + '</em>';
  if (TAILS[text]) return esc(text) + ' <em>' + esc(TAILS[text]) + '</em>';
  if (italic && text.length > italic.length && text.endsWith(italic)) {
    return esc(text.slice(0, text.length - italic.length)) + '<em>' + esc(italic) + '</em>';
  }
  const dash = text.lastIndexOf(' — ');
  if (dash > 0 && dash < text.length - 3) return esc(text.slice(0, dash + 3)) + '<em>' + esc(text.slice(dash + 3)) + '</em>';
  const sp = text.lastIndexOf(' ');
  if (sp <= 0) return '<em>' + esc(text) + '</em>';
  return esc(text.slice(0, sp + 1)) + '<em>' + esc(text.slice(sp + 1)) + '</em>';
}

/* ---- the two illustrations, drawn once ---- */
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function stars(r, n, w, h) {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += '<circle cx="' + (r() * w).toFixed(1) + '" cy="' + (r() * h).toFixed(1) + '" r="' + (0.6 + r() * 1.1).toFixed(2)
      + '" fill="#fff" opacity="' + (0.25 + r() * 0.55).toFixed(2) + '"/>';
  }
  return out;
}

function citySvg() {
  const r = rng(1015);
  const W = 640, H = 320, G = 320;
  let back = '', front = '', win = '';
  /* The far row: tall, pale, few lights. */
  for (let x = 0; x < W;) {
    const w = 34 + Math.floor(r() * 46), h = 90 + Math.floor(r() * 120);
    back += '<rect x="' + x + '" y="' + (G - h) + '" width="' + w + '" height="' + h + '" fill="#1b3f66"/>';
    if (r() < 0.35) back += '<path d="M' + x + ' ' + (G - h) + 'L' + (x + w / 2) + ' ' + (G - h - 26 - r() * 20).toFixed(0) + 'L' + (x + w) + ' ' + (G - h) + 'Z" fill="#1b3f66"/>';
    x += w + 2;
  }
  /* A dome, the university. */
  back += '<path d="M250 ' + (G - 150) + 'a90 70 0 0 1 180 0Z" fill="#183a60"/><rect x="250" y="' + (G - 150) + '" width="180" height="150" fill="#183a60"/>'
    + '<rect x="334" y="' + (G - 236) + '" width="12" height="20" fill="#183a60"/>';
  /* The near row: darker, lit windows. */
  for (let x = -10; x < W;) {
    const w = 40 + Math.floor(r() * 54), h = 50 + Math.floor(r() * 110);
    front += '<rect x="' + x + '" y="' + (G - h) + '" width="' + w + '" height="' + h + '" fill="#0f2a4a"/>';
    if (r() < 0.3) front += '<path d="M' + (x - 3) + ' ' + (G - h) + 'L' + (x + w / 2) + ' ' + (G - h - 22) + 'L' + (x + w + 3) + ' ' + (G - h) + 'Z" fill="#0f2a4a"/>';
    for (let wy = G - h + 12; wy < G - 12; wy += 15) {
      for (let wx = x + 7; wx < x + w - 8; wx += 12) {
        if (r() < 0.32) win += '<rect x="' + wx + '" y="' + wy + '" width="4.5" height="7" rx="1" fill="#e8bc62" opacity="' + (0.55 + r() * 0.4).toFixed(2) + '"/>';
      }
    }
    x += w + 3;
  }
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMaxYMax slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">'
    + '<defs><radialGradient id="ph2glow" cx="0.62" cy="0.92" r="0.55"><stop offset="0" stop-color="#e2b860" stop-opacity=".38"/><stop offset="1" stop-color="#e2b860" stop-opacity="0"/></radialGradient></defs>'
    + stars(r, 46, W, 170)
    + '<rect width="' + W + '" height="' + H + '" fill="url(#ph2glow)"/>'
    + '<g opacity=".75">' + back + '</g>' + front + win
    + '</svg>';
}

function globeSvg() {
  const r = rng(2026);
  const W = 640, H = 320, cx = 380, cy = 600, R = 360;
  let lights = '';
  for (let i = 0; i < 70; i++) {
    const a = -Math.PI / 2 + (r() - 0.5) * 1.5, d = R - 6 - r() * 70;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    if (y < H) lights += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (0.8 + r() * 1.6).toFixed(2) + '" fill="#e8bc62" opacity="' + (0.35 + r() * 0.6).toFixed(2) + '"/>';
  }
  let grid = '';
  for (let k = 1; k <= 4; k++) grid += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + (R * k / 4.6).toFixed(0) + '" ry="' + R + '" fill="none" stroke="#7fa3c9" stroke-opacity=".14"/>';
  for (let k = 1; k <= 3; k++) grid += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + R + '" ry="' + (R * k / 3.6).toFixed(0) + '" fill="none" stroke="#7fa3c9" stroke-opacity=".12"/>';
  const cloud = (x, y, s) => '<g fill="#fff" opacity=".06" transform="translate(' + x + ' ' + y + ') scale(' + s + ')"><ellipse cx="0" cy="0" rx="40" ry="14"/><ellipse cx="-14" cy="-10" rx="18" ry="14"/><ellipse cx="12" cy="-12" rx="22" ry="17"/></g>';
  /* Material "flight" glyph, nose up, turned along the path. */
  const plane = '<g transform="translate(468 112) rotate(62) scale(3.1) translate(-12 -12)"><path fill="#c3cfdd" d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></g>';
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMaxYMax slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">'
    + '<defs><radialGradient id="ph2atm" cx="0.6" cy="1" r="0.75"><stop offset=".55" stop-color="#e2b860" stop-opacity=".22"/><stop offset="1" stop-color="#e2b860" stop-opacity="0"/></radialGradient>'
    + '<radialGradient id="ph2earth" cx=".5" cy=".1" r=".9"><stop offset="0" stop-color="#1d4b7c"/><stop offset="1" stop-color="#0c2443"/></radialGradient>'
    + '<clipPath id="ph2clip"><circle cx="' + cx + '" cy="' + cy + '" r="' + R + '"/></clipPath>'
    + '</defs>'
    + stars(r, 40, W, 200)
    + '<rect width="' + W + '" height="' + H + '" fill="url(#ph2atm)"/>'
    + cloud(150, 70, 1) + cloud(560, 60, 1.1) + cloud(300, 110, 1.3) + cloud(600, 210, 0.9)
    + '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="url(#ph2earth)" stroke="#e2b860" stroke-opacity=".35" stroke-width="1.5"/>'
    + '<g clip-path="url(#ph2clip)">' + grid + lights + '</g>'
    + '<path d="M120 300 Q 330 40 600 165" fill="none" stroke="#e2b860" stroke-opacity=".75" stroke-width="2.2" stroke-dasharray="7 8"/>'
    + '<circle cx="120" cy="300" r="5" fill="#e2b860" opacity=".8"/>'
    + '<circle cx="600" cy="165" r="12" fill="none" stroke="#e2b860" stroke-opacity=".8" stroke-width="1.6"/><circle cx="600" cy="165" r="5" fill="#e2b860"/>'
    + plane
    + '</svg>';
}

let ART = null;
function art(kind) {
  if (!ART) ART = { city: citySvg(), globe: globeSvg() };
  return ART[kind] || '';
}

const CSS = '<style data-ph2>'
  + '.page-hero[data-ph2]{background:none !important;padding:18px 0 6px !important;color:#fff}'
  + '.page-hero[data-ph2]>.wrap{display:block !important;max-width:var(--maxw,1180px);margin:0 auto;padding:0 var(--wrap,24px) !important}'
  + '.page-hero[data-ph2] .ph2-card{position:relative;overflow:hidden;isolation:isolate;border-radius:20px;'
  + 'background:radial-gradient(120% 140% at 88% 105%,#1d4877 0%,rgba(29,72,119,0) 58%),linear-gradient(160deg,#0a1c33 0%,#0f2a4a 55%,#143a63 100%);'
  + 'padding:clamp(28px,4vw,52px) clamp(22px,4.6vw,60px);min-height:290px;display:grid;'
  + 'grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:22px 28px;align-items:center;box-shadow:0 18px 46px rgba(11,31,58,.2)}'
  + '.ph2-art{position:absolute;top:0;right:0;bottom:0;width:64%;pointer-events:none;z-index:-1;'
  + '-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 34%);mask-image:linear-gradient(90deg,transparent 0,#000 34%)}'
  + '.ph2-art svg{width:100%;height:100%;display:block}'
  + '.ph2-txt{position:relative;min-width:0}'
  + '.page-hero[data-ph2] .crumbs{margin:0 0 12px;color:#c8d6e4;font-size:13px}'
  + '.page-hero[data-ph2] .crumbs a{color:#fff;text-decoration:none}.page-hero[data-ph2] .crumbs a:hover{text-decoration:underline}'
  + '.ph2-eye{font:700 12px/1.2 var(--sans,system-ui);letter-spacing:.16em;text-transform:uppercase;color:#e2b860;margin:0 0 10px}'
  + '.page-hero[data-ph2] h1{font-family:var(--disp,Georgia,serif);font-weight:700;font-size:clamp(30px,4.3vw,54px);line-height:1.08;color:#fff;max-width:18ch;margin:0;overflow-wrap:break-word}'
  + '.page-hero[data-ph2] h1 em{font-style:italic;color:#e2b860;font-weight:600}'
  + '.page-hero[data-ph2] .ph2-txt p{color:#d5e0ec;font-size:16px;line-height:1.55;max-width:54ch;margin:14px 0 0}'
  + '.ph2-chips{position:relative;display:flex;gap:12px;justify-content:flex-end;align-self:end;flex-wrap:wrap}'
  + '.ph2-chip{min-width:132px;padding:14px 18px;border-radius:14px;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.22);'
  + 'backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:inset 0 1px 0 rgba(255,255,255,.12)}'
  + '.ph2-chip b{display:block;font:700 clamp(20px,2.2vw,28px)/1.15 var(--disp,Georgia,serif);color:#fff;white-space:nowrap}'
  + '.ph2-chip span{display:block;margin-top:5px;font-size:13px;line-height:1.35;color:#c8d6e4}'
  + '@media (max-width:900px){.page-hero[data-ph2] .ph2-card{grid-template-columns:minmax(0,1fr);min-height:0}.ph2-art{width:100%;opacity:.3}.ph2-chips{justify-content:flex-start}}'
  + '@media (max-width:520px){.page-hero[data-ph2]{padding:12px 0 4px !important}.page-hero[data-ph2]>.wrap{padding:0 14px !important}'
  + '.page-hero[data-ph2] .ph2-card{border-radius:16px;padding:24px 20px}.ph2-chips{gap:8px}.ph2-chip{min-width:0;flex:1 1 calc(50% - 4px);padding:11px 13px}'
  + '.ph2-chip b{white-space:normal;font-size:19px}.ph2-chip span{font-size:12px}}'
  + '@media print{.ph2-art,.ph2-chips{display:none}}'
  + '</style>';

/* The same italic rule in the browser, for a page that rewrites its own
   title (Find University does, on every filter change). */
const CLIENT_JS = '<script>window.GLV_HERO_H1=function(t){var T=' + JSON.stringify(TAILS) + ';'
  + 'var e=function(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});};'
  + 't=String(t||"").trim();if(T[t])return e(t)+" <em>"+e(T[t])+"</em>";'
  + 'var d=t.lastIndexOf(" \\u2014 ");if(d>0&&d<t.length-3)return e(t.slice(0,d+3))+"<em>"+e(t.slice(d+3))+"</em>";'
  + 'var s=t.lastIndexOf(" ");return s<=0?"<em>"+e(t)+"</em>":e(t.slice(0,s+1))+"<em>"+e(t.slice(s+1))+"</em>";};</script>';

function attr(open, name) {
  const m = new RegExp('\\sdata-' + name + '="([^"]*)"').exec(open);
  return m ? unattr(m[1]) : null;
}
function parseChips(s) {
  if (s == null) return null;
  if (s === 'none' || s === '') return [];
  return s.split(';;').map(x => x.split('|')).filter(x => x[0]).slice(0, 3);
}

/* The section, redrawn. Anything the old markup held beyond the crumbs and
   the title (the subtitle, a note) stays, in the text column, in order. */
function upgrade(html, pathname) {
  if (typeof html !== 'string' || html.indexOf('<section class="page-hero"') < 0 || html.indexOf('data-ph2') >= 0) return html;
  const re = /<section class="page-hero"([^>]*)>([\s\S]*?)<\/section>/;
  const m = re.exec(html);
  if (!m) return html;
  const open = m[1], inner0 = m[2];
  let inner = inner0.trim().replace(/^<div class="wrap">/, '').replace(/<\/div>\s*$/, '');
  const cm = /<div class="crumbs">([\s\S]*?)<\/div>/.exec(inner);
  const hm = /<h1([^>]*)>([\s\S]*?)<\/h1>/.exec(inner);
  if (!hm) return html;
  const crumbs = cm ? cm[1] : '';
  let rest = inner;
  if (cm) rest = rest.replace(cm[0], '');
  rest = rest.trim();
  const p = clean(pathname);
  const d = defaultsFor(p, crumbs.replace(/<[^>]+>/g, ''));
  const eyebrow = attr(open, 'eyebrow') || d.eyebrow || '';
  const kind = attr(open, 'art') || d.art || 'city';
  const chips = parseChips(attr(open, 'chips')) || d.chips || [];
  const title = italicHtml(hm[2], attr(open, 'italic') || d.italic, attr(open, 'tail'));
  /* The title in place — a university page wraps it with its logo
     (<div class="uni-head">) — and the eyebrow just before whichever comes
     first. */
  rest = rest.replace(hm[0], '<h1' + hm[1] + '>' + title + '</h1>');
  const eyeHtml = eyebrow ? '<div class="ph2-eye">' + esc(eyebrow) + '</div>' : '';
  const at = (() => { const u = rest.indexOf('<div class="uni-head"'); const h = rest.indexOf('<h1'); return u >= 0 && u < h ? u : h; })();
  rest = rest.slice(0, at) + eyeHtml + rest.slice(at);
  const out = '<section class="page-hero"' + open + ' data-ph2 data-art-kind="' + esc(kind) + '"><div class="wrap"><div class="ph2-card">'
    + (kind === 'none' ? '' : '<div class="ph2-art" aria-hidden="true">' + art(kind) + '</div>')
    + '<div class="ph2-txt">'
    + (crumbs ? '<div class="crumbs">' + crumbs + '</div>' : '')
    + rest
    + '</div>'
    + (chips.length ? '<div class="ph2-chips">' + chips.map(c => '<div class="ph2-chip"><b>' + esc(c[0]) + '</b>' + (c[1] ? '<span>' + esc(c[1]) + '</span>' : '') + '</div>').join('') + '</div>' : '')
    + '</div></div></section>';
  html = html.slice(0, m.index) + out + html.slice(m.index + m[0].length);
  return html.indexOf('</head>') >= 0 ? html.replace('</head>', CSS + CLIENT_JS + '</head>') : CSS + CLIENT_JS + html;
}

/* For a renderer filling the template's {{HERO}} hole. */
function attrs(o) {
  o = o || {};
  let s = '';
  ['eyebrow', 'italic', 'tail', 'art'].forEach(k => { if (o[k]) s += ' data-' + k + '="' + esc(o[k]) + '"'; });
  if (o.chips) s += ' data-chips="' + esc(o.chips.length ? o.chips.map(c => [c[0], c[1] || ''].map(x => String(x).replace(/[|;]/g, ' ')).join('|')).join(';;') : 'none') + '"';
  return s;
}

module.exports = { upgrade, attrs, italicHtml, defaultsFor, PAGES, TAILS };
