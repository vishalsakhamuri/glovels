'use strict';
/*
 * Patch 267: the marketing team's tags, and the events the site sends them.
 *
 * The office pastes IDs on Organisation → Traffic — nobody here needs their
 * logins. Each tag is off until its ID is typed and on every public page
 * from the next page served once it is. The portal and the office screens
 * are never tagged (serve.js only calls `head()` for public pages).
 *
 *   Google Analytics 4   G-…            page views + the events below
 *   Google Tag Manager   GTM-…          whatever the team configures there
 *   Google Ads           AW-… + labels  lead and purchase conversions
 *   Meta Pixel           ~15 digits     PageView, Lead, InitiateCheckout,
 *                                       Purchase, Contact — plus the
 *                                       Conversions API from this server
 *   Microsoft Clarity    project id     recordings and heatmaps
 *
 * Events are raised once, by window.glvTrack (serve.js's tracker), and fanned
 * out here to every tag that is on: the forms never learn which tags exist.
 *
 * CONSENT. The tags set cookies; in the EU, the UK and Switzerland that
 * needs a yes first. Three settings: `eu` (default) shows the banner to
 * visitors there and nobody else; `all` shows it to everybody; `off` shows
 * it to nobody. Google's tags run in consent mode (denied until the yes, so
 * Google still counts cookieless pings); the Meta pixel and Clarity are not
 * loaded at all until the yes. The answer is one first-party cookie for a
 * year, and "only essential" is as easy to press as "accept".
 */
const crypto = require('crypto');
const https = require('https');

const EU = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU',
  'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH']);

const RULES = {
  gaId: [/^G-[A-Z0-9]{4,20}$/, 'A Google Analytics measurement ID looks like G-XXXXXXXXXX (Google Analytics → Admin → Data streams).'],
  gtmId: [/^GTM-[A-Z0-9]{4,12}$/, 'A Google Tag Manager container ID looks like GTM-XXXXXXX (top right of the Tag Manager workspace).'],
  adsId: [/^AW-\d{6,15}$/, 'A Google Ads conversion ID looks like AW-123456789 (Google Ads → Goals → Conversions → the tag setup).'],
  adsLeadLabel: [/^[A-Za-z0-9_-]{4,40}$/, 'A conversion label is the part after the slash in AW-123456789/AbCdEfGh — letters, digits, - and _.'],
  adsPurchaseLabel: [/^[A-Za-z0-9_-]{4,40}$/, 'A conversion label is the part after the slash in AW-123456789/AbCdEfGh — letters, digits, - and _.'],
  pixelId: [/^\d{12,20}$/, 'A Meta Pixel ID is a number of about 15 digits (Meta Events Manager → Data sources → the pixel).'],
  capiToken: [/^[A-Za-z0-9_-]{40,400}$/, 'A Conversions API access token is a long string of letters and digits (Events Manager → Settings → Generate access token).'],
  clarityId: [/^[a-z0-9]{6,20}$/i, 'A Clarity project ID is a short string of letters and digits (Clarity → Settings → Overview).'],
};
const KEEP_CASE = k => k === 'clarityId' || k === 'capiToken' || /Label$/.test(k);
const CONSENT = ['eu', 'all', 'off'];
const ENV = { gaId: 'GA_ID', gtmId: 'GTM_ID', adsId: 'GOOGLE_ADS_ID', adsLeadLabel: 'GOOGLE_ADS_LEAD_LABEL', adsPurchaseLabel: 'GOOGLE_ADS_PURCHASE_LABEL',
  pixelId: 'META_PIXEL_ID', capiToken: 'META_CAPI_TOKEN', clarityId: 'CLARITY_ID' };

/** The settings as stored, with the environment as the fallback for each. */
function settingsOf(db) {
  let a = {};
  try { a = db.content('analytics') || {}; } catch (e) { a = {}; }
  const env = k => String(process.env[k] || '').trim();
  const out = {};
  for (const k of Object.keys(RULES)) {
    const v0 = String(a[k] || '').trim() || env(ENV[k]);
    const v = KEEP_CASE(k) ? v0 : v0.toUpperCase();
    out[k] = v && RULES[k][0].test(v) ? v : '';
  }
  out.consent = CONSENT.includes(String(a.consent || '').trim()) ? String(a.consent).trim()
    : (CONSENT.includes(env('CONSENT_BANNER')) ? env('CONSENT_BANNER') : 'eu');
  out.indexnowKey = /^[a-f0-9]{32}$/.test(String(a.indexnowKey || '')) ? String(a.indexnowKey) : '';
  out.updatedAt = a.updatedAt || ''; out.by = a.by || '';
  return out;
}

