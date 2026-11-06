/*
 * Patch 274: a country code on every phone box (owner, 6 Nov 2026).
 *
 * "Users cannot add a Pakistan or Bangladesh or Australia or Kenya number —
 *  only fixed to India. In case they want a different country code they
 *  should be able to: have country code and phone no; the country code they
 *  can search and select; the phone no they type."
 *
 * What went wrong: the website chat and the blog's "Ask us about this" form
 * kept the last ten digits of whatever was typed. A Lahore 0333 861 9199
 * became +91 333 861 9199 and a Dhaka 01872 125908 became 1872125908 — both
 * numbers nobody can call.
 *
 * What this does, on every page a visitor or a student fills in (it is loaded
 * by glovels-pay.js, which the office's screens do not load):
 *
 *   - Every phone box gets a country-code button in front of it: the flag and
 *     the code, starting on the visitor's own country (from their IP, or the
 *     country they chose in the header), India when that is unknown.
 *   - Tapping it opens a list of every country with a search box: type
 *     "pak", "bangla", "880" or "KE" and pick.
 *   - The number is typed as usual. A leading 0 (the way people write their
 *     number at home: 0333…, 01872…, 0712…) is dropped when the code is put
 *     in front. A number typed with its own + code (or 00) is taken as it is,
 *     and the button switches to that country.
 *   - Whatever the page's own script reads from the box is the whole number,
 *     "+880 1872125908", so every form sends the country code without each
 *     form being rewritten. A number put into the box by a script ("+92…")
 *     selects its country and shows the rest.
 *   - The chat's "Mobile number or email" box shows the button only while
 *     what is typed is a number.
 *   - The checkout's own short code list (patch 228) gets every country and
 *     the same search.
 *
 * A box can opt out with data-no-cc.
 */
