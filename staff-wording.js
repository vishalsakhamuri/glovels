/* Patch 302: what the office calls the people on its files.
 *
 * "Student" or "Applicant" — the administrator chooses on the Command centre,
 * and every staff screen follows. Nothing in the data or the addresses
 * changes: this rewrites the words on the screen, and only the office's own
 * labels. What people wrote themselves (a message, a note, a lead's own
 * words), anything typed into a box, an email address, a web address and the
 * phrase "student visa" are left exactly as they are.
 */
(function () {
  var KEY = 'glvStaffNoun', noun = 'student';
  try { noun = localStorage.getItem(KEY) === 'applicant' ? 'applicant' : 'student'; } catch (e) { noun = 'student'; }
  var OWN = 'script,style,textarea,[contenteditable],[data-own-words],#thread,.thread,.lnote,.note,.wc-bub,.actlist,code,pre';
  var ATTRS = ['placeholder', 'title', 'aria-label'];
  var busy = false;
  function swap(t) {
    if (!t || !/student/i.test(t)) return t;
    return t
      .replace(/(^|[^@.\w\/=\-])(a|A)(\s+)(student)(?![\w@]|\s+visa|\.[a-z])/g, function (m, pre, a, sp) { return pre + (a === 'A' ? 'An' : 'an') + sp + 'applicant'; })
      .replace(/(^|[^@.\w\/=\-])(STUDENT|Student|student)(S|s)?(?![\w@]|\s+visa|\.[a-z])/g, function (m, pre, w, s) {
        var out = w === 'STUDENT' ? 'APPLICANT' : w === 'Student' ? 'Applicant' : 'applicant';
        return pre + out + (s || '');
      });
  }
  function owned(el) { return !!(el && el.closest && el.closest(OWN)); }
  function walk(root) {
    if (!root || noun !== 'applicant') return;
    if (root.nodeType === 3) { if (!owned(root.parentElement)) { var v = swap(root.nodeValue); if (v !== root.nodeValue) root.nodeValue = v; } return; }
    if (root.nodeType !== 1 || owned(root)) return;
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), n, list = [];
    while ((n = tw.nextNode())) list.push(n);
    list.forEach(function (x) { if (!owned(x.parentElement)) { var v = swap(x.nodeValue); if (v !== x.nodeValue) x.nodeValue = v; } });
    var els = [root].concat([].slice.call(root.querySelectorAll('[placeholder],[title],[aria-label]')));
    els.forEach(function (el) {
      if (owned(el)) return;
      ATTRS.forEach(function (a) { var cur = el.getAttribute && el.getAttribute(a); if (cur) { var v = swap(cur); if (v !== cur) el.setAttribute(a, v); } });
    });
  }
  function run() {
    if (noun !== 'applicant' || busy) return;
    busy = true;
    try { walk(document.body); if (document.title) { var t = swap(document.title); if (t !== document.title) document.title = t; } } finally { busy = false; }
  }
  function start() {
    run();
    try {
      new MutationObserver(function (muts) {
        if (noun !== 'applicant' || busy) return;
        busy = true;
        try {
          muts.forEach(function (m) {
            if (m.type === 'characterData') walk(m.target);
            else if (m.type === 'attributes') walk(m.target);
            else [].forEach.call(m.addedNodes || [], walk);
          });
        } finally { busy = false; }
      }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    } catch (e) { /* an old browser keeps the first pass */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  /* The office's choice, from the server: kept for the next page, and applied
     to this one if it differs from what this browser remembered. */
  window.glvStaffNoun = function () { return noun; };
  window.glvSetStaffNoun = function (v) {
    var next = v === 'applicant' ? 'applicant' : 'student';
    try { localStorage.setItem(KEY, next); } catch (e) { /* private window */ }
    if (next === noun) return;
    if (next === 'applicant') { noun = next; run(); } else location.reload();
  };
  try {
    fetch('/api/staff/wording', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.noun) window.glvSetStaffNoun(j.noun); })
      .catch(function () { /* the remembered word stands */ });
  } catch (e) { /* no fetch: the remembered word stands */ }
})();