/** Validate what the office typed. Returns { ok, error, field } or { ok, values }. */
function validate(b) {
  const values = {};
  for (const k of Object.keys(RULES)) {
    const raw0 = String(b[k] == null ? '' : b[k]).trim();
    const raw = KEEP_CASE(k) ? raw0 : raw0.toUpperCase();
    if (!raw) { values[k] = ''; continue; }
    if (!RULES[k][0].test(raw)) return { ok: false, field: k, error: RULES[k][1] };
    values[k] = raw;
  }
  if ((values.adsLeadLabel || values.adsPurchaseLabel) && !values.adsId) return { ok: false, field: 'adsId', error: 'A conversion label needs the Google Ads conversion ID (AW-…) beside it.' };
  if (values.capiToken && !values.pixelId) return { ok: false, field: 'pixelId', error: 'The Conversions API token needs the Pixel ID beside it.' };
  const consent = String(b.consent || '').trim();
  if (consent && !CONSENT.includes(consent)) return { ok: false, field: 'consent', error: 'Consent banner: eu, all or off.' };
  values.consent = consent || 'eu';
  return { ok: true, values };
}

/** What the office screen may see: the token is never sent back whole. */
function shown(s) {
  const out = Object.assign({}, s);
  out.capiToken = s.capiToken ? '••••' + s.capiToken.slice(-4) : '';
  out.capiTokenSet = !!s.capiToken;
  return out;
}

/* ------------------------------------------------------------- the page */
const esc = v => String(v).replace(/[^A-Za-z0-9_\-]/g, '');

/** Does this visitor get the consent banner? */
function needsBanner(s, country) {
  if (s.consent === 'off') return false;
  if (s.consent === 'all') return true;
  return EU.has(String(country || '').toUpperCase());
}

/* The hook every form calls, extended to fan out. Kept tiny and defensive:
   a tag that is not on the page is a function that is not there, and that
   is not an error. */
const FANOUT_JS = `(function(){
var T=window.__glvTags||{};
function fb(ev,p,id){try{if(window.fbq){fbq("track",ev,p||{},id?{eventID:id}:undefined);}}catch(e){}}
function ads(label,p){try{if(window.gtag&&T.adsId&&label){var o={send_to:T.adsId+"/"+label};if(p&&p.value!=null)o.value=p.value;if(p&&p.currency)o.currency=p.currency;if(p&&p.transaction_id)o.transaction_id=p.transaction_id;gtag("event","conversion",o);}}catch(e){}}
window.glvTagEvent=function(n,p){p=p||{};
if(n==="generate_lead"){if(!T.capi)fb("Lead",{content_name:p.form||""},p.event_id);ads(T.adsLeadLabel,p);}
else if(n==="purchase"){fb("Purchase",{value:p.value,currency:p.currency||"INR",content_name:p.package||""},p.transaction_id?"purchase-"+p.transaction_id:undefined);ads(T.adsPurchaseLabel,p);}
else if(n==="begin_checkout"){fb("InitiateCheckout",{value:p.value,currency:p.currency||"INR"},p.transaction_id?"checkout-"+p.transaction_id:undefined);}
else if(n==="contact"){fb("Contact",{content_name:p.method||""});}
else if(n==="sign_up"){if(!T.capi)fb("Lead",{content_name:"signup"},p.event_id);ads(T.adsLeadLabel,p);}
else if(n==="search_wall"){fb("Search",{search_string:p.label||""});}};
window.glvConsent=function(yes){try{document.cookie="glv_consent="+(yes?"all":"essential")+";path=/;max-age=31536000;SameSite=Lax"+(location.protocol==="https:"?";Secure":"");}catch(e){}
try{if(window.gtag)gtag("consent","update",{ad_storage:yes?"granted":"denied",ad_user_data:yes?"granted":"denied",ad_personalization:yes?"granted":"denied",analytics_storage:yes?"granted":"denied"});}catch(e){}
if(yes){try{if(window.__glvLoadConsented)window.__glvLoadConsented();}catch(e){}}
var b=document.getElementById("glvConsent");if(b)b.remove();};
})();`;

/**
 * The <head> part. `opts.consent` is 'yes' | 'no' | 'ask' | 'none':
 * 'none' = no banner for this visitor, everything runs; 'yes' = they said
 * yes before; 'no' = they said only essential; 'ask' = banner now.
 */
