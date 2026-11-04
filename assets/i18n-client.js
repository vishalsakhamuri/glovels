/* patch 265: the words scripts draw after the page has loaded, in the
   visitor's language. The page arrived translated (server/i18n.js); this
   translates what the finder, the packages, the chat box and the portal
   screens draw afterwards, from the dictionary the server put in the page,
   and tells the server about lines it has not seen so the next visitor
   gets them translated. Same keys as the server: inline tags become
   numbered placeholders, numbers become {1}, {2}. */
(function () {
  'use strict';
  var cfgEl = document.getElementById('glvI18n');
  var CFG = null;
  try { CFG = cfgEl ? JSON.parse(cfgEl.textContent) : null; } catch (e) { CFG = null; }
  var LANG = (CFG && CFG.lang) || (document.documentElement.lang || 'en').slice(0, 2);
  var D = (CFG && CFG.d) || {};
  var PAGE = (CFG && CFG.page) || '';

  /* Remembered for the next visit, and for the pages a script navigates to. */
  try { document.cookie = 'glv_lang=' + LANG + '; Path=/; Max-Age=31536000; SameSite=Lax'; } catch (e) {}
  if (!CFG) return;

  var INLINE = { a: 1, abbr: 1, b: 1, bdi: 1, bdo: 1, cite: 1, data: 1, dfn: 1, em: 1, i: 1, mark: 1, q: 1, s: 1, small: 1, span: 1, strong: 1, sub: 1, sup: 1, time: 1, u: 1, wbr: 1, br: 1, img: 1, del: 1, ins: 1, svg: 1 };
  var SKIP = { script: 1, style: 1, textarea: 1, pre: 1, code: 1, kbd: 1, samp: 1, svg: 1, noscript: 1, template: 1, iframe: 1, option: 0 };
  var VOIDISH = { br: 1, img: 1, wbr: 1, svg: 1 };
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  var NUM = /\d[\d,. ]*\d|\d/g;
  var LETTER = /\p{L}/u, TWO = /\p{L}[^\p{L}]*\p{L}/u;

  function hash(s) {
    var a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      a ^= c; a = Math.imul(a, 0x01000193) >>> 0;
      b ^= c; b = Math.imul(b, 0x01000193 + 2) >>> 0;
    }
    return ('00000000' + (a >>> 0).toString(16)).slice(-8) + ('00000000' + (b >>> 0).toString(16)).slice(-8);
  }
  function notWords(t) {
    t = t.replace(/<\/?\d+\/?>|\{\d+\}/g, '').trim();
    if (!TWO.test(t)) return true;
    if (/^(https?:\/\/|www\.|mailto:|tel:|\/|#)\S*$/i.test(t)) return true;
    if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(t)) return true;
    if (/^[+\d][\d\s().-]{5,}$/.test(t)) return true;
    if (/^[\[{]/.test(t) && /[\]}]$/.test(t)) return true;
    if (/^[A-Z]{2,4}$/.test(t) && t !== 'FAQ') return true;
    return false;
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function inNo(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentNode) {
      if (e.getAttribute('translate') === 'no' || e.id === 'glvI18n') return true;
      var tn = e.tagName.toLowerCase();
      if (SKIP[tn]) return true;
    }
    return false;
  }

  /* Is this element a unit, the way the server cuts them: its children are
     text and inline elements only, and some of the text is its own (an
     element that only wraps other inline elements — a card with a <b> and a
     <span> — is not a unit; each of those is). */
  function opaque(k) { var tn = k.tagName.toLowerCase(); return VOIDISH[tn] || k.getAttribute('translate') === 'no'; }
  function inlineOnly(el) {
    var kids = el.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.nodeType !== 1) continue;
      var tn = k.tagName.toLowerCase();
      if (!INLINE[tn]) return false;
      if (!opaque(k) && !inlineOnly(k)) return false;
    }
    return true;
  }
  function leafish(el) {
    if (!inlineOnly(el)) return false;
    var kids = el.childNodes;
    for (var i = 0; i < kids.length; i++) if (kids[i].nodeType === 3 && LETTER.test(kids[i].nodeValue)) return true;
    return false;
  }
  /* Between <!--i18n:off--> and <!--i18n:on--> (a post translated whole):
     the nearest marker before the element, at any level, decides. */
  function offAt(el) {
    for (var a = el; a && a.nodeType === 1 && a !== document.body; a = a.parentNode) {
      for (var sib = a.previousSibling; sib; sib = sib.previousSibling) {
        if (sib.nodeType === 8) { if (sib.nodeValue === 'i18n:off') return true; if (sib.nodeValue === 'i18n:on') break; }
      }
      var f = a.firstChild;
      if (f && f.nodeType === 8 && f.nodeValue === 'i18n:off' && a === el) return true;
    }
    return false;
  }

  /* The key of an element, the same way the server builds it. */
  function keyOf(el) {
    var tags = [], nums = [], key = '';
    function walk(node) {
      var kids = node.childNodes;
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        if (k.nodeType === 3) {
          key += k.nodeValue.replace(/\s+/g, ' ').replace(/[&<>]/g, function (c) { return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'; })
            .replace(NUM, function (m) { nums.push(m); return '{' + nums.length + '}'; });
          continue;
        }
        if (k.nodeType !== 1) continue;
        if (opaque(k)) { tags.push({ node: k }); key += '<' + tags.length + '/>'; continue; }
        tags.push({ node: k, open: true });
        var n = tags.length;
        key += '<' + n + '>'; walk(k); key += '</' + n + '>';
      }
    }
    walk(el);
    return { key: key.trim(), tags: tags, nums: nums };
  }

  /* Whole-text: the bare text of the server's key is HTML-escaped (the
     server reads the page source), so "&" in a text node is "&amp;" in the
     key. Numbers were taken out before escaping on the server too — the
     order is the same here: replace numbers in the escaped text. */

  /* Put a translation into an element, from placeholders back to the
     element's own children. */
  function render(el, text, u) {
    var frag = document.createDocumentFragment();
    var stack = [frag];
    var re = /<(\/?)(\d+)(\/?)>|\{(\d+)\}/g, last = 0, m;
    var tmp = document.createElement('textarea');
    function txt(s) { if (!s) return; tmp.innerHTML = s; stack[stack.length - 1].appendChild(document.createTextNode(tmp.value)); }
    while ((m = re.exec(text))) {
      txt(text.slice(last, m.index)); last = re.lastIndex;
      if (m[4] != null) { var v = u.nums[Number(m[4]) - 1]; if (v == null) return false; stack[stack.length - 1].appendChild(document.createTextNode(v)); continue; }
      var t = u.tags[Number(m[2]) - 1];
      if (!t) return false;
      if (m[3]) { if (t.open) return false; stack[stack.length - 1].appendChild(t.node.cloneNode(true)); continue; }
      if (m[1]) { if (stack.length < 2) return false; stack.pop(); continue; }
      if (!t.open) return false;
      var c = t.node.cloneNode(false);
      stack[stack.length - 1].appendChild(c); stack.push(c);
    }
    if (stack.length !== 1) return false;
    txt(text.slice(last));
    while (el.firstChild) el.removeChild(el.firstChild);
    el.appendChild(frag);
    return true;
  }

  var done = new WeakMap();       /* element → key of what we wrote */
  var missing = {}, missingN = 0, reportTimer = 0;
  var reported = {};
  try { (JSON.parse(sessionStorage.getItem('glv-i18n-sent') || '[]') || []).forEach(function (h) { reported[h] = 1; }); } catch (e) {}
  /* Lines the server declined (a university's name, a code): kept on this
     device so they are not reported on every visit. */
  var declined = {};
  try { (JSON.parse(localStorage.getItem('glv-i18n-no') || '[]') || []).forEach(function (h) { declined[h] = 1; }); } catch (e) {}

  function miss(key, h, kind) {
    if (reported[h] || declined[h] || missing[h] || missingN >= 400) return;
    missing[h] = { key: key, kind: kind }; missingN++;
    if (!reportTimer) reportTimer = setTimeout(report, 2000);
  }
  function report() {
    reportTimer = 0;
    var units = [], hs = [];
    for (var h in missing) { units.push({ key: missing[h].key, kind: missing[h].kind }); hs.push(h); reported[h] = 1; }
    missing = {}; missingN = 0;
    if (!units.length) return;
    try { sessionStorage.setItem('glv-i18n-sent', JSON.stringify(Object.keys(reported).slice(-400))); } catch (e) {}
    try {
      fetch('/api/i18n/learn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', keepalive: true,
        body: JSON.stringify({ page: PAGE, path: location.pathname, units: units }) })
        .then(function (r) { return r.json(); }).then(function (j) {
          if (j && Array.isArray(j.declined) && j.declined.length) {
            j.declined.forEach(function (h) { declined[h] = 1; });
            try { localStorage.setItem('glv-i18n-no', JSON.stringify(Object.keys(declined).slice(-3000))); } catch (e) {}
          }
        }).catch(function () {});
    } catch (e) {}
  }

  function marked(el) { var f = el.firstChild; return !!(f && f.nodeType === 8 && f.nodeValue === 't'); }
  /* Inside a unit already dealt with — by the server (the comment) or by
     this script — an inline child is not a unit of its own. */
  function handledAbove(el) {
    if (marked(el)) return true;
    for (var p = el.parentNode; p && p.nodeType === 1; p = p.parentNode) { if (done.has(p) || marked(p)) return true; }
    return false;
  }
  function translateEl(el) {
    if (inNo(el) || handledAbove(el)) return;
    if (!leafish(el) || offAt(el)) return;
    var u = keyOf(el);
    if (!u.key || u.key.length > 4000 || notWords(u.key)) return;
    /* What this script wrote, still as written: nothing to do. A script
       that has since redrawn the element in English gets it translated
       again. */
    if (done.get(el) === u.key) return;
    var h = hash(u.key);
    var t = D[h];
    if (t == null) { if (!done.has(el)) miss(u.key, h, 'js'); return; }
    if (render(el, t, u)) done.set(el, keyOf(el).key);
  }
  function translateAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i], v = el.getAttribute(a);
      if (!v || !v.trim()) continue;
      if (a === 'alt' && el.tagName !== 'IMG') continue;
      var mark = 'data-glv-' + a;
      if (el.getAttribute(mark) === v) continue;
      var nums = [];
      var key = v.replace(/\s+/g, ' ').replace(NUM, function (m) { nums.push(m); return '{' + nums.length + '}'; }).trim();
      if (!key || notWords(key)) continue;
      var h = hash(key), t = D[h];
      if (t == null) { miss(key, h, 'js'); continue; }
      var out = t.replace(/\{(\d+)\}/g, function (m, n) { return nums[Number(n) - 1] == null ? m : nums[Number(n) - 1]; });
      if (/<\/?\d+\/?>/.test(out)) continue;
      el.setAttribute(a, out); el.setAttribute(mark, out);
    }
  }
  function sweep(root) {
    if (!root || root.nodeType !== 1) return;
    if (inNo(root)) return;
    var all = root.querySelectorAll('*');
    var list = [root];
    for (var i = 0; i < all.length; i++) list.push(all[i]);
    for (var j = 0; j < list.length; j++) {
      var el = list[j];
      var tn = el.tagName.toLowerCase();
      if (SKIP[tn] || tn === 'html' || tn === 'head') continue;
      translateAttrs(el);
      /* an inline element inside a unit is part of that unit */
      if (INLINE[tn] && el.parentNode && el.parentNode.nodeType === 1 && leafish(el.parentNode)) continue;
      translateEl(el);
    }
    if (document.title && !done.has(document.head)) {
      var k = keyOf({ childNodes: [document.createTextNode(document.title)] });
      var ht = D[hash(k.key)];
      if (ht) { var tt = ht.replace(/\{(\d+)\}/g, function (m, n) { return k.nums[Number(n) - 1] || m; }); if (!/<\/?\d+\/?>/.test(tt)) { document.title = tt; done.set(document.head, 1); } }
    }
  }

  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(function () { pending = false; try { sweep(document.body); } catch (e) {} }, 60);
  }
  function boot() {
    try { sweep(document.body); } catch (e) {}
    try {
      new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type === 'attributes' || m.type === 'characterData' || (m.addedNodes && m.addedNodes.length)) { schedule(); return; }
        }
      }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label', 'alt'] });
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  /* A script that sends the visitor to an English address keeps them in
     their language: /dashboard → /zh/dashboard. Only our own public pages. */
  window.glvLang = LANG;
  window.glvHref = function (href) {
    if (LANG === 'en' || typeof href !== 'string' || href.charAt(0) !== '/' || href.charAt(1) === '/') return href;
    if (/^\/(zh|ar|es|ru|fr|pt|bn|tr)(\/|$)/.test(href)) return href;
    if (/^\/(api|js|images|logos|flags|assets|data|og|admin|counsellor|chat|home|catalogue|blog-admin|leads|leads-command|ops|marketing|partner|languages)(\/|$|\.)/.test(href)) return href;
    if (/\.[a-z0-9]{2,5}($|[?#])/i.test(href)) return href;
    if (href === '/') return '/' + LANG + '/';
    if (href.charAt(1) === '#' || href.charAt(1) === '?') return '/' + LANG + '/' + href.slice(1);
    return '/' + LANG + href;
  };
}());
