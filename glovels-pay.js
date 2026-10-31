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

  /* A first guess from the clock the visitor's device keeps. India (90% of
     buyers) and anything unknown stay in rupees. */
  function guess() {
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { tz = ''; }
    if (!tz || /^Asia\/(Kolkata|Calcutta)$/.test(tz)) return 'INR';
    if (tz === 'Europe/London' || tz === 'Europe/Belfast' || tz === 'Europe/Guernsey'
        || tz === 'Europe/Jersey' || tz === 'Europe/Isle_of_Man') return 'GBP';
    if (/^Europe\//.test(tz) || tz === 'Atlantic/Canary' || tz === 'Atlantic/Madeira') return 'EUR';
    if (/^Australia\//.test(tz)) return 'AUD';
    if (/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Montreal|Moncton|Whitehorse|Yellowknife|Iqaluit|Glace_Bay|Goose_Bay|Swift_Current|Dawson_Creek|Fort_Nelson)$/.test(tz)) return 'CAD';
    if (/^Asia\/(Dhaka|Kathmandu|Colombo|Thimphu)$/.test(tz)) return 'USD';
    return 'USD';
  }

  function stored() {
    try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }

  /** The currency to charge in: the buyer's pick, else the guess, if the
   *  office takes it, else rupees. */
  function current(cfg) {
    var list = (cfg && cfg.currencies) || ['INR'];
    var pick = stored() || guess();
    return list.indexOf(pick) >= 0 ? pick : 'INR';
  }

  function set(code) {
    try { localStorage.setItem(KEY, String(code || 'INR')); } catch (e) { /* this visit only */ }
  }

  var nfIn = function (n) { try { return n.toLocaleString('en-IN'); } catch (e) { return String(n); } };
  var nfAny = function (n) { try { return n.toLocaleString('en-US'); } catch (e) { return String(n); } };

  /** The same sum the server does: rupees over rupees-per-unit, rounded UP to
   *  a whole unit, so the office never takes less than the rupee price. */
  function convert(inr, code, cfg) {
    var r = Number(((cfg && cfg.fx) || {})[code]);
    if (code === 'INR' || !(r > 0)) return inr;
    return Math.max(1, Math.ceil(inr / r));
  }

  function money(n, code) {
    return (SYMBOL[code] || code + ' ') + (code === 'INR' ? nfIn(n) : nfAny(n));
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
      var opts = cfg.currencies.map(function (c) {
        return '<option value="' + c + '">' + c + (NAME[c] ? ' — ' + NAME[c] : '') + '</option>';
      }).join('');
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
          q.textContent = 'You pay ' + money(inr, 'INR') + '. UPI, cards, netbanking and wallets.';
          return;
        }
        q.textContent = 'You’ll be charged ' + money(convert(inr, code, cfg), code)
          + ' (the ' + money(inr, 'INR') + ' price at ₹' + cfg.fx[code] + ' = 1 ' + code
          + '). International cards and PayPal. Your bank may add its own conversion fee.';
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
  function chosen() {
    var s = stored() || guess();
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

  /* Every checkout button the pages know about, whenever it appears. */
  function scan() {
    ['buyPay', 'scPay', 'svcCoPay'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) attach(b);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
  else scan();
  try {
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) { /* the static buttons are still covered */ }
}());