function head(s, opts) {
  const consent = (opts && opts.consent) || 'none';
  const granted = consent === 'none' || consent === 'yes';
  const out = [];
  const cfg = {
    adsId: s.adsId, adsLeadLabel: s.adsLeadLabel, adsPurchaseLabel: s.adsPurchaseLabel,
    capi: !!(s.pixelId && s.capiToken), pixel: !!s.pixelId, consent,
  };
  out.push('<script data-tags>window.__glvTags=' + JSON.stringify(cfg) + ';' + FANOUT_JS + '</script>');

  const gtagIds = [s.gaId, s.adsId].filter(Boolean);
  if (gtagIds.length || s.gtmId) {
    /* Consent mode first, so no Google tag sets a cookie before the answer. */
    out.push('<script data-ga>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}'
      + (granted ? '' : 'gtag("consent","default",{ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied",analytics_storage:"denied",wait_for_update:500});')
      + (gtagIds.length ? 'gtag("js",new Date());' + gtagIds.map(id => 'gtag("config","' + esc(id) + '"' + (/^G-/.test(id) ? ',{anonymize_ip:true}' : '') + ');').join('') : '')
      + '</script>');
    if (gtagIds.length) out.push('<script async src="https://www.googletagmanager.com/gtag/js?id=' + esc(gtagIds[0]) + '"></script>');
    if (s.gtmId) {
      out.push('<script data-gtm>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({"gtm.start":new Date().getTime(),event:"gtm.js"});'
        + 'var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!="dataLayer"?"&l="+l:"";j.async=true;'
        + 'j.src="https://www.googletagmanager.com/gtm.js?id="+i+dl;f.parentNode.insertBefore(j,f);})(window,document,"script","dataLayer","' + esc(s.gtmId) + '");</script>');
    }
  }
  /* The pixel and Clarity: straight away when consent is not in question,
     otherwise held in a loader the yes button calls. */
  const later = [];
  if (s.pixelId) {
    later.push('!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};'
      + 'if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version="2.0";n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];'
      + 's.parentNode.insertBefore(t,s)}(window,document,"script","https://connect.facebook.net/en_US/fbevents.js");'
      + 'fbq("init","' + esc(s.pixelId) + '");fbq("track","PageView");');
  }
  if (s.clarityId) {
    later.push('(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;'
      + 't.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","' + esc(s.clarityId) + '");');
  }
  if (later.length) {
    out.push('<script data-consented>window.__glvLoadConsented=function(){if(window.__glvLoaded)return;window.__glvLoaded=1;' + later.join('') + '};'
      + (granted ? 'window.__glvLoadConsented();' : '') + '</script>');
  }
  return out.join('');
}

/** Right after <body>: GTM's noscript, and the banner when it is due. */
function body(s, opts) {
  const consent = (opts && opts.consent) || 'none';
  const out = [];
  if (s.gtmId) out.push('<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=' + esc(s.gtmId) + '" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>');
  if (consent === 'ask') {
    out.push('<div id="glvConsent" role="dialog" aria-label="Cookies" translate="no" style="position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;max-width:720px;margin:0 auto;'
      + 'background:#0f1f3d;color:#fff;border-radius:14px;padding:14px 16px;box-shadow:0 12px 40px rgba(0,0,0,.35);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;gap:12px;flex-wrap:wrap;align-items:center">'
      + '<span style="flex:1;min-width:220px">We use cookies to measure visits and our advertising. Essential cookies (signing in, your language) are always on. '
      + '<a href="/privacy" style="color:#f5d487;text-decoration:underline">Privacy policy</a></span>'
      + '<button type="button" onclick="glvConsent(false)" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,.5);border-radius:999px;padding:8px 14px;font:inherit;cursor:pointer">Only essential</button>'
      + '<button type="button" onclick="glvConsent(true)" style="background:#f5d487;color:#0f1f3d;border:0;border-radius:999px;padding:8px 16px;font:inherit;font-weight:700;cursor:pointer">Accept</button></div>');
  }
  return out.join('');
}

/** The visitor's consent state for this request. */
function consentOf(s, country, cookieValue) {
  if (!needsBanner(s, country)) return 'none';
  if (cookieValue === 'all') return 'yes';
  if (cookieValue === 'essential') return 'no';
  return 'ask';
}

/* ---------------------------------------------- Meta Conversions API */
const sha = v => crypto.createHash('sha256').update(String(v)).digest('hex');
const normEmail = e => String(e || '').trim().toLowerCase();
const normPhone = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 10 ? '91' + d : d; };

