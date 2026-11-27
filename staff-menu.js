/*
 * Patch 329 (owner, 27 Nov: "in mobile top menu can be like a menu where we
 * click it, it opens, and we click them instead of displaying everything …
 * so that space is allocated … this is only for mobile").
 *
 * On a phone every office screen opened with the whole side menu laid out
 * across the top — seventeen links, the logo and the account card — before a
 * single line of the screen itself. Here, on screens 860px wide or less, the
 * menu folds into one bar: the logo, the name of the screen you are on, and a
 * Menu button. Pressing it opens the full list; choosing a screen goes there.
 * The page intro paragraph under the title is hidden on a phone too.
 *
 * Works with both menus the office screens use (.p-side with .p-nav, and
 * aside.rail with nav.nav). Laptops and tablets wider than 860px are untouched.
 */
(function () {
  if (window.__glvMenu) return; window.__glvMenu = true;
  var css = '.glv-mm-bar{display:none}.glv-mm-shade{display:none}'
    + '@media (max-width:860px){'
    + '.glv-mm{position:sticky!important;top:0;z-index:900;display:flex!important;flex-direction:row!important;flex-wrap:wrap!important;align-items:center!important;gap:10px!important;padding:8px 12px!important;min-height:0!important;height:auto!important;max-height:none!important;overflow:visible!important;box-shadow:0 2px 10px rgba(11,30,49,.18)}'
    + '.glv-mm > *{display:none!important}'
    + '.glv-mm > .glv-mm-logo{display:block!important;flex:none;margin:0!important}'
    + '.glv-mm > .glv-mm-logo img{max-height:34px!important;width:auto!important;height:auto!important}'
    + '.glv-mm > .glv-mm-bar{display:flex!important;flex:1;min-width:0;align-items:center;gap:8px;justify-content:flex-end}'
    + '.glv-mm-here{flex:1;min-width:0;color:#fff;font:700 14.5px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}'
    + '.glv-mm-btn{flex:none;display:inline-flex;align-items:center;gap:7px;border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.08);color:#fff;border-radius:10px;padding:8px 12px;font:700 13.5px/1 system-ui,-apple-system,Segoe UI,sans-serif;cursor:pointer}'
    + '.glv-mm-btn svg{width:18px;height:18px}'
    + '.glv-mm.glv-mm-open > *{display:revert!important}'
    + '.glv-mm.glv-mm-open > nav{display:flex!important;flex-direction:column!important;flex-wrap:nowrap!important;width:100%!important;flex-basis:100%!important;gap:2px!important;max-height:calc(100vh - 140px);max-height:calc(100dvh - 140px);overflow-y:auto!important;padding:6px 0!important;margin:0!important}'
    + '.glv-mm.glv-mm-open > nav a{display:flex!important;width:100%!important;padding:12px 10px!important;font-size:15px!important;border-radius:10px}'
    + '.glv-mm.glv-mm-open > :not(nav):not(.glv-mm-logo):not(.glv-mm-bar){flex-basis:100%!important;width:100%!important;margin:4px 0 0!important}'
    + '.glv-mm-shade{display:block;position:fixed;inset:0;background:rgba(11,30,49,.35);z-index:899}'
    + '.p-top > div > p, .p-top > p, .p-top > div > h1, .p-top > h1{display:none}'
    + '}';
  function init() {
    if (!window.matchMedia) return;
    var side = document.querySelector('aside.p-side, aside.rail');
    if (!side || side.classList.contains('glv-mm')) return;
    var nav = side.querySelector('nav');
    if (!nav) return;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    /* the logo: the first image block in the menu */
    var logo = side.querySelector('.p-logo, .logo, a.brand, .brand') || (side.querySelector('img') && side.querySelector('img').closest('a, div'));
    if (logo && logo.parentElement === side) logo.classList.add('glv-mm-logo');
    else if (logo) { var lw = document.createElement('div'); lw.className = 'glv-mm-logo'; lw.appendChild(logo.cloneNode(true)); side.insertBefore(lw, side.firstChild); }
    var on = nav.querySelector('a.on, a[aria-current="page"], a.active');
    var here = on ? on.textContent.replace(/\s+/g, ' ').trim() : (document.querySelector('h1') ? document.querySelector('h1').textContent.trim() : '');
    var bar = document.createElement('div');
    bar.className = 'glv-mm-bar';
    bar.innerHTML = '<span class="glv-mm-here"></span><button type="button" class="glv-mm-btn" aria-expanded="false" aria-label="Open the menu">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg><span>Menu</span></button>';
    bar.querySelector('.glv-mm-here').textContent = here;
    side.insertBefore(bar, (side.querySelector('.glv-mm-logo') || side.firstChild).nextSibling);
    side.classList.add('glv-mm');
    var btn = bar.querySelector('.glv-mm-btn'), shade = null;
    function setOpen(open) {
      side.classList.toggle('glv-mm-open', open);
      btn.setAttribute('aria-expanded', String(open));
      btn.querySelector('span').textContent = open ? 'Close' : 'Menu';
      if (open && !shade) { shade = document.createElement('div'); shade.className = 'glv-mm-shade'; shade.onclick = function () { setOpen(false); }; document.body.appendChild(shade); }
      if (!open && shade) { shade.remove(); shade = null; }
    }
    btn.addEventListener('click', function () { setOpen(!side.classList.contains('glv-mm-open')); });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
