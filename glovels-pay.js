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
  function current(cfg) {
    var list = (cfg && cfg.currencies) || ['INR'];
    /* Their own pick first; then the country their IP is in (server); then
       the clock on their device. */
    var pick = stored() || (cfg && cfg.geo && cfg.geo.currency) || guess();
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
    var units = Math.max(1, Math.ceil(x - 1e-9));
    var step = units >= 10000 ? Math.pow(10, Math.floor(Math.log10(units)) - 3) : 1;
    return Math.ceil(units / step) * step;
  }
  function convert(inr, code, cfg) {
    var r = Number(((cfg && cfg.fx) || {})[code]);
    if (code === 'INR' || !(r > 0)) return inr;
    return nice(inr / r);
  }

  function money(n, code) {
    try {
      return new Intl.NumberFormat(code === 'INR' ? 'en-IN' : 'en',
        { style: 'currency', currency: code, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(n);
    } catch (e) {
      return (SYMBOL[code] || code + ' ') + String(n);
    }
  }
  function nameOf(code) {
    try { return new Intl.DisplayNames(['en'], { type: 'currency' }).of(code) || NAME[code] || code; }
    catch (e) { return NAME[code] || code; }
  }

  /* The rupee figure a "Confirm — ₹74,999" button is showing. */
  function rupeesOn(btn) {
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
        q.textContent = 'You’ll be charged ' + money(convert(inr, code, cfg), code)
          + ' for the ' + money(inr, 'INR') + ' price, at today’s rate. International cards'
          + ' and PayPal. Your bank may add its own conversion fee.';
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

  /* A mobile from anywhere: digits with + ( ) - and spaces, 8 to 15 digits —
     the same rule the server applies. */
  function phoneOk(v) {
    v = String(v || '').trim();
    if (!/^\+?[\d\s().-]+$/.test(v)) return false;
    var n = v.replace(/\D/g, '').length;
    return n >= 8 && n <= 15;
  }

  window.glovelsPay = { config: config, guess: guess, attach: attach, chosen: chosen,
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

    /* Package and service prices: the local amount becomes the main figure. */
    var els = document.querySelectorAll('.price, [data-inr]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var old = el.querySelector(':scope > .glv-local'); if (old) old.remove();   // patch 187's line
      var inr = Number(el.getAttribute('data-inr')) || 0;
      var rn = inr ? null : rupeeNode(el);
      if (!inr && rn) inr = inrIn(rn.textContent);
      if (!inr) continue;
      var main = el.querySelector(':scope > .glv-main');
      if (!foreign) {
        if (main) main.remove();
        if (rn) rn.removeAttribute('style');
        continue;
      }
      var text = money(convert(inr, code, CFG), code);
      if (!main) {
        main = document.createElement('span');
        main.className = 'glv-main';
        main.style.cssText = 'display:block';
        if (rn) el.insertBefore(main, rn); else el.insertBefore(main, el.firstChild);
      }
      if (main.textContent !== text) main.textContent = text;
      if (rn) rn.style.cssText = 'display:inline-block;font:600 11.5px/1.3 var(--sans,system-ui,sans-serif);'
        + 'color:var(--muted,#5a6b80);margin-top:5px;letter-spacing:0';
    }

    /* "Part payment possible — ₹20,000 to start": the local figure beside it. */
    var parts = document.querySelectorAll('.partline > span');
    for (var j = 0; j < parts.length; j++) {
      var sp = parts[j];
      var tag = sp.querySelector('.glv-local');
      if (!foreign) { if (tag) tag.remove(); continue; }
      var base = sp.getAttribute('data-glv-text');
      if (!base) { base = sp.textContent; sp.setAttribute('data-glv-text', base); }
      var p = inrIn(base); if (!p) continue;
      var t2 = ' (≈ ' + money(convert(p, code, CFG), code) + ')';
      if (!tag) { tag = document.createElement('span'); tag.className = 'glv-local'; sp.appendChild(tag); }
      if (tag.textContent !== t2) tag.textContent = t2;
    }
  }

  /* "Prices in [EUR — Euro ▾]" above the packages: the visitor's own choice,
     shared with the checkout. */
  function picker() {
    var sec = document.getElementById('packages');
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
    box.innerHTML = '<label for="glvPricesIn">Prices in</label><select id="glvPricesIn" class="glv-cur-sel" '
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
  config().then(function (c) { CFG = c; localPrices(); });
  document.addEventListener('glv-currency', function () { localPrices(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
  else scan();
  try {
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) { /* the static buttons are still covered */ }
}());