function postJson(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const req = (u.protocol === 'http:' ? require('http') : https).request({
      method: 'POST', hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search,
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length }, timeout: timeoutMs || 8000,
    }, res => { let t = ''; res.on('data', c => (t += c)); res.on('end', () => resolve({ status: res.statusCode, text: t })); });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end(payload);
  });
}

/* A short log of what was sent, for the office screen and the tests. */
const LOG = [];
const note = (kind, what, ok, detail) => { LOG.push({ at: new Date().toISOString(), kind, what, ok: !!ok, detail: String(detail || '').slice(0, 200) }); if (LOG.length > 50) LOG.shift(); };

/**
 * Send one event to Meta from the server. `ev`:
 *   { name: 'Lead'|'Purchase', id: 'lead-12', email, phone, ip, ua, url,
 *     fbp, fbc, value, currency, contentName }
 * Fire-and-forget: the caller never waits on Meta.
 */
function capi(s, ev) {
  if (!s.pixelId || !s.capiToken || !ev || !ev.name) return Promise.resolve(false);
  const base = String(process.env.META_CAPI_URL || 'https://graph.facebook.com/v21.0').replace(/\/$/, '');
  const url = base + '/' + s.pixelId + '/events?access_token=' + encodeURIComponent(s.capiToken);
  const user = {};
  if (ev.email) user.em = [sha(normEmail(ev.email))];
  if (ev.phone) user.ph = [sha(normPhone(ev.phone))];
  if (ev.ip && ev.ip !== 'unknown') user.client_ip_address = ev.ip;
  if (ev.ua) user.client_user_agent = String(ev.ua).slice(0, 300);
  if (ev.fbp) user.fbp = ev.fbp;
  if (ev.fbc) user.fbc = ev.fbc;
  const data = {
    event_name: ev.name, event_time: Math.floor(Date.now() / 1000), event_id: ev.id || undefined,
    action_source: 'website', event_source_url: ev.url || undefined, user_data: user,
  };
  if (ev.name === 'Purchase' || ev.value != null) data.custom_data = { value: Number(ev.value || 0), currency: ev.currency || 'INR', content_name: ev.contentName || undefined };
  else if (ev.contentName) data.custom_data = { content_name: ev.contentName };
  return postJson(url, { data: [data] }).then(r => {
    const ok = r.status >= 200 && r.status < 300;
    note('meta', ev.name + ' ' + (ev.id || ''), ok, ok ? r.text.slice(0, 80) : 'HTTP ' + r.status + ' ' + r.text.slice(0, 120));
    return ok;
  }).catch(e => { note('meta', ev.name + ' ' + (ev.id || ''), false, e.message); return false; });
}

/* ------------------------------------------------------------ IndexNow */
/** The key: made once, kept in the settings, served at /<key>.txt. */
function indexnowKey(db) {
  const s = settingsOf(db);
  if (s.indexnowKey) return s.indexnowKey;
  const key = crypto.randomBytes(16).toString('hex');
  try {
    const a = Object.assign({}, db.content('analytics') || {}, { indexnowKey: key });
    db.setContent('analytics', a, 'system');
  } catch (e) { return ''; }
  return key;
}

/** Tell Bing (and everybody on IndexNow) that these addresses changed. */
function indexnow(db, siteUrl, urls) {
  const key = indexnowKey(db);
  const host = (() => { try { return new URL(siteUrl).hostname; } catch (e) { return ''; } })();
  if (!key || !host || !urls || !urls.length) return Promise.resolve(false);
  const endpoint = String(process.env.INDEXNOW_URL || 'https://api.indexnow.org/indexnow');
  const body = { host, key, keyLocation: siteUrl.replace(/\/$/, '') + '/' + key + '.txt', urlList: urls.slice(0, 1000) };
  return postJson(endpoint, body).then(r => {
    const ok = r.status >= 200 && r.status < 300;
    note('indexnow', urls.length + ' address' + (urls.length === 1 ? '' : 'es'), ok, ok ? 'HTTP ' + r.status : 'HTTP ' + r.status + ' ' + r.text.slice(0, 120));
    return ok;
  }).catch(e => { note('indexnow', urls.length + ' addresses', false, e.message); return false; });
}

module.exports = { settingsOf, validate, shown, head, body, consentOf, needsBanner, capi, indexnow, indexnowKey, log: () => LOG.slice().reverse(), EU, RULES };
