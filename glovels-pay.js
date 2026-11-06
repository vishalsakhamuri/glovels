/* GLOVELS-RAZORPAY — patch 185
 *
 * The one checkout script, loaded by the home page, Services and the
 * dashboard. It used to live inline in index.html only, so Services and the
 * dashboard called window.__glovelsCollect and found nothing there.
 *
 * Paying in your own currency: the price is set in rupees and the server
 * converts it with the office's exchange rates. The browser only says which
 * currency the buyer picked. The amount the card sheet opens with comes back
 * from the server, which also tells Razorpay.
 */
(function () {
  'use strict';
  if (window.__glovelsCollect && window.glovelsPay) return;

  var SDK = 'https://checkout.razorpay.com/v1/checkout.js';
  var KEY = 'glv-pay-currency';
  var SYMBOL = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$' };
  var NAME = { INR: 'Indian rupees', USD: 'US dollars', EUR: 'Euros', GBP: 'British pounds',
               AUD: 'Australian dollars', CAD: 'Canadian dollars' };
  var loading = null;
  var cfgP = null;

  function sdk() {
    if (window.Razorpay) return Promise.resolve(window.Razorpay);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = SDK;
      s.onload = function () {
        window.Razorpay ? resolve(window.Razorpay)
                        : reject(new Error('The payment window did not load.'));
      };
      s.onerror = function () {
        loading = null;
        reject(new Error('The payment window could not be reached. Check your connection '
          + 'and try again — nothing has been charged.'));
      };
      document.head.appendChild(s);
    });
    return loading;
  }

  function config() {
    if (cfgP) return cfgP;
    cfgP = fetch('/api/pay/config', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; })
      .then(function (c) {
        c = c || {};
        c.currencies = Array.isArray(c.currencies) && c.currencies.length ? c.currencies : ['INR'];
        c.fx = c.fx || { INR: 1 };
        return c;
      });
    return cfgP;
  }

  /* A first guess from the clock the visitor's device keeps (time zone →
     country → currency). India, and anything unknown, stays in rupees; a
     country whose money Razorpay does not take (Argentina, Venezuela) gets
     US dollars. */
  var TZ = {
    'Asia/Kolkata': 'INR', 'Asia/Calcutta': 'INR', 'Asia/Kathmandu': 'NPR', 'Asia/Katmandu': 'NPR',
    'Asia/Colombo': 'LKR', 'Asia/Dhaka': 'BDT', 'Asia/Dacca': 'BDT', 'Asia/Karachi': 'PKR',
    'Indian/Maldives': 'MVR', 'Asia/Thimphu': 'INR',
    'Asia/Kuala_Lumpur': 'MYR', 'Asia/Kuching': 'MYR', 'Asia/Jakarta': 'IDR', 'Asia/Pontianak': 'IDR',
    'Asia/Makassar': 'IDR', 'Asia/Jayapura': 'IDR', 'Asia/Ho_Chi_Minh': 'VND', 'Asia/Saigon': 'VND',
    'Asia/Bangkok': 'THB', 'Asia/Manila': 'PHP', 'Asia/Singapore': 'SGD', 'Asia/Phnom_Penh': 'KHR',
    'Asia/Dubai': 'AED', 'Asia/Riyadh': 'SAR', 'Asia/Qatar': 'QAR', 'Asia/Kuwait': 'KWD',
    'Asia/Bahrain': 'BHD', 'Asia/Muscat': 'OMR', 'Asia/Amman': 'JOD', 'Asia/Baghdad': 'IQD',
    'Africa/Cairo': 'EGP', 'Europe/Istanbul': 'TRY', 'Asia/Istanbul': 'TRY',
    'Africa/Lagos': 'NGN', 'Africa/Nairobi': 'KES', 'Africa/Accra': 'GHS', 'Africa/Johannesburg': 'ZAR',
    'Africa/Dar_es_Salaam': 'TZS', 'Africa/Kampala': 'UGX', 'Africa/Kigali': 'RWF',
    'Africa/Addis_Ababa': 'ETB', 'Africa/Lusaka': 'ZMW', 'Africa/Blantyre': 'MWK', 'Africa/Maputo': 'MZN',
    'Africa/Gaborone': 'BWP', 'Africa/Windhoek': 'NAD', 'Indian/Mauritius': 'MUR',
    'Africa/Casablanca': 'MAD', 'Africa/Algiers': 'DZD', 'Africa/Tunis': 'TND',
    'Africa/Dakar': 'XOF', 'Africa/Abidjan': 'XOF', 'Africa/Bamako': 'XOF', 'Africa/Ouagadougou': 'XOF',
    'Africa/Niamey': 'XOF', 'Africa/Lome': 'XOF', 'Africa/Porto-Novo': 'XOF',
    'Africa/Douala': 'XAF', 'Africa/Libreville': 'XAF', 'Africa/Brazzaville': 'XAF',
    'Africa/Ndjamena': 'XAF', 'Africa/Bangui': 'XAF', 'Africa/Malabo': 'XAF',
    'America/Sao_Paulo': 'BRL', 'America/Manaus': 'BRL', 'America/Fortaleza': 'BRL',
    'America/Recife': 'BRL', 'America/Bahia': 'BRL', 'America/Belem': 'BRL', 'America/Cuiaba': 'BRL',
    'America/Santiago': 'CLP', 'America/Bogota': 'COP', 'America/Lima': 'PEN',
    'America/Montevideo': 'UYU', 'America/La_Paz': 'BOB', 'America/Asuncion': 'PYG',
    'Europe/London': 'GBP', 'Europe/Zurich': 'CHF', 'Pacific/Auckland': 'NZD'
  };
  function guess() {
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { tz = ''; }
    if (!tz) return 'INR';
    if (TZ[tz]) return TZ[tz];
    if (/^Europe\//.test(tz) || tz === 'Atlantic/Canary' || tz === 'Atlantic/Madeira') return 'EUR';
    if (/^Australia\//.test(tz)) return 'AUD';
    if (/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Montreal|Moncton|Whitehorse|Yellowknife|Iqaluit|Glace_Bay|Goose_Bay|Swift_Current|Dawson_Creek|Fort_Nelson)$/.test(tz)) return 'CAD';
    return 'USD';
  }

  function stored() {
    try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }

  /** The currency to charge in: the buyer's pick, else the guess, if the
   *  office takes it, else rupees. */
  /* Patch 215 (owner: "why did it not pick my IP"): a second witness. The
     device clock's continent must agree with the continent of the currency
     the IP lookup found — a phone set to Europe/Rome is not in Singapore,
     whatever an address on the way said. When they disagree the clock wins
     and the country is left for the visitor to pick. */
  function geoOk(cfg) {
    var g = cfg && cfg.geo; if (!g || !g.currency) return false;
    var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { tz = ''; }
    var cont = tz.split('/')[0]; if (!cont || tz === 'UTC' || cont === 'Etc') return true;
    var reg = ''; ((cfg && cfg.regions) || []).forEach(function (r) { if ((r.currencies || []).indexOf(g.currency) >= 0) reg = r.name; });
    if (!reg || g.currency === 'USD') return true;
    var fits = { Europe: ['Europe'], Africa: ['Africa', 'Middle East'], America: ['North America', 'South America', 'Central America & Caribbean'],
      Asia: ['South Asia', 'Middle East', 'South-East Asia', 'East Asia', 'Central Asia & Caucasus'], Australia: ['Oceania'], Pacific: ['Oceania'],
      Indian: ['South Asia', 'Africa'], Atlantic: ['Europe', 'Africa', 'North America'], Antarctica: [] }[cont];
    return !fits || fits.indexOf(reg) >= 0;
  }
  function current(cfg) {
    var list = (cfg && cfg.currencies) || ['INR'];
    /* Their own pick first; then the country their IP is in (server) — if
       the device clock agrees; then the clock on their device. */
    var pick = stored() || (geoOk(cfg) ? cfg.geo.currency : '') || guess();
    if (list.indexOf(pick) >= 0) return pick;
    return pick !== 'INR' && list.indexOf('USD') >= 0 ? 'USD' : 'INR';
  }

  function set(code) {
    try { localStorage.setItem(KEY, String(code || 'INR')); } catch (e) { /* this visit only */ }
  }

  /** The same sum the server does (server/fx.js): rupees over rupees-per-
   *  unit, rounded UP to a whole unit and to about four significant figures,
   *  so the office never takes less than the rupee price. */
  function nice(x) {
    /* Patch 241: nothing costs nothing — a free service is not 1 unit. */
    if (!(x > 0)) return 0;
    var units = Math.max(1, Math.ceil(x - 1e-9));
    var step = units >= 10000 ? Math.pow(10, Math.floor(Math.log10(units)) - 3) : 1;
    return Math.ceil(units / step) * step;
  }
  function convert(inr, code, cfg) {
    var r = Number(((cfg && cfg.fx) || {})[code]);
    if (code === 'INR' || !(r > 0)) return inr;
    return nice(inr / r);
  }

  /* Patch 192 (owner): the price is the same for a buyer abroad — no GST is
     charged, but nothing is taken off either. */
  /* Patch 209 (owner): a buyer in the EU paying in a foreign currency pays the
     price plus VAT (19% unless the office changes it) — the same rule the
     server charges by. Glovels' own prices only; university fees are not ours. */
  function chosenCountry() { try { return localStorage.getItem('glv-country') || ''; } catch (e) { return ''; } }
  function vatOf(cfg) {
    var v = cfg && cfg.euVat;
    if (!v || !v.on) return 0;
    var geo = (cfg.geo && geoOk(cfg) && cfg.geo.country) || '';
    if (geo === 'IN') return 0;
    var eu = v.countries || [];
    return eu.indexOf(geo) >= 0 || eu.indexOf(chosenCountry()) >= 0 ? Number(v.rate) || 19 : 0;
  }
  function exg(inr, cfg, code) {
    var x = Math.round(Number(inr || 0));
    var r = code && code !== 'INR' ? vatOf(cfg) : 0;
    return r ? Math.round(x * (1 + r / 100)) : x;
  }
  function local(inr, code, cfg) { return money(convert(exg(inr, cfg, code), code, cfg), code); }

  function money(n, code) {
    try {
      return new Intl.NumberFormat(code === 'INR' ? 'en-IN' : 'en',
        { style: 'currency', currency: code, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(n);
    } catch (e) {
      return (SYMBOL[code] || code + ' ') + String(n);
    }
  }
  /* patch 265: names in the page's language (the browser knows them). */
  function uiLang() { var l = (document.documentElement.getAttribute('lang') || 'en').slice(0, 2).toLowerCase(); return /^(zh|ar|es|ru|fr|pt|bn|tr)$/.test(l) ? l : 'en'; }
  function nameOf(code) {
    try { return new Intl.DisplayNames([uiLang(), 'en'], { type: 'currency' }).of(code) || NAME[code] || code; }
    catch (e) { return NAME[code] || code; }
  }

  /* The rupee figure a "Confirm — ₹74,999" button is showing. */
  function rupeesOn(btn) {
    var kept = Number(btn && btn.getAttribute && btn.getAttribute('data-glv-inr'));
    if (kept) return kept;
    var t = String((btn && btn.textContent) || '');
    var m = /₹\s*([\d,]+)/.exec(t);
    return m ? Number(m[1].replace(/,/g, '')) : 0;
  }

  /**
   * A "Pay in [currency]" line above a checkout button. It reads the rupee
   * amount the button already shows, and follows it when the button changes
   * (full price or first part).
   */
  function attach(btn) {
    if (!btn || btn.__glvCur) return;
    btn.__glvCur = true;
    config().then(function (cfg) {
      if (!cfg.enabled || cfg.currencies.length < 2 || !btn.parentNode) return;
      var box = document.createElement('div');
      box.className = 'glv-cur';
      box.style.cssText = 'margin:12px 0 0;padding:10px 12px;border:1px solid #e3e7ec;border-radius:10px;'
        + 'background:#f8fafc;font:500 12.6px/1.5 var(--sans,system-ui,sans-serif);color:#25344a';
      var opt = function (c) { return '<option value="' + c + '">' + c + ' — ' + nameOf(c) + '</option>'; };
      var opts = Array.isArray(cfg.regions) && cfg.regions.length
        ? cfg.regions.map(function (g) {
            return '<optgroup label="' + g.name + '">' + g.currencies.map(opt).join('') + '</optgroup>';
          }).join('')
        : cfg.currencies.map(opt).join('');
      box.innerHTML = '<label style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
        + '<span style="font-weight:600">Pay in</span>'
        + '<select class="glv-cur-sel" aria-label="Currency to pay in" style="padding:6px 8px;border:1.5px solid #d8dde4;'
        + 'border-radius:8px;background:#fff;font:inherit;max-width:100%">' + opts + '</select></label>'
        + '<div class="glv-cur-q" aria-live="polite" style="margin-top:6px;color:#4a5a70"></div>';
      btn.parentNode.insertBefore(box, btn);
      var sel = box.querySelector('select');
      var q = box.querySelector('.glv-cur-q');
      sel.value = current(cfg);
      var paint = function () {
        var code = sel.value;
        var inr = rupeesOn(btn);
        if (!inr) { q.textContent = ''; return; }
        if (code === 'INR') {
          q.textContent = 'You pay ' + money(inr, 'INR') + '. UPI, cards, netbanking and wallets — cards from any country work too.';
          return;
        }
        /* Patch 260 (owner, 4 Nov): no tax talk for a buyer abroad — "who
           knows what GST is". The price is the price; the invoice carries the
           tax line. */
        q.textContent = 'You’ll be charged about ' + local(inr, code, cfg)
          + ' at today’s rate. International cards accepted. Your bank may add its own conversion fee.';
      };
      sel.onchange = function () {
        set(sel.value); paint();
        try { document.dispatchEvent(new CustomEvent('glv-currency', { detail: sel.value })); } catch (e) {}
      };
      /* Two checkouts on one page keep the same choice. */
      document.addEventListener('glv-currency', function (ev) {
        if (ev.detail && sel.value !== ev.detail) { sel.value = ev.detail; paint(); }
      });
      paint();
      try {
        new MutationObserver(paint).observe(btn, { childList: true, characterData: true, subtree: true });
      } catch (e) { /* the line is still right for the first price */ }
    });
  }

  /** What to send with an order: the currency the buyer picked. */
  var CFG = null;
  function chosen() {
    var s = stored() || (CFG && CFG.geo && CFG.geo.currency) || guess();
    return /^[A-Z]{3}$/.test(s) ? s : 'INR';
  }

  /*
   * Resolves when the money is in, rejects with something worth reading.
   *
   * `d` is the answer from /api/orders (or /pay-part). No gateway on this site
   * means no `d.razorpay`, and then there is nothing to collect.
   */
  window.__glovelsCollect = function (d) {
    /* Patch 195: a buyer outside India pays on Stripe's own page (Glovels
       UG). We go there; the server asks Stripe when they come back, so this
       promise never resolves on this page — the next page says what happened. */
    if (d && d.stripe && d.stripe.url) {
      if (window.glvTrack) try { window.glvTrack('begin_checkout', { transaction_id: d.reference, currency: 'INR',
        value: Math.round(Number(d.stripe.amountPaise || 0) / 100) || undefined }); } catch (e) {}
      location.assign(d.stripe.url);
      return new Promise(function () {});
    }
    if (!d || !d.razorpay) return Promise.resolve(d);
    var cur = d.razorpay.currency || 'INR';
    var amount = d.razorpay.amountMinor != null ? d.razorpay.amountMinor : d.razorpay.amountPaise;

    return sdk().then(function (Razorpay) {
      return new Promise(function (resolve, reject) {
        var settled = false;
        var rzp = new Razorpay({
          key: d.razorpay.keyId,
          order_id: d.razorpay.orderId,
          amount: amount,
          currency: cur,
          name: 'Glovels',
          description: d.package || 'Glovels',
          prefill: { name: d.buyerName || '', email: d.buyerEmail || '',
                     contact: d.buyerPhone || '' },
          notes: { reference: d.reference },
          theme: { color: '#0b1e31' },

          handler: function (r) {
            settled = true;
            /* The browser saying it worked is not the same as it having worked.
               The server checks the signature; until it answers, nothing on
               this page may claim a payment. */
            fetch('/api/orders/' + encodeURIComponent(d.reference) + '/paid', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({
                razorpay_order_id: r.razorpay_order_id,
                razorpay_payment_id: r.razorpay_payment_id,
                razorpay_signature: r.razorpay_signature
              })
            })
              .then(function (res) { return res.json().then(function (j) {
                return { ok: res.ok, j: j }; }); })
              .then(function (out) {
                if (!out.ok) throw new Error(out.j.error || 'That payment could not be confirmed.');
                /* Analytics stays in rupees, the currency the prices are set in. */
                if (window.glvTrack) window.glvTrack('purchase', { transaction_id: d.reference, currency: 'INR',
                  value: Math.round(Number(d.razorpay.amountPaise || d.grossPaise || 0) / 100) || undefined });
                resolve(d);
              })
              .catch(function (e) {
                /* Money may well have left their account — the webhook will
                   settle it. Never tell them it failed. */
                reject(new Error(e.message + ' Your reference is ' + d.reference
                  + ' — quote it and we will find the payment.'));
              });
          },

          modal: {
            ondismiss: function () {
              if (settled) return;
              reject(new Error('The payment window was closed, so nothing has been charged. '
                + 'Your order is held under ' + d.reference + ' if you would like to try again.'));
            }
          }
        });

        rzp.on('payment.failed', function (e) {
          settled = true;
          var why = (e && e.error && e.error.description) || 'The payment did not go through.';
          reject(new Error(why + ' Nothing has been charged.'));
        });

        rzp.open();
      });
    });
  };

  /* Patch 195: back from Stripe — say what happened, in words, once. */
  (function backFromStripe() {
    var q; try { q = new URLSearchParams(location.search); } catch (e) { return; }
    var ref = q.get('ref') || q.get('paid') || '';
    var state = q.get('paid') ? 'paid' : q.get('payment');
    if (!state || !/^(paid|processing|cancelled)$/.test(state)) return;
    var text = state === 'paid'
      ? 'Payment received — thank you. Your order ' + ref + ' is paid.'
      : state === 'processing'
        ? 'Your payment for ' + ref + ' is being confirmed. It shows as paid here as soon as Stripe confirms it — no need to pay again.'
        : 'The payment was cancelled, so nothing has been charged. Your order ' + ref + ' is held if you would like to try again.';
    var show = function () {
      var bar = document.createElement('div');
      bar.setAttribute('role', 'status');
      bar.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;max-width:560px;margin:0 auto;'
        + 'padding:12px 40px 12px 14px;border-radius:12px;font:14px/1.5 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.18);'
        + 'background:' + (state === 'cancelled' ? '#fff4e5;color:#5a3a00' : '#e9f7ef;color:#0b3d22');
      bar.textContent = text;
      var x = document.createElement('button');
      x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.textContent = '\u00d7';
      x.style.cssText = 'position:absolute;right:8px;top:6px;border:0;background:none;font-size:20px;cursor:pointer;color:inherit';
      x.onclick = function () { bar.remove(); };
      bar.appendChild(x);
      document.body.appendChild(bar);
      try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
    };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  })();

  /* A mobile from anywhere: digits with + ( ) - and spaces, 8 to 15 digits —
     the same rule the server applies. */
  function phoneOk(v) {
    v = String(v || '').trim();
    if (!/^\+?[\d\s().-]+$/.test(v)) return false;
    var n = v.replace(/\D/g, '').length;
    return n >= 8 && n <= 15;
  }

  /*
   * Patch 193: university fees (tuition + living — not our price, so no GST
   * question) in the visitor's currency, for the finders. Returns null in
   * rupees, so the page keeps its own lakh/crore format for India.
   */
  function fee(inr) {
    if (!CFG) return null;
    var code = current(CFG);
    var r = Number((CFG.fx || {})[code]);
    if (code === 'INR' || !(r > 0)) return null;
    var v = Number(inr || 0) / r;
    /* Rounded up like the checkout, so a figure here never undercuts it. */
    if (v < 1e6) v = Math.ceil(v - 1e-9);
    /* Patch 226: ceil(0 - tiny) is -0, which printed "-€0 tuition". */
    v = Math.max(0, v) || 0;
    try {
      return new Intl.NumberFormat('en', { style: 'currency', currency: code,
        notation: v >= 1e6 ? 'compact' : 'standard', maximumFractionDigits: v >= 1e6 ? 1 : 0,
        minimumFractionDigits: 0 }).format(v);
    } catch (e) { return code + ' ' + Math.round(v).toLocaleString('en'); }
  }
  function code() { return CFG ? current(CFG) : 'INR'; }

  /* Patch 274: every phone box gets a searchable country code. Loaded from
     here so every page that has this script has it, and no office screen. */
  (function () {
    if (document.querySelector('script[src^="/js/phone.js"]')) return;
    var s = document.createElement('script'); s.src = '/js/phone.js?v=274'; s.defer = true;
    (document.head || document.documentElement).appendChild(s);
  }());

  window.glovelsPay = { config: config, guess: guess, attach: attach, chosen: chosen, fee: fee, code: code,
    set: function (c) { set(c); try { document.dispatchEvent(new CustomEvent('glv-currency', { detail: c })); } catch (e) {} },
    convert: convert, money: money, phoneOk: phoneOk,
    PHONE_MSG: 'A mobile number, please — add the country code if you are outside India' };

  /*
   * Patch 188: every price on the page in the visitor's own money, as THE
   * price. For a visitor in Germany a card reads "€97" in the big figure with
   * "₹9,999" small beside it; in India nothing changes. The rupee price is
   * still what is charged (converted at checkout, where the exact amount is
   * shown), so it is never hidden. A "Prices in" menu above the packages
   * lets anyone switch.
   */
  var RUPEE = /₹\s*([\d,]+)/;
  function rupeeNode(el) {
    /* The bare "₹9,999" text node directly inside a .price — wrapped once so
       it can be restyled and put back. */
    var w = el.querySelector(':scope > .glv-inr');
    if (w) return w;
    for (var k = 0; k < el.childNodes.length; k++) {
      var n = el.childNodes[k];
      if (n.nodeType === 3 && RUPEE.test(n.textContent)) {
        w = document.createElement('span');
        w.className = 'glv-inr';
        w.textContent = n.textContent;
        el.replaceChild(w, n);
        return w;
      }
    }
    return null;
  }
  function inrIn(text) { var m = RUPEE.exec(text || ''); return m ? Number(m[1].replace(/,/g, '')) : 0; }

  function localPrices() {
    if (!CFG) return;
    var code = current(CFG);
    var foreign = code !== 'INR';
    picker();
    sheets();
    sweep();

    /* Package and service prices: the local amount becomes the main figure. */
    /* .price: packages; .svc-now: the home page's service cards; #planTotal:
       "your plan" total; .sl-meta > b: the Services page in the portal. */
    var els = document.querySelectorAll('.price, .svc-now, #planTotal, .sl-meta > b, [data-inr]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var old = el.querySelector(':scope > .glv-local'); if (old) old.remove();   // patch 187's line
      var inr = Number(el.getAttribute('data-inr')) || 0;
      var rn = inr ? null : rupeeNode(el);
      if (!inr && rn) inr = inrIn(rn.textContent);
      if (!inr) continue;
      var main = el.querySelector(':scope > .glv-main');
      /* "including taxes" under a price that has none for this buyer. */
      var note = el.querySelector(':scope > .note');
      if (note && /tax/i.test(note.getAttribute('data-glv-note') || note.textContent)) {
        if (!note.getAttribute('data-glv-note')) note.setAttribute('data-glv-note', note.textContent);
        var vr = foreign ? vatOf(CFG) : 0;
        note.style.display = foreign && !vr ? 'none' : '';
        var want = vr ? 'incl. ' + vr + '% VAT' : note.getAttribute('data-glv-note');
        if (note.textContent !== want) note.textContent = want;
      }
      if (!foreign) {
        if (main) main.remove();
        var vb0 = el.querySelector(':scope > .glv-vat'); if (vb0) vb0.remove();
        if (rn) {
          rn.removeAttribute('style');
          if (rn.getAttribute('data-glv-orig')) { rn.textContent = rn.getAttribute('data-glv-orig'); rn.removeAttribute('data-glv-orig'); }
        }
        continue;
      }
      if (rn) {
        /* The rupee figure beside it, marked GST-free for this buyer. */
        if (!rn.getAttribute('data-glv-orig')) rn.setAttribute('data-glv-orig', rn.textContent);
        var exText = rn.getAttribute('data-glv-orig').trim() + (vatOf(CFG) ? ' + ' + vatOf(CFG) + '% VAT' : '');
        if (rn.textContent !== exText) rn.textContent = exText;
      }
      var pre = rn ? rn.textContent.slice(0, rn.textContent.indexOf('\u20b9')).trim() : '';
      var text = (pre ? pre + ' ' : '') + local(inr, code, CFG);
      if (!main) {
        main = document.createElement('span');
        main.className = 'glv-main';
        main.style.cssText = 'display:block';
        if (rn) el.insertBefore(main, rn); else el.insertBefore(main, el.firstChild);
      }
      if (main.textContent !== text) main.textContent = text;
      /* Patch 215 (QA): an EU buyer sees that VAT is in the price on every
         card, not only the one that happened to carry a tax note. */
      var vb = el.querySelector(':scope > .glv-vat'), vrr = vatOf(CFG), hasNote = note && /VAT/.test(note.textContent) && note.style.display !== 'none';
      if (vrr && !hasNote) {
        if (!vb) { vb = document.createElement('small'); vb.className = 'glv-vat'; vb.style.cssText = 'display:block;font-size:11.5px;font-weight:600;opacity:.75;margin-top:2px'; main.after(vb); }
        vb.textContent = 'incl. ' + vrr + '% VAT';
      } else if (vb) vb.remove();
      /* Patch 195 (owner: "not mixed"): one currency on screen — the rupee
         figure is hidden for a visitor abroad, not shown beside. */
      if (rn) rn.style.cssText = 'display:none';
    }

    /* Old "(≈ €193)" tags from patch 188 — the sweep converts the line itself now. */
    [].forEach.call(document.querySelectorAll('.partline .glv-local'), function (t) { t.remove(); });
  }

  /*
   * The two checkout sheets on the home page, for a buyer abroad: every
   * figure in their currency without GST, the GST lines taken out, the total
   * labelled as an export, and the "+91" box hidden. Put back as they were
   * when the buyer picks rupees.
   */
  var SHEETS = ['buyModal', 'svcCheckout'];
  function sheets() {
    if (!CFG) return;
    var code = current(CFG), foreign = code !== 'INR';
    SHEETS.forEach(function (id) {
      var root = document.getElementById(id);
      if (!root) return;
      /* Every ₹ figure in the sheet's text (but not the currency menu). */
      var walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      var nodes = [], n;
      while ((n = walk.nextNode())) {
        if (n.parentNode && n.parentNode.closest && n.parentNode.closest('.glv-cur, select, option, script, style')) continue;
        if (n.__glvOrig != null || /\u20b9\s*[\d,]+/.test(n.textContent)) nodes.push(n);
      }
      nodes.forEach(function (t) {
        if (foreign) {
          if (t.__glvOrig == null || t.textContent !== t.__glvShown) {
            if (!/\u20b9\s*[\d,]+/.test(t.textContent)) return;
            t.__glvOrig = t.textContent;
            /* The button keeps its rupee figure for the "Pay in" line. */
            var host = t.parentNode && t.parentNode.closest && t.parentNode.closest('#buyPay, #scPay');
            if (host) host.setAttribute('data-glv-inr', String(inrIn(t.__glvOrig)));
          }
          var shown = t.__glvOrig.replace(/\u20b9\s*([\d,]+)/g, function (m0, a) {
            return local(Number(a.replace(/,/g, '')), code, CFG);
          });
          if (t.textContent !== shown) { t.textContent = shown; }
          t.__glvShown = shown;
        } else if (t.__glvOrig != null) {
          if (t.textContent === t.__glvShown) t.textContent = t.__glvOrig;
          t.__glvOrig = null; t.__glvShown = null;
        }
      });
      if (!foreign) ['#buyPay', '#scPay'].forEach(function (sel) { var b = root.querySelector(sel); if (b) b.removeAttribute('data-glv-inr'); });
      /* The GST lines, the total's label, the lead, the +91 box. */
      [].forEach.call(root.querySelectorAll('.co-line.sub'), function (el) { el.style.display = foreign ? 'none' : ''; });
      [].forEach.call(root.querySelectorAll('.phone-row span.cc'), function (el) { el.style.display = foreign ? 'none' : ''; }); /* Patch 232: the country-code LIST stays — only the old fixed +91 hides */
      var tot = root.querySelector('.co-total > span');
      if (tot) {
        if (foreign) {
          if (!tot.__glvOrig) tot.__glvOrig = tot.textContent;
          var lbl = vatOf(CFG) ? 'Total payable \u00b7 incl. ' + vatOf(CFG) + '% VAT' : 'Total payable';
          if (tot.textContent !== lbl) tot.textContent = lbl;
        } else if (tot.__glvOrig) { tot.textContent = tot.__glvOrig; tot.__glvOrig = null; }
      }
      var lead = root.querySelector('#buyLead, #scLead');
      /* Patch 232: only over a price — not the apply and confirmation screens
         that share this pop-up. */
      if (lead && root.querySelector('.co-total')) {
        if (foreign) {
          if (!lead.__glvOrig) lead.__glvOrig = lead.textContent;
          var lt = vatOf(CFG) ? 'Prices in ' + nameOf(code) + ', including ' + vatOf(CFG) + '% VAT for buyers in the EU (sold by Glovels UG, Germany).'
            : 'Prices shown in ' + nameOf(code) + ', at today’s rate.';
          if (lead.textContent !== lt) lead.textContent = lt;
        } else if (lead.__glvOrig) { lead.textContent = lead.__glvOrig; lead.__glvOrig = null; }
      }
    });
  }

  /*
   * Patch 194 (owner: "everything in INR to local currency, based on IP"):
   * every other rupee figure on a public page — the price bands
   * ("Under ₹10L"), costs on the country, university and blog pages,
   * "₹0–₹3L" — in the visitor's currency. Lakh and crore are read as
   * numbers ("₹2.8L" = 280,000). Put back exactly when they pick rupees.
   * Not on the legal pages (the terms state prices in rupees), not inside
   * form fields, and not where the page already shows the conversion.
   */
  var LEGAL = /^\/(terms|refunds|privacy|grievance|disclaimers)(\.html)?\/?$/;
  var SKIP = 'script,style,textarea,input,select,option,code,pre,[data-no-fx],.glv-inr,.glv-main,.glv-local,'
    + '.glv-cur,.glv-prices-in,#buyModal,#svcCheckout,.price,.svc-now,#planTotal';
  var AMOUNT = /₹\s?([\d,]+(?:\.\d+)?)\s?(lakhs?|Lakhs?|L|crores?|Crores?|Cr|k|K)?(?![\w])/g;
  function unitOf(u) {
    u = String(u || '').toLowerCase();
    return u[0] === 'l' ? 1e5 : u[0] === 'c' ? 1e7 : u === 'k' ? 1e3 : 1;
  }
  var swept = [];
  function sweep() {
    if (!CFG || !document.body || LEGAL.test(location.pathname)) return;
    var code = current(CFG), foreign = code !== 'INR';
    if (!foreign) {
      swept.forEach(function (t) { if (t.__glvSweep != null && t.textContent === t.__glvShown) t.textContent = t.__glvSweep; t.__glvSweep = null; });
      swept = [];
      return;
    }
    var walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (n.textContent.indexOf('₹') < 0 && n.__glvSweep == null) return NodeFilter.FILTER_REJECT;
        var p = n.parentNode;
        if (!p || (p.closest && p.closest(SKIP))) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [], n;
    while ((n = walk.nextNode())) nodes.push(n);
    nodes.forEach(function (t) {
      if (t.__glvSweep == null || t.textContent !== t.__glvShown) {
        if (t.textContent.indexOf('₹') < 0) return;
        t.__glvSweep = t.textContent;
        swept.push(t);
      }
      var shown = t.__glvSweep.replace(AMOUNT, function (m0, num, unit) {
        var inr = Number(String(num).replace(/,/g, '')) * unitOf(unit);
        if (!(inr >= 0)) return m0;
        return fee(inr) || m0;
      });
      if (t.textContent !== shown) t.textContent = shown;
      t.__glvShown = shown;
    });
  }

  /* "Prices in [EUR — Euro ▾]" above the packages: the visitor's own choice,
     shared with the checkout. */
  function picker() { ['packages', 'services'].forEach(pickerIn); }
  function pickerIn(id) {
    var sec = document.getElementById(id);
    if (!sec || !CFG || sec.querySelector('.glv-prices-in')) return;
    var head = sec.querySelector('.sec-head');
    if (!head) return;
    var box = document.createElement('div');
    box.className = 'glv-prices-in';
    box.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:8px;margin:-6px 0 16px;'
      + 'font:600 12.6px/1.4 var(--sans,system-ui,sans-serif);color:var(--navy-800,#25344a)';
    var opt = function (c) { return '<option value="' + c + '">' + c + ' — ' + nameOf(c) + '</option>'; };
    var opts = Array.isArray(CFG.regions) && CFG.regions.length
      ? CFG.regions.map(function (g) { return '<optgroup label="' + g.name + '">' + g.currencies.map(opt).join('') + '</optgroup>'; }).join('')
      : CFG.currencies.map(opt).join('');
    box.innerHTML = '<label for="glvPricesIn-' + id + '">Prices in</label><select id="glvPricesIn-' + id + '" class="glv-cur-sel" '
      + 'style="padding:6px 8px;border:1.5px solid #d8dde4;border-radius:8px;background:#fff;font:inherit;max-width:260px">'
      + opts + '</select>';
    head.parentNode.insertBefore(box, head.nextSibling);
    var sel = box.querySelector('select');
    sel.value = current(CFG);
    sel.onchange = function () {
      set(sel.value);
      try { document.dispatchEvent(new CustomEvent('glv-currency', { detail: sel.value })); } catch (e) {}
    };
    document.addEventListener('glv-currency', function (ev) { if (ev.detail && sel.value !== ev.detail) sel.value = ev.detail; });
  }

  /* Every checkout button the pages know about, whenever it appears. */
  var priceTimer = 0;
  function scan() {
    ['buyPay', 'scPay', 'svcCoPay'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) attach(b);
    });
    if (!priceTimer) priceTimer = setTimeout(function () { priceTimer = 0; localPrices(); }, 120);
  }
  /* Patch 207: the header's "where are you / which currency / language"
     control, on every page. The country chooses the currency (and can be
     overridden); English is the only language for now. Remembered on this
     device; the first visit guesses from the visitor's location. */
  var CKEY = 'glv-country';
  function country() {
    var c = ''; try { c = localStorage.getItem(CKEY) || ''; } catch (e) { c = ''; }
    return c || ((CFG && CFG.geo && geoOk(CFG)) ? (CFG.geo.country || '') : '');
  }
  /* Patch 228: the checkout's phone box picks its country code from this. */
  if (window.glovelsPay) window.glovelsPay.visitorCountry = country;
  /* Patch 233 (owner, 2 Nov): "ask the country of residence when a package is
     selected, so we know which payment to show — India Razorpay, everywhere
     else Stripe". The checkout's "Where do you live?" calls this: it is the
     same choice as the header's country picker, so the currency, the tax line
     and the payment provider all follow it. */
  if (window.glovelsPay) {
    window.glovelsPay.setResidence = function (cv) {
      if (!/^[A-Z]{2}$/.test(cv || '')) return Promise.resolve();
      return config().then(function (cfg) {
        var kv = cv === 'IN' ? 'INR' : ((cfg && cfg.currencyOf && cfg.currencyOf[cv]) || 'USD');
        try { localStorage.setItem(CKEY, cv); } catch (e) {}
        try { document.cookie = 'glv_country=' + cv + '; Path=/; Max-Age=31536000; SameSite=Lax'; } catch (e) {}
        set(kv);
        try { document.dispatchEvent(new CustomEvent('glv-currency', { detail: kv })); } catch (e) {}
        try { document.dispatchEvent(new CustomEvent('glv-country', { detail: cv })); } catch (e) {}
        try { paint(); } catch (e) {}
        return kv;
      });
    };
    window.glovelsPay.countries = function () {
      return config().then(function (cfg) { return Object.keys((cfg && cfg.currencyOf) || {}).sort(function (a, b) { return countryName(a).localeCompare(countryName(b)); })
        .map(function (c) { return [c, countryName(c)]; }); });
    };
  }
  function flagOf(c) { return /^[A-Z]{2}$/.test(c || '') ? c.replace(/./g, function (ch) { return String.fromCodePoint(127397 + ch.charCodeAt(0)); }) : '\uD83C\uDF10'; }
  /* patch 265: the language. The page says which one it is in (<html lang>);
     the languages the office has switched on come with the config; the
     choice is a cookie, and choosing one opens the same page under its
     prefix (/zh/…) — English is the plain address. */
  var LANG_RE = /^\/(zh|ar|es|ru|fr|pt|bn|tr)(?=\/|$)/;
  function pageLang() { var l = (document.documentElement.getAttribute('lang') || 'en').slice(0, 2).toLowerCase(); return LANG_RE.test('/' + l) ? l : 'en'; }
  function cookieLang() { var m = /(?:^|;\s*)glv_lang=([a-z]{2})/.exec(document.cookie || ''); return m ? m[1] : ''; }
  function langs() { return (CFG && Array.isArray(CFG.languages) && CFG.languages.length) ? CFG.languages : [{ code: 'en', name: 'English' }]; }
  function langName(c) { var l = langs().filter(function (x) { return x.code === c; })[0]; return l ? l.name : c.toUpperCase(); }
  /* The same page in another language. */
  function pageIn(lang) {
    var p = location.pathname.replace(LANG_RE, '') || '/';
    var rest = p + location.search + location.hash;
    if (lang === 'en') return rest;
    if (/^\/(api|js|images|logos|flags|assets|data|og|admin|counsellor|chat|home|catalogue|blog-admin|leads|leads-command|ops|marketing|partner|languages)(\/|$|\.)/.test(p)) return rest;
    return '/' + lang + (p === '/' ? '/' : p) + location.search + location.hash;
  }
  function setLang(lang) {
    try { document.cookie = 'glv_lang=' + lang + '; Path=/; Max-Age=31536000; SameSite=Lax'; } catch (e) {}
    try { localStorage.setItem('glv-lang', lang); } catch (e) {}
  }
  /* A visitor who chose a language once stays in it: an English address
     opened from a bookmark, a search result or a script goes to the same
     page in their language. Only when that language is on, and never a
     staff screen. Choosing English in the picker is a choice too, and is
     kept. */
  function keepLang() {
    var want = cookieLang(), here = pageLang();
    if (!want || want === here || want === 'en' || here !== 'en') return;
    if (!langs().some(function (l) { return l.code === want; })) return;
    var to = pageIn(want);
    if (to === location.pathname + location.search + location.hash) return;
    try { if (sessionStorage.getItem('glv-lang-hop') === to) return; sessionStorage.setItem('glv-lang-hop', to); } catch (e) {}
    location.replace(to);
  }
  function countryName(c) { try { return new Intl.DisplayNames([uiLang(), 'en'], { type: 'region' }).of(c) || c; } catch (e) { return c; } }
  function localeBar() {
    if (!CFG) return;
    var hosts = [];
    var h = document.querySelector('header.site .nav-cta');
    if (h && !h.querySelector('.glv-locale')) hosts.push([h, false]);
    var mm = document.getElementById('mm');
    if (mm && !mm.querySelector('.glv-locale')) hosts.push([mm, true]);
    /* Patch 268 (owner, 5 Nov): "in student login they can change the
       language … like the website". The portal has no site header, so the
       picker goes in the sidebar under the student's name — language only;
       country and currency were settled when they bought. */
    var who = document.querySelector('.p-side .p-who');
    if (who && !document.querySelector('.p-side .glv-lang') && langs().length > 1) mountLangOnly(who);
    if (!hosts.length) return;
    injectLocaleCss();
    hosts.forEach(function (x) { mountLocale(x[0], x[1]); });
  }
  function mountLangOnly(after) {
    var box = document.createElement('div');
    box.className = 'glv-lang';
    var cur = pageLang();
    box.innerHTML = '<label for="glvLangSel"><span aria-hidden="true">\uD83C\uDF10</span> <span data-i18n-skip>Language</span></label>'
      + '<select id="glvLangSel" translate="no" aria-label="Language">'
      + langs().map(function (l) { return '<option value="' + l.code + '"' + (l.code === cur ? ' selected' : '') + '>' + (l.native || l.name) + (l.native && l.native !== l.name ? ' \u00b7 ' + l.name : '') + '</option>'; }).join('')
      + '</select>';
    if (!document.getElementById('glvLangCss')) {
      var st = document.createElement('style'); st.id = 'glvLangCss';
      st.textContent = '.p-side .glv-lang{display:flex;align-items:center;gap:8px;margin:2px 0 8px;padding:8px 12px;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:rgba(255,255,255,.04)}'
        + '.p-side .glv-lang label{font:700 11px/1 var(--sans,system-ui);letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.72);white-space:nowrap}'
        + '.p-side .glv-lang select{flex:1;min-width:0;padding:6px 8px;border:1px solid rgba(255,255,255,.28)!important;border-radius:9px;background:#13294a!important;color:#fff!important;font:600 13px var(--sans,system-ui);cursor:pointer;-webkit-appearance:auto;appearance:auto}'
        + '.p-side .glv-lang select option{color:#0b1f3a;background:#fff}'
        + '@media (max-width:900px){.p-side .glv-lang{margin:0;flex:1 1 160px}}';
      document.head.appendChild(st);
    }
    after.parentNode.insertBefore(box, after.nextSibling);
    box.querySelector('select').addEventListener('change', function () {
      var l = this.value;
      setLang(l);
      try { if (window.glvTrack) glvTrack('language', { label: l, page: location.pathname }); } catch (e) {}
      location.href = pageIn(l);
    });
  }
  function injectLocaleCss() {
    if (!document.getElementById('glvLocaleCss')) {
      var st = document.createElement('style'); st.id = 'glvLocaleCss';
      st.textContent = '.glv-locale{position:relative;display:inline-flex}'
        + '.glv-loc-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(13,35,56,.25);background:#fff;border-radius:999px;padding:7px 11px;font:700 12.6px/1 var(--sans,system-ui);color:var(--navy-800,#0b1f3a);cursor:pointer;white-space:nowrap}'
        + '.glv-loc-btn:hover{border-color:#0b1f3a}'
        + '.glv-loc-btn .f{font-size:15px;line-height:1}'
        + '.glv-loc-pop{position:absolute;right:0;top:calc(100% + 8px);width:300px;background:#fff;border:1px solid #e2e7ee;border-radius:16px;box-shadow:0 24px 60px rgba(11,31,58,.18);padding:16px;z-index:200;text-align:left}'
        + '.glv-loc-pop h4{margin:0 0 10px;font:800 15px var(--sans,system-ui);color:#0b1f3a}'
        + '.glv-loc-pop label{display:block;font:700 11px var(--sans,system-ui);letter-spacing:.06em;text-transform:uppercase;color:#6b7a8c;margin:10px 0 4px}'
        + '.glv-loc-pop select{width:100%;padding:9px 10px;border:1.5px solid #d8dde4;border-radius:10px;background:#fff;font:600 14px var(--sans,system-ui);color:#0b1f3a}'
        + '.glv-pick{position:relative}.glv-pick input{width:100%;box-sizing:border-box;padding:9px 30px 9px 10px;border:1.5px solid #d8dde4;border-radius:10px;font:600 14px var(--sans,system-ui);color:#0b1f3a;background:#fff;cursor:pointer}'
        + '.glv-pick input::placeholder{color:#0b1f3a;opacity:1}.glv-pick input:focus::placeholder{color:#8a97a8}'
        + '.glv-pick-arrow{position:absolute;right:10px;top:8px;font-size:14px;color:#0b1f3a;cursor:pointer}'
        + '.glv-pick.open input{border-radius:10px 10px 0 0}.glv-pick:not(.open) .glv-pick-l{display:none}'
        + '.glv-pick input:focus{outline:none;border-color:#0b1f3a}'
        + '.glv-pick-l{display:flex;flex-direction:column;max-height:150px;overflow-y:auto;border:1.5px solid #d8dde4;border-top:0;border-radius:0 0 10px 10px;-webkit-overflow-scrolling:touch}'
        + '.glv-pick-l button{display:block;width:100%;text-align:left;border:0;background:#fff;padding:8px 10px;font:600 13.5px var(--sans,system-ui);color:#0b1f3a;cursor:pointer}'
        + '.glv-pick-l button:hover{background:#f1f4f8}.glv-pick-l button[aria-selected]{background:#0b1f3a;color:#fff}'
        + '.glv-pick-l button[hidden]{display:none}.glv-pick-none{padding:8px 10px;color:#6b7a8c;font:500 13px var(--sans,system-ui)}'
        + '.glv-loc-pop{max-height:calc(100vh - 90px);overflow-y:auto}'
        + '.glv-loc-pop small{display:block;color:#6b7a8c;font:500 11.5px var(--sans,system-ui);margin-top:4px}'
        + '.glv-loc-pop .go{margin-top:14px;width:100%;border:0;border-radius:10px;padding:11px;background:#0b1f3a;color:#fff;font:800 13.5px var(--sans,system-ui);cursor:pointer}'
        + '.glv-locale.in-menu{display:flex;margin:4px 0 12px}.glv-locale.in-menu .glv-loc-btn{width:100%;justify-content:center;padding:11px 14px;font-size:14px}'
        + '.glv-locale.in-menu .glv-loc-pop{position:static;width:auto;margin-top:8px;box-shadow:none}'
        + '.glv-locale.in-menu{flex-direction:column}'
        + '@media (max-width:640px){header.site .nav-cta .glv-locale{display:none}}'
        + '@media (min-width:641px){.glv-locale.in-menu{display:none}}';
      document.head.appendChild(st);
    }
  }
  function mountLocale(host, inMenu) {
    var box = document.createElement('div');
    box.className = 'glv-locale' + (inMenu ? ' in-menu' : '');
    if (inMenu) { var top = host.querySelector('.mm-top'); host.insertBefore(box, top ? top.nextSibling : host.firstChild); }
    else host.insertBefore(box, host.firstChild);
    function paint() {
      var c = country(), cur = current(CFG);
      box.innerHTML = '<button type="button" class="glv-loc-btn" aria-haspopup="dialog" aria-expanded="false" data-track="locale" data-track-label="Country and currency" title="Country, currency and language">'
        + '<span class="f" aria-hidden="true">' + flagOf(c) + '</span><span class="n" translate="no">' + (inMenu && c ? countryName(c) + ' \u00b7 ' : '') + cur + ' \u00b7 ' + (langs().length > 1 ? langName(pageLang()) : 'EN') + '</span><span aria-hidden="true">\u25be</span></button>';
      box.querySelector('button').onclick = open;
    }
    /* Patch 214 (owner): "there is no option to search country or language or
       currency" — each is now a type-to-find list rather than a 250-line select. */
    function picker(id, label, items, value, ph) {
      return '<label for="' + id + 'Q">' + label + '</label>'
        + '<div class="glv-pick" data-id="' + id + '"><input id="' + id + 'Q" type="search" autocomplete="off" spellcheck="false" placeholder="' + ph + '" title="' + ph + '" role="combobox" aria-expanded="false" aria-controls="' + id + 'L"><span class="glv-pick-arrow" aria-hidden="true">\u25be</span>'
        + '<div class="glv-pick-l" id="' + id + 'L" role="listbox">'
        + items.map(function (x) { return '<button type="button" role="option" translate="no" data-v="' + x[0] + '" data-n="' + String(x[2] || '').toLowerCase().replace(/"/g, '') + '" data-s="' + (x[0] + ' ' + x[1] + ' ' + (x[2] || '')).toLowerCase().replace(/"/g, '') + '"' + (x[0] === value ? ' aria-selected="true"' : '') + '>' + x[1] + '</button>'; }).join('')
        + '<div class="glv-pick-none" hidden>Nothing matches</div></div></div>';
    }
    function wire(pop, id, onPick) {
      var root = pop.querySelector('.glv-pick[data-id="' + id + '"]'), q = root.querySelector('input'), list = root.querySelector('.glv-pick-l');
      var none = list.querySelector('.glv-pick-none');
      function filter() {
        var t = q.value.trim().toLowerCase(), shown = 0;
        /* Patch 215 (QA): "india" put British Indian Ocean Territory first —
           names that START with what was typed come to the top. */
        list.querySelectorAll('button').forEach(function (b) { var ok = !t || (' ' + b.getAttribute('data-s')).indexOf(' ' + t) >= 0; b.hidden = !ok; if (ok) shown++;
          b.style.order = t && ((b.getAttribute('data-n') || '').indexOf(t) === 0 || b.getAttribute('data-v').toLowerCase() === t) ? '0' : '1'; });
        none.hidden = shown > 0;
      }
      /* Patch 215 (owner): "Drop down is better" — each field reads like a
         dropdown showing the choice; tap it and type to search. */
      function shut() { root.classList.remove('open'); q.setAttribute('aria-expanded', 'false'); }
      function openList() { root.classList.add('open'); q.setAttribute('aria-expanded', 'true'); }
      function choose(b) {
        list.querySelectorAll('[aria-selected]').forEach(function (x) { x.removeAttribute('aria-selected'); });
        b.setAttribute('aria-selected', 'true'); root.setAttribute('data-value', b.getAttribute('data-v'));
        q.value = ''; q.placeholder = b.textContent; filter(); shut();
        if (onPick) onPick(b.getAttribute('data-v'));
      }
      q.onfocus = openList; q.onclick = openList;
      root.querySelector('.glv-pick-arrow').onclick = function () { if (root.classList.contains('open')) shut(); else { openList(); q.focus(); } };
      q.onblur = function () { setTimeout(function () { if (!root.contains(document.activeElement)) shut(); }, 150); };
      q.oninput = function () { openList(); filter(); };
      q.onkeydown = function (e) {
        if (e.key === 'Enter') { e.preventDefault(); var f = [].filter.call(list.querySelectorAll('button:not([hidden])'), function (x) { return x.style.order === '0'; })[0] || list.querySelector('button:not([hidden])'); if (f) { choose(f); q.value = ''; filter(); f.scrollIntoView({ block: 'nearest' }); } }
      };
      list.onclick = function (e) { var b = e.target.closest('button'); if (b) choose(b); };
      var sel = list.querySelector('[aria-selected]');
      root.setAttribute('data-value', sel ? sel.getAttribute('data-v') : '');
      if (sel) q.placeholder = sel.textContent;
      return {
        get: function () { return root.getAttribute('data-value') || ''; },
        set: function (v) { var b = list.querySelector('button[data-v="' + v + '"]'); if (b) { choose(b); b.scrollIntoView({ block: 'nearest' }); } }
      };
    }
    function open() {
      if (box.querySelector('.glv-loc-pop')) return close();
      var c = country(), cur = current(CFG);
      var cItems = (CFG.countries || []).map(function (k) { return [k, flagOf(k) + ' ' + countryName(k), countryName(k) + (k === 'XK' ? ' kosova' : '')]; })
        .sort(function (x, y) { return x[2].localeCompare(y[2]); });
      var kList = Array.isArray(CFG.regions) && CFG.regions.length
        ? [].concat.apply([], CFG.regions.map(function (g) { return g.currencies; })) : (CFG.currencies || ['INR']);
      var seen = {};
      var kItems = kList.filter(function (k) { if (seen[k]) return false; seen[k] = 1; return true; })
        .map(function (k) { return [k, k + ' — ' + nameOf(k), nameOf(k)]; });
      var pop = document.createElement('div');
      pop.className = 'glv-loc-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Country, currency and language');
      pop.innerHTML = '<h4>Your country and currency</h4>'
        + picker('glvLocC', 'Country', cItems, c, 'Search country — e.g. Italy')
        + picker('glvLocCur', 'Currency', kItems, cur, 'Search currency — e.g. EUR, euro')
        + '<small>Prices and fees are shown in this currency, and you pay in it.</small>'
        + picker('glvLocL', 'Language', langs().map(function (l) { return [l.code, l.name, l.name]; }), pageLang(), 'Search language')
        + (langs().length > 1 ? '<small>The whole site, in your language.</small>' : '<small>More languages are coming.</small>')
        + '<button type="button" class="go">Save</button>';
      box.appendChild(pop);
      box.querySelector('.glv-loc-btn').setAttribute('aria-expanded', 'true');
      var ks = wire(pop, 'glvLocCur');
      var cs = wire(pop, 'glvLocC', function (v) { var m = CFG.currencyOf && CFG.currencyOf[v]; if (m) ks.set(m); });
      var ls = wire(pop, 'glvLocL');
      pop.querySelector('.go').onclick = function () {
        var cv = cs.get(), kv = ks.get() || cur;
        var lv = ls.get() || pageLang();
        try { if (cv) localStorage.setItem(CKEY, cv); } catch (e) {}
        try { if (cv) document.cookie = 'glv_country=' + cv + '; Path=/; Max-Age=31536000; SameSite=Lax'; } catch (e) {}
        set(kv);
        try { document.dispatchEvent(new CustomEvent('glv-currency', { detail: kv })); } catch (e) {}
        try { document.dispatchEvent(new CustomEvent('glv-country', { detail: cv })); } catch (e) {}
        if (window.glvTrack) try { glvTrack('locale', { label: (cv || '') + ' ' + kv + ' ' + lv }); } catch (e) {}
        close(); paint();
        if (lv !== pageLang()) { setLang(lv); try { sessionStorage.removeItem('glv-lang-hop'); } catch (e) {} location.href = pageIn(lv); }
      };
      setTimeout(function () { var i = pop.querySelector('#glvLocCQ'); if (i && !inMenu) i.focus(); }, 30);
    }
    function close() { var p = box.querySelector('.glv-loc-pop'); if (p) p.remove(); var b = box.querySelector('.glv-loc-btn'); if (b) b.setAttribute('aria-expanded', 'false'); }
    document.addEventListener('click', function (e) { if (!box.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    document.addEventListener('glv-currency', function () { if (!box.querySelector('.glv-loc-pop')) paint(); });
    paint();
  }

  config().then(function (c) {
    CFG = c;
    try { var cc = localStorage.getItem('glv-country'); if (cc && document.cookie.indexOf('glv_country=' + cc) < 0) document.cookie = 'glv_country=' + cc + '; Path=/; Max-Age=31536000; SameSite=Lax'; } catch (e) {}
    localPrices(); localeBar(); try { keepLang(); } catch (e) {}
    /* The finders draw their fees again now that the currency is known. */
    try { document.dispatchEvent(new CustomEvent('glv-currency', { detail: current(CFG) })); } catch (e) {}
  });
  document.addEventListener('glv-currency', function () { localPrices(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
  else scan();
  try {
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) { /* the static buttons are still covered */ }
}());