(function () {
  'use strict';
  if (window.glvPhoneCc) return;

  /* Every country with its calling code (ITU-T E.164). Shared codes
     (+1, +7, +44, +61, +262, +590, +599) are listed under each country. */
  var RAW = 'AF93 AX358 AL355 DZ213 AS1 AD376 AO244 AI1 AG1 AR54 AM374 AW297 AU61 AT43 AZ994 BS1 BH973 BD880 BB1 BY375 BE32 BZ501 BJ229 BM1 BT975 BO591 BA387 BW267 BR55 IO246 VG1 BN673 BG359 BF226 BI257 KH855 CM237 CA1 CV238 BQ599 KY1 CF236 TD235 CL56 CN86 CX61 CC61 CO57 KM269 CG242 CD243 CK682 CR506 CI225 HR385 CU53 CW599 CY357 CZ420 DK45 DJ253 DM1 DO1 EC593 EG20 SV503 GQ240 ER291 EE372 SZ268 ET251 FK500 FO298 FJ679 FI358 FR33 GF594 PF689 GA241 GM220 GE995 DE49 GH233 GI350 GR30 GL299 GD1 GP590 GU1 GT502 GG44 GN224 GW245 GY592 HT509 HN504 HK852 HU36 IS354 IN91 ID62 IR98 IQ964 IE353 IM44 IL972 IT39 JM1 JP81 JE44 JO962 KZ7 KE254 KI686 XK383 KW965 KG996 LA856 LV371 LB961 LS266 LR231 LY218 LI423 LT370 LU352 MO853 MG261 MW265 MY60 MV960 ML223 MT356 MH692 MQ596 MR222 MU230 YT262 MX52 FM691 MD373 MC377 MN976 ME382 MS1 MA212 MZ258 MM95 NA264 NR674 NP977 NL31 NC687 NZ64 NI505 NE227 NG234 NU683 NF672 KP850 MK389 MP1 NO47 OM968 PK92 PW680 PS970 PA507 PG675 PY595 PE51 PH63 PL48 PT351 PR1 QA974 RE262 RO40 RU7 RW250 BL590 SH290 KN1 LC1 MF590 PM508 VC1 WS685 SM378 ST239 SA966 SN221 RS381 SC248 SL232 SG65 SX1 SK421 SI386 SB677 SO252 ZA27 KR82 SS211 ES34 LK94 SD249 SR597 SJ47 SE46 CH41 SY963 TW886 TJ992 TZ255 TH66 TL670 TG228 TK690 TO676 TT1 TN216 TR90 TM993 TC1 TV688 VI1 UG256 UA380 AE971 GB44 US1 UY598 UZ998 VU678 VA39 VE58 VN84 WF681 EH212 YE967 ZM260 ZW263';
  /* Where a code is shared, the country a bare code belongs to. */
  var MAIN = { '1': 'US', '7': 'RU', '44': 'GB', '61': 'AU', '262': 'RE', '590': 'GP', '599': 'CW', '39': 'IT', '358': 'FI', '47': 'NO', '212': 'MA' };
  /* Countries whose numbers keep their leading 0 after the code. */
  var KEEP0 = { IT: 1, VA: 1, SM: 1 };

  /* What people type instead of the name. */
  var ALIAS = { AE: 'uae emirates dubai abu dhabi', GB: 'uk britain england scotland wales', US: 'usa america', SA: 'ksa saudi', KR: 'south korea', KP: 'north korea',
    CZ: 'czech', NL: 'holland', CI: 'ivory coast', CD: 'drc congo kinshasa', CG: 'congo brazzaville', RU: 'russia', TR: 'turkiye turkey', MM: 'burma', SZ: 'swaziland', MK: 'macedonia', IN: 'bharat' };
  var LIST = RAW.split(' ').map(function (t) { return { iso: t.slice(0, 2), dial: '+' + t.slice(2) }; });
  var BY = {}; LIST.forEach(function (c) { BY[c.iso] = c; });
  var names = null;
  function nameOf(iso) {
    try { names = names || new Intl.DisplayNames([(document.documentElement.lang || 'en').slice(0, 2), 'en'], { type: 'region' }); return names.of(iso) || iso; }
    catch (e) { return iso; }
  }
  function flag(iso) { return iso.replace(/./g, function (ch) { return String.fromCodePoint(127397 + ch.charCodeAt(0)); }); }
  var GEO = '';
  function visitorIso() {
    var c = '';
    try { c = (window.glovelsPay && window.glovelsPay.visitorCountry && window.glovelsPay.visitorCountry()) || ''; } catch (e) { c = ''; }
    if (!c) { try { c = localStorage.getItem('glv-country') || ''; } catch (e) { c = ''; } }
    if (!c) { var m = /(?:^|;\s*)glv_country=([A-Z]{2})/.exec(document.cookie || ''); c = m ? m[1] : ''; }
    if (!c) c = GEO;
    return BY[c] ? c : 'IN';
  }
  /* A page without the checkout script (sign-in): ask the server where the
     visitor is, once, and move every untouched box to that country. */
  if (!window.glovelsPay) {
    try {
      fetch('/api/pay/config', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (cfg) {
        var g = cfg && cfg.geo && cfg.geo.country;
        if (g && BY[g]) { GEO = g; try { document.dispatchEvent(new CustomEvent('glv-country', { detail: g })); } catch (e) {} }
      }).catch(function () {});
    } catch (e) {}
  }
  /* "+8801872125908" → { iso: 'BD', rest: '1872125908' }. Longest code wins. */
  function split(full) {
    var d = String(full || '').replace(/^00/, '+').replace(/[^\d+]/g, '');
    if (d.charAt(0) !== '+') return null;
    d = d.slice(1);
    for (var n = 4; n >= 1; n--) {
      var code = d.slice(0, n);
      var hit = MAIN[code] ? BY[MAIN[code]] : null;
      if (!hit) for (var i = 0; i < LIST.length; i++) if (LIST[i].dial === '+' + code) { hit = LIST[i]; break; }
      if (hit) return { iso: hit.iso, rest: d.slice(n) };
    }
    return null;
  }

  /* ---------------------------------------------------------------- style */
  var css = document.createElement('style');
  css.textContent =
    '.glv-cc-wrap{display:flex;align-items:stretch;gap:0;width:100%;position:relative}'
    + '.glv-cc-wrap>input{flex:1 1 auto;min-width:0;border-top-left-radius:0!important;border-bottom-left-radius:0!important}'
    + '.glv-cc-btn{flex:none;display:inline-flex;align-items:center;gap:6px;padding:0 10px;border:1px solid #cfd8e3;border-right:0;background:#f5f7fa;'
    + 'border-radius:11px 0 0 11px;font:600 14px/1 system-ui,-apple-system,"Segoe UI",sans-serif;color:#0b1e31;cursor:pointer;white-space:nowrap}'
    + '.glv-cc-btn:focus-visible{outline:3px solid #c9a24b;outline-offset:1px}'
    + '.glv-cc-btn .f{font-size:18px;line-height:1}.glv-cc-btn .v{font-size:11px;opacity:.6}'
    + '.glv-cc-wrap.no-cc .glv-cc-btn{display:none}.glv-cc-wrap.no-cc>input{border-radius:inherit!important}'
    + '.glv-cc-pop{position:absolute;z-index:2147483000;left:0;top:calc(100% + 4px);width:min(320px,92vw);max-height:320px;display:flex;flex-direction:column;'
    + 'background:#fff;border:1px solid #cfd8e3;border-radius:12px;box-shadow:0 12px 32px rgba(11,30,49,.18);overflow:hidden}'
    + '.glv-cc-pop input{margin:8px;padding:9px 11px;border:1px solid #cfd8e3;border-radius:9px;font:500 14px system-ui,sans-serif;width:auto}'
    + '.glv-cc-pop ul{list-style:none;margin:0;padding:0 0 6px;overflow:auto}'
    + '.glv-cc-pop li{display:flex;gap:10px;align-items:center;padding:8px 12px;cursor:pointer;font:500 14px system-ui,sans-serif;color:#0b1e31}'
    + '.glv-cc-pop li b{margin-left:auto;font-weight:600;color:#3c5168}'
    + '.glv-cc-pop li[aria-selected="true"],.glv-cc-pop li:hover{background:#eef3fa}'
    + '.glv-cc-pop .none{padding:10px 12px;color:#7889a0;font:500 13px system-ui,sans-serif}'
    + 'html[dir="rtl"] .glv-cc-btn{border-right:1px solid #cfd8e3;border-left:0;border-radius:0 11px 11px 0}'
    + 'html[dir="rtl"] .glv-cc-wrap>input{border-radius:11px 0 0 11px!important}';
  (document.head || document.documentElement).appendChild(css);

  /* ---------------------------------------------------------------- the list */
  var openPop = null;
  function closePop() { if (openPop) { openPop.remove(); openPop = null; } }
  document.addEventListener('mousedown', function (e) { if (openPop && !openPop.contains(e.target) && !(e.target.closest && e.target.closest('.glv-cc-btn'))) closePop(); }, true);

  function pick(anchor, current, onPick) {
    closePop();
    var pop = document.createElement('div');
    pop.className = 'glv-cc-pop'; pop.setAttribute('translate', 'no');
    pop.innerHTML = '<input type="search" placeholder="Search country or code" aria-label="Search country or code" autocomplete="off"><ul role="listbox"></ul>';
    var q = pop.querySelector('input'), ul = pop.querySelector('ul');
    var rows = LIST.map(function (c) { return { c: c, n: nameOf(c.iso) }; }).sort(function (a, b) { return a.n.localeCompare(b.n); });
    var shown = [], at = 0;
    function draw() {
      var t = q.value.trim().toLowerCase().replace(/^\+/, '');
      /* Best match first: the country code exactly, the two-letter code, a
         name that starts with what is typed, a word in the name, the rest. */
      var rank = function (r) {
        var n = r.n.toLowerCase();
        if (/^\d+$/.test(t)) return r.c.dial.slice(1) === t ? (MAIN[t] === r.c.iso ? 0 : 1) : r.c.dial.slice(1).indexOf(t) === 0 ? 2 : 9;
        if (r.c.iso.toLowerCase() === t) return 0;
        if (n.indexOf(t) === 0) return 1;
        if (ALIAS[r.c.iso] && (' ' + ALIAS[r.c.iso]).indexOf(' ' + t) >= 0) return 1;
        if ((' ' + n).indexOf(' ' + t) >= 0) return 2;
        if (n.indexOf(t) >= 0) return 3;
        return 9;
      };
      shown = rows.filter(function (r) { return !t || rank(r) < 9; });
      if (t) shown.sort(function (a, b) { return rank(a) - rank(b) || a.n.localeCompare(b.n); });
      /* the current one first when nothing is typed */
      else shown.sort(function (a, b) { return (b.c.iso === current) - (a.c.iso === current); });
      at = 0;
      ul.innerHTML = shown.length ? shown.slice(0, 260).map(function (r, i) {
        return '<li role="option" data-i="' + i + '" aria-selected="' + (i === 0) + '"><span>' + flag(r.c.iso) + '</span><span>' + r.n.replace(/[&<>]/g, '') + '</span><b>' + r.c.dial + '</b></li>';
      }).join('') : '<li class="none">No country matches</li>';
    }
    function mark() { [].forEach.call(ul.children, function (li, i) { li.setAttribute('aria-selected', String(i === at)); if (i === at && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' }); }); }
    function choose(i) { var r = shown[i]; if (!r) return; closePop(); onPick(r.c.iso); }
    q.addEventListener('input', draw);
    q.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { at = Math.min(at + 1, shown.length - 1); mark(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { at = Math.max(at - 1, 0); mark(); e.preventDefault(); }
      else if (e.key === 'Enter') { choose(at); e.preventDefault(); }
      else if (e.key === 'Escape') { closePop(); anchor.focus(); }
    });
    ul.addEventListener('click', function (e) { var li = e.target.closest('li[data-i]'); if (li) choose(Number(li.getAttribute('data-i'))); });
    draw();
    anchor.parentNode.appendChild(pop);
    openPop = pop;
    /* Near the bottom of the screen (the chat box), the list opens upwards. */
    try {
      var r = anchor.getBoundingClientRect(), below = window.innerHeight - r.bottom, above = r.top;
      if (below < 300 && above > below) { pop.style.top = 'auto'; pop.style.bottom = 'calc(100% + 4px)'; pop.style.maxHeight = Math.min(320, above - 12) + 'px'; }
      else pop.style.maxHeight = Math.max(180, Math.min(320, below - 12)) + 'px';
    } catch (e) {}
    setTimeout(function () { try { q.focus(); } catch (e) {} }, 0);
  }

  /* ---------------------------------------------------------------- a box */
  var proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  function raw(el) { return proto.get.call(el); }
  function setRaw(el, v) { proto.set.call(el, v); }
  function isNumberish(v) { return !/[@a-z]/i.test(v); }

  function compose(el) {
    var v = raw(el).trim();
    if (!v) return '';
    if (el.__glvMixed && !isNumberish(v)) return v;              /* an email in the chat box */
    if (/^(\+|00)/.test(v)) return v.replace(/^00/, '+');
    var iso = el.__glvIso || 'IN';
    var digits = v.replace(/[^\d]/g, '');
    if (!digits) return v;
    if (!KEEP0[iso]) digits = digits.replace(/^0+/, '');
    /* "91 98765 43210" typed after +91: the code is not doubled. */
    var code = BY[iso].dial.slice(1);
    if (digits.length > 10 && digits.indexOf(code) === 0 && digits.length - code.length >= 7) digits = digits.slice(code.length);
    return BY[iso].dial + ' ' + digits;
  }

  function enhance(el) {
    if (el.__glvCc || el.hasAttribute('data-no-cc') || el.closest('[data-no-cc]')) return;
    if (el.type === 'hidden' || el.type === 'email' || el.readOnly) return;
    /* The checkout's own code list (patch 228) — upgrade that instead. */
    var row = el.closest('.phone-row');
    if (row && row.querySelector('select.cc')) { upgradeSelect(row.querySelector('select.cc')); el.__glvCc = true; return; }
    el.__glvCc = true;
    el.__glvMixed = el.name === 'contact' || /\bor email\b/i.test(el.placeholder || '');
    el.__glvIso = visitorIso();

    var wrap = document.createElement('span');
    wrap.className = 'glv-cc-wrap';
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'glv-cc-btn'; btn.setAttribute('translate', 'no');
    btn.setAttribute('aria-haspopup', 'listbox');
    function paint() {
      var c = BY[el.__glvIso];
      btn.innerHTML = '<span class="f">' + flag(c.iso) + '</span><span>' + c.dial + '</span><span class="v">▾</span>';
      btn.setAttribute('aria-label', 'Country code: ' + nameOf(c.iso) + ' ' + c.dial + ' — change');
      if (el.__glvMixed) wrap.classList.toggle('no-cc', !isNumberish(raw(el)) && raw(el).trim() !== '');
    }
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      if (openPop) { closePop(); return; }
      pick(btn, el.__glvIso, function (iso) { el.__glvIso = iso; el.__glvPicked = true; paint(); try { el.focus(); } catch (er) {} el.dispatchEvent(new Event('change', { bubbles: true })); });
    });
    el.parentNode.insertBefore(wrap, el);
    wrap.appendChild(btn); wrap.appendChild(el);

    /* A number typed with its own code switches the button to it. */
    el.addEventListener('input', function () {
      var v = raw(el).trim();
      if (/^(\+|00)\d{1,4}/.test(v)) { var s = split(v); if (s && s.iso !== el.__glvIso && v.replace(/\D/g, '').length >= 3) { el.__glvIso = s.iso; } }
      paint();
    });
    /* What the page reads is the whole number; what a script writes is split. */
    try {
      Object.defineProperty(el, 'value', {
        configurable: true,
        get: function () { return compose(el); },
        set: function (v) {
          v = String(v == null ? '' : v);
          var s = /^(\+|00)/.test(v.trim()) ? split(v) : null;
          if (s && s.rest) { el.__glvIso = s.iso; setRaw(el, s.rest); }
          else setRaw(el, v);
          paint();
        }
      });
    } catch (e) { /* the old behaviour, then */ }
    /* Already filled in (a profile, a returning visitor): split it now. */
    var start = raw(el);
    if (start) el.value = start;
    if (el.placeholder && /10[- ]digit|^\+91 /i.test(el.placeholder)) el.placeholder = 'Mobile number';
    if (el.getAttribute('inputmode') === 'numeric') el.setAttribute('inputmode', 'tel');
    paint();
    /* The visitor's country can arrive after the box is drawn. */
    document.addEventListener('glv-country', function (e) {
      if (el.__glvPicked || raw(el).trim()) return;
      var iso = e && e.detail; if (BY[iso]) { el.__glvIso = iso; paint(); }
    });
  }

  /* A FormData built from the form sees the typed value, not the getter. */
  document.addEventListener('formdata', function (e) {
    var f = e.target; if (!f || !f.elements) return;
    [].forEach.call(f.elements, function (el) { if (el.__glvCc && el.name && el.tagName === 'INPUT' && !el.closest('.phone-row')) e.formData.set(el.name, el.value); });
  }, true);

  /* ---------------------------------------------------------------- the checkout's list */
  function upgradeSelect(sel) {
    if (sel.__glvCc) return;
    sel.__glvCc = true;
    var keep = sel.value || '+91';
    var keepIso = (sel.options[sel.selectedIndex] && /([A-Z]{2})/.exec(isoFromFlag(sel.options[sel.selectedIndex].text) || '')) ? isoFromFlag(sel.options[sel.selectedIndex].text) : '';
    sel.innerHTML = LIST.slice().sort(function (a, b) { return nameOf(a.iso).localeCompare(nameOf(b.iso)); }).map(function (c) {
      return '<option value="' + c.dial + '" data-iso="' + c.iso + '">' + flag(c.iso) + ' ' + c.dial + '</option>';
    }).join('');
    var o = keepIso ? sel.querySelector('option[data-iso="' + keepIso + '"]') : null;
    if (o) o.selected = true; else sel.value = keep;
    sel.setAttribute('translate', 'no');
    /* The native list is long; a search opens instead. */
    sel.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var cur = (sel.options[sel.selectedIndex] || {}).getAttribute ? sel.options[sel.selectedIndex].getAttribute('data-iso') : 'IN';
      pick(sel, cur, function (iso) {
        var opt = sel.querySelector('option[data-iso="' + iso + '"]');
        if (opt) { opt.selected = true; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      });
    });
    sel.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sel.dispatchEvent(new MouseEvent('mousedown')); } });
    if (getComputedStyle(sel.parentNode).position === 'static') sel.parentNode.style.position = 'relative';
  }
  function isoFromFlag(t) {
    var m = /([\uD83C][\uDDE6-\uDDFF])([\uD83C][\uDDE6-\uDDFF])/.exec(String(t || ''));
    if (!m) return '';
    return String.fromCharCode(m[1].codePointAt(0) - 127397) + String.fromCharCode(m[2].codePointAt(0) - 127397);
  }

  /* ---------------------------------------------------------------- find the boxes */
  var SEL = 'input[type="tel"],input[autocomplete="tel"],input[inputmode="tel"],input[name="phone"],input[id$="Phone"]';
  function sweep(root) {
    if (!root || !root.querySelectorAll) return;
    [].forEach.call(root.querySelectorAll(SEL), enhance);
    [].forEach.call(root.querySelectorAll('.phone-row select.cc'), upgradeSelect);
  }
  function boot() {
    sweep(document);
    try {
      new MutationObserver(function (ms) {
        for (var i = 0; i < ms.length; i++) for (var j = 0; j < ms[i].addedNodes.length; j++) {
          var n = ms[i].addedNodes[j];
          if (n.nodeType !== 1 || n.classList && (n.classList.contains('glv-cc-wrap') || n.classList.contains('glv-cc-pop'))) continue;
          if (n.matches && n.matches(SEL)) enhance(n); else sweep(n);
        }
      }).observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.glvPhoneCc = { compose: compose, split: split, list: LIST, enhance: enhance };
}());
