"""
The script the home page runs to paint itself from the operations site.

It does four things, in this order:

  1. asks `/api/content` for what the office has edited;
  2. rebuilds the packages section, the headline numbers, the FAQ and the
     testimonials from that answer;
  3. updates `D.packages`, which is what the checkout sheet prices from, so the
     card and the sheet cannot disagree;
  4. walks the page and replaces any line of text that has been reworded.

Step 4 is the one with a trap in it, and the comment in `applyText` explains
how it is avoided. Everything here is defensive on purpose: if the server is
unreachable, or the answer is nonsense, the page is left exactly as it was
generated. A home page that shows last week's prices is a problem; a home page
that shows nothing is a catastrophe.
"""

SCRIPT = r"""
/* ---------------------------------------------------------------------------
   Glovels — live content. Edited in the operations site, applied here.
   --------------------------------------------------------------------------- */
(function () {
  'use strict';

  var E = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  var nf = new Intl.NumberFormat('en-IN');

  /* --------------------------------------------------------------- packages */

  var TAB_ICON = { study: 'cap', work: 'file', migrate: 'plane' };
  var ico = function (n) {
    return '<svg class="ico" aria-hidden="true"><use href="#i-' + n + '"/></svg>';
  };

  function card(p) {
    var out = '<article class="card card-hover card-stack pcard'
            + (p.featured ? ' featured' : '') + '">';
    if (p.ribbon) out += '<span class="ribbon">' + E(p.ribbon) + '</span>';
    out += '<div class="card-body">'
        +  '<div class="phead"><span class="pico">' + ico('compass') + '</span><h3>'
        +  E(p.title) + '</h3></div>'
        +  '<p class="pdesc">' + E(p.desc) + '</p>';
    if (p.unlocks) {
      out += '<div class="quota">' + ico('unlock') + '<span>Reveals <b>' + p.unlocks
          +  '</b> public universities</span></div>';
    }
    out += '<ul class="pfeat">' + (p.features || []).map(function (f) {
      return '<li>' + ico('check') + '<span>' + E(f) + '</span></li>';
    }).join('') + '</ul>';
    if (p.pledge && (p.pledge.title || p.pledge.body)) {
      out += '<div class="pledge ' + E(p.pledge.tone || 'green') + '"><b>'
          +  E(p.pledge.title) + '</b>' + E(p.pledge.body)
          +  (p.pledge.href
              ? '<small><a href="' + E(p.pledge.href) + '">'
                + E(p.pledge.linkText || 'Full terms') + '</a></small>'
              : '')
          +  '</div>';
    }
    /* "We should show it in feature part payment possible." A price somebody
       cannot pay today is a card they stop reading, so the alternative goes on
       the card rather than being found at the checkout. */
    /* The same arithmetic the checkout will use, not a fresh 40%. A card that
       says ₹4,800 to start and a checkout that then asks for ₹6,800 is a card
       nobody believes twice. */
    var parts = (typeof partsFor === 'function' && p.sell) ? partsFor(p.priceInr) : null;
    if (parts) {
      out += '<div class="partline">'
          +  '<svg class="ico" aria-hidden="true"><use href="#i-wallet"/></svg>'
          +  '<span>Part payment possible \u2014 \u20b9' + nf.format(parts[0].inr)
          +  ' to start, ' + parts.length + ' parts</span></div>';
    }
    out += '</div><div class="card-foot prow-cta">';
    if (p.sell) {
      out += '<div class="price"><span class="from">' + E(p.priceFrom || 'From') + '</span>₹'
          +  nf.format(p.priceInr)
          +  (p.priceNote ? '<span class="note">' + E(p.priceNote) + '</span>' : '')
          +  '</div>'
          +  '<button class="btn ' + (p.primary ? 'btn-primary' : 'btn-ghost')
          +  '" data-buy="' + E(p.id) + '">' + E(p.cta) + '</button>';
    } else {
      out += '<div class="pquote">' + E(p.quote)
          +  (p.quoteSmall ? '<small>' + E(p.quoteSmall) + '</small>' : '') + '</div>'
          +  '<a class="btn ' + (p.primary ? 'btn-primary' : 'btn-ghost') + '" href="'
          +  E(p.ctaHref || '#counsel') + '">' + E(p.cta) + '</a>';
    }
    return out + '</div></article>';
  }

  function paintPackages(pk) {
    var host = document.getElementById('packages');
    if (!host || !pk || !pk.items || !pk.items.length) return;
    var wrap = host.querySelector('.wrap');
    if (!wrap) return;

    var live = pk.items.filter(function (p) { return p.active !== false; });
    if (!live.length) return;

    var tabs = (pk.tabs || []).filter(function (t) {
      return live.some(function (p) { return p.tab === t.key; });
    });
    if (!tabs.length) return;

    var head = pk.eyebrow || pk.heading
      ? '<div class="sec-head"><span class="eyebrow">' + ico('cap') + ' ' + E(pk.eyebrow)
        + '</span><h2>' + E(pk.heading) + '</h2></div>'
      : '';

    /* Which tab is open now is a thing the visitor chose. Rebuilding the
       section under them and silently jumping back to the first tab is the
       kind of small rudeness that makes a page feel broken. */
    var openTab = (wrap.querySelector('[data-ptab][aria-selected="true"]') || {}).dataset;
    openTab = (openTab && openTab.ptab) || tabs[0].key;
    if (!tabs.some(function (t) { return t.key === openTab; })) openTab = tabs[0].key;

    wrap.innerHTML = head
      + '<div class="tabs" role="tablist" style="justify-content:center">'
      + tabs.map(function (t) {
          return '<button class="tab" data-ptab="' + E(t.key) + '" role="tab" aria-selected="'
               + (t.key === openTab ? 'true' : 'false') + '">'
               + ico(TAB_ICON[t.key] || 'cap') + E(t.label) + '</button>';
        }).join('')
      + '</div>'
      + tabs.map(function (t) {
          return '<div class="pane' + (t.key === openTab ? ' active' : '') + '" data-pane="'
               + E(t.key) + '"><div class="pgrid">'
               + live.filter(function (p) { return p.tab === t.key; }).map(card).join('')
               + '</div></div>';
        }).join('');
  }

  /* ---------------------------------------------- numbers, FAQ, testimonials */

  function paintStats(rows) {
    var grid = document.querySelector('.stat-grid');
    if (!grid || !rows || !rows.length) return;
    grid.innerHTML = rows.map(function (s) {
      return '<div class="stat"><span class="num">' + E(s.num) + '</span>'
           + '<span class="lbl">' + E(s.label)
           + (s.dummy ? '<span class="dummy-chip" title="Placeholder value">DUMMY</span>' : '')
           + '</span></div>';
    }).join('');
  }

  function paintFaq(rows) {
    var first = document.querySelector('details.faq');
    if (!first || !rows || !rows.length) return;
    var host = first.parentNode;
    /* Replace only the FAQ entries. The heading and the lead paragraph above
       them are ordinary page text and are edited as text, so the block they
       live in must survive. */
    [].slice.call(host.querySelectorAll('details.faq')).forEach(function (d, i) {
      if (i) d.remove();
    });
    first.outerHTML = rows.map(function (f) {
      return '<details class="faq"><summary>' + E(f.q)
           + (f.dummy ? '<span class="dummy-chip" title="Placeholder value">DUMMY</span>' : '')
           + '</summary><p>' + E(f.a) + '</p></details>';
    }).join('');
  }

  function paintTestimonials(rows) {
    var first = document.querySelector('article.tcard');
    if (!first || !rows || !rows.length) return;
    var host = first.parentNode;
    [].slice.call(host.querySelectorAll('article.tcard')).forEach(function (a, i) {
      if (i) a.remove();
    });
    first.outerHTML = rows.map(function (t) {
      return '<article class="card card-hover card-stack tcard"><div class="card-body">'
           + '<div class="trow">'
           + (t.route ? '<span class="route">' + E(t.route) + '</span>' : '')
           + (t.verified ? '<span class="vadm">' + ico('shield') + 'Verified admission</span>' : '')
           + (t.dummy ? '<span class="dummy-chip" title="Placeholder value">DUMMY</span>' : '')
           + '</div><blockquote>' + E(t.quote) + '</blockquote></div>'
           + '<div class="card-foot who"><span class="av">'
           + E((t.name || '?').trim().charAt(0).toUpperCase()) + '</span><span><b>'
           + E(t.name) + '</b><span>' + E(t.where) + '</span></span></div></article>';
    }).join('');
  }

  /* -------------------------------------------------------------- page text */

  /*
   * The same walk the extractor did, in the same order, computing the same
   * keys — see page_text.py. Two things keep it honest:
   *
   *   · it skips exactly the containers the extractor skipped, which are also
   *     the four blocks repainted above, so a repaint cannot shift the counts;
   *   · a replacement is applied only when the node still says what the server
   *     recorded it as saying. The page's own scripts add and remove nodes as
   *     they run, so this walk can drift; checking the text means a drifted
   *     walk changes nothing instead of changing the wrong sentence.
   */

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, SVG: 1, NOSCRIPT: 1, TEMPLATE: 1 };
  var TEXT_ATTRS = ['placeholder', 'alt', 'title', 'aria-label'];   // same order as Python

  function fnv1a(text) {
    var bytes = new TextEncoder().encode(text), h = 0x811c9dc5;
    for (var i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  var norm = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); };
  var worth = function (s) { return s.length >= 2 && /[A-Za-zÀ-ɏ]/.test(s); };

  function isSkipped(el) {
    if (SKIP_TAGS[el.tagName]) return true;
    if (el.id === 'packages') return true;
    var c = el.classList;
    return !!(c && (c.contains('stat-grid') || c.contains('faq')
                 || c.contains('tcard') || c.contains('dummy-chip')));
  }

  function walkText(apply) {
    var counts = Object.create(null);
    var secNo = 0;

    function keyFor(section, element, text) {
      var base = section + '|' + element + '|' + fnv1a(text);
      var n = counts[base] || 0;
      counts[base] = n + 1;
      return base + '|' + n;
    }

    function visit(el, section) {
      if (isSkipped(el)) return;

      var tag = el.tagName.toLowerCase();
      if (tag === 'section') {
        section = el.id || ('section-' + (++secNo));
      } else if (tag === 'header' || tag === 'footer') {
        section = tag;
      }

      if (tag === 'meta' && el.getAttribute('name') === 'description') {
        var d = norm(el.getAttribute('content'));
        if (worth(d)) apply(keyFor(section, 'meta-description', d), d, function (v) {
          el.setAttribute('content', v);
        });
      }
      TEXT_ATTRS.forEach(function (attr) {
        var v = norm(el.getAttribute(attr));
        if (!v || !worth(v)) return;
        apply(keyFor(section, 'attr:' + attr, v), v, function (nv) { el.setAttribute(attr, nv); });
      });

      for (var n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 1) { visit(n, section); continue; }
        if (n.nodeType !== 3) continue;
        var t = norm(n.nodeValue);
        if (!worth(t)) continue;
        var kind = tag === 'title' ? 'title' : tag;
        (function (node) {
          apply(keyFor(section, kind, t), t, function (v) { node.nodeValue = v; });
        }(n));
      }
    }

    visit(document.documentElement, 'page');
  }

  function applyText(map) {
    if (!map) return;
    var keys = Object.keys(map);
    if (!keys.length) return;
    var done = 0;
    walkText(function (key, current, set) {
      var o = map[key];
      if (!o || o.from !== current) return;      // not this node, or already right
      set(o.to);
      done++;
    });
    return done;
  }

  /* ------------------------------------------------------------------ boot */

  function sync(data) {
    if (!data) return;
    try { paintPackages(data.packages); } catch (e) { console.warn('packages', e); }
    try { paintStats(data.stats); } catch (e) { console.warn('numbers', e); }
    try { paintFaq(data.faq); } catch (e) { console.warn('faq', e); }
    try { paintTestimonials(data.testimonials); } catch (e) { console.warn('stories', e); }

    /* The checkout sheet prices from D.packages, not from the card. If only the
       card were repainted, a student would be shown ₹9,999 and charged last
       month's number — so the two are updated together or not at all. */
    try {
      /* Through a named hook, not by touching `D` directly. `D` is declared
         with `const` inside the page's own IIFE: it is neither a property of
         `window` nor in scope here, so both of the obvious ways to reach it
         fail silently and the sheet keeps quoting last month's price. The
         page hands out one setter; this calls it. */
      var setPackages = window.__glovelsSetPackages;
      if (typeof setPackages === 'function' && data.packages
          && data.packages.items && data.packages.items.length) {
        setPackages(data.packages.items
          .filter(function (p) { return p.active !== false; })
          .map(function (p) {
            return {
              id: p.id, tab: p.tab, name: p.title, desc: p.desc,
              priceInr: p.sell ? p.priceInr : null,
              pricePrefix: p.priceFrom, priceNote: p.priceNote,
              quoteNote: p.quote, ribbon: p.ribbon,
              features: p.features || [],
              pledgeTitle: (p.pledge && p.pledge.title) || '',
              pledgeBody: (p.pledge && p.pledge.body) || '',
              pledgeTone: (p.pledge && p.pledge.tone) || '',
              pledgeTerms: (p.pledge && p.pledge.href) || '',
              sellTier: p.sell ? 'call' : 'quote',
              buyable: !!p.sell, publicUnis: p.unlocks || 0,
              consent: p.consent || '', cta: p.cta,
              /* The sentence every buyer ticks, whatever they bought. It comes
                 from the server so the words on the screen and the words
                 recorded against the order are the same string. */
              acceptance: data.packages.acceptance || '',
            };
          }));
      }

      /* "Public university matches unlock with a package — from ₹9,999."
         It was ₹4,999 the moment a cheaper package revealed public names, and
         the sentence was a hand-typed number that nobody would think to
         change. So it is computed: the cheapest package on sale that unlocks
         any public university name at all. Wrong by construction is worse than
         wrong by accident — this one cannot drift again. */
      var sellable = (data.packages && data.packages.items || []).filter(function (p) {
        return p.active !== false && p.sell && Number(p.unlocks) > 0
          && Number(p.priceInr) > 0;
      });
      if (sellable.length) {
        var from = Math.min.apply(null, sellable.map(function (p) {
          return Number(p.priceInr);
        }));
        var said = '\u20b9' + from.toLocaleString('en-IN');
        Array.prototype.forEach.call(
          document.querySelectorAll('[data-pkg-from]'),
          function (el) { el.textContent = said; });
      }
    } catch (e) { console.warn('prices', e); }

    /* The a-la-carte services grid. Same story as the packages: frozen in the
       page, so a price change meant a developer. */
    try {
      var setSvc = window.__glovelsSetServices;
      if (typeof setSvc === 'function' && data.services
          && data.services.items && data.services.items.length) {
        setSvc(data.services.items
          .filter(function (x) { return x.active !== false; })
          .map(function (x) {
            return {
              id: x.id, name: x.name, desc: x.desc, meta: x.meta,
              cats: x.cats || [], posTop: x.posTop || 0,
              priceInr: x.priceInr || 0, priceLabel: x.priceLabel || '',
              isFree: !!x.isFree, levels: x.levels || [], badge: x.badge || '',
              ai: x.ai || '',
              cta: x.ctaLabel ? { label: x.ctaLabel, href: x.ctaHref || '#counsel' } : null,
              ctaGreen: !!x.ctaGreen, partners: x.partners || [],
            };
          }));
      }
    } catch (e) { console.warn('services', e); }

    /* The showcase grid on the home page. It was rendering a list frozen at
       build time, so a university added on the Catalogue screen never reached
       the one place a visitor browses what is on offer. */
    try {
      var setCat = window.__glovelsSetCatalogue;
      if (typeof setCat === 'function') {
        fetch('/api/catalogue', { credentials: 'same-origin' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (c) {
            if (!c || !c.programmes || !c.programmes.length) return;
            setCat(c.programmes.map(function (p) {
              return {
                id: p.id, country: p.country, level: p.level || '',
                field: p.field || '', fieldGroup: p.field || '',
                band: p.band || 'u20', isPublic: !!p.isPublic,
                program: p.program || '', university: p.university || '',
                city: p.city || '', totalInr: p.totalInr || 0,
                fit: p.fit || 75, uKey: p.uKey || ('u' + p.id),
                intakes: p.intakes || [], minCgpa: null,
                freeTuition: (p.totalInr || 0) === 0,
                featured: !!p.featured, featureSort: p.featureSort || 0,
                nLen: p.nLen, uLen: p.uLen,
              };
            }));
          })
          .catch(function () {});
      }
    } catch (e) { console.warn('showcase', e); }

    try { applyText(data.text); } catch (e) { console.warn('wording', e); }

    document.dispatchEvent(new CustomEvent('glovels:content', { detail: data }));
  }

  function go() {
    fetch('/api/content', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(sync)
      /* Offline, or opened as a file. The page was generated with real content
         in it, so leaving it alone is the correct outcome, not an error. */
      .catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
  else go();
}());
"""
