'use strict';
/*
 * Patch 280: Cloudflare Turnstile — the free "are you a person" check on the
 * public forms (sign-up, enquiry / counselling / booking, website chat,
 * guest application, forgot password).
 *
 * "There's no CAPTCHA on the forms — pls add it" — Vishal, 7 Nov
 *
 * Why Turnstile: free with no limits, no puzzles for most people (it decides
 * in the background and only shows a tick box when unsure), no Google
 * tracking, and nothing to install — the browser loads one script from
 * challenges.cloudflare.com and the server asks Cloudflare whether the
 * answer it got is real. It does NOT need the domain to be on Cloudflare.
 *
 * Off until BOTH keys are set on Render:
 *   TURNSTILE_SITEKEY  — public, goes into the page
 *   TURNSTILE_SECRET   — private, only ever sent to Cloudflare
 * TURNSTILE=off turns it off again without removing the keys.
 *
 * Rules:
 *  - No answer, or an answer Cloudflare says is wrong/used/expired → refused.
 *  - Cloudflare itself unreachable (timeout, 5xx) → let through and logged.
 *    A lost student enquiry costs more than one spam message, and the guard
 *    (page token, robot check, 3-second rule) and the rate limits still apply.
 *  - Staff and signed-in students are never asked.
 */
const VERIFY_URL = process.env.TURNSTILE_VERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function open({ sitekey, secret, enabled, log = console, timeoutMs = 5000, verifyUrl = VERIFY_URL } = {}) {
  sitekey = String(sitekey || '').trim();
  secret = String(secret || '').trim();
  const on = !!(sitekey && secret) && enabled !== false;
  const stats = { passed: 0, refused: 0, missing: 0, unreachable: 0, since: new Date().toISOString() };

  /**
   * Check the answer the browser sent (X-Glv-Ts header).
   * Returns { ok:true } or { ok:false, status, body }.
   */
  async function check(req, ip) {
    if (!on) return { ok: true };
    const token = String(req.headers['x-glv-ts'] || '').trim();
    if (!token || token.length > 2048) {
      stats.missing++;
      return { ok: false, status: 403, body: { error: 'Please tick the "I am human" check and send again.', captcha: true } };
    }
    let res;
    try {
      const form = new URLSearchParams({ secret, response: token });
      if (ip) form.set('remoteip', ip);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        res = await fetch(verifyUrl, { method: 'POST', body: form, signal: ctl.signal,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      } finally { clearTimeout(timer); }
      if (res.status >= 500) throw new Error('Cloudflare answered ' + res.status);
      const j = await res.json();
      if (j && j.success === true) { stats.passed++; return { ok: true }; }
      stats.refused++;
      const codes = (j && j['error-codes']) || [];
      /* A wrong secret is our mistake, not the visitor's — say so loudly
         and let the form through rather than turning every student away. */
      if (codes.includes('invalid-input-secret') || codes.includes('missing-input-secret')) {
        log.error('  turnstile ✗ TURNSTILE_SECRET is wrong — check it on Render. Letting forms through meanwhile.');
        return { ok: true, misconfigured: true };
      }
      return { ok: false, status: 403, body: { error: 'The "I am human" check did not go through — please try again.', captcha: true, retry: true } };
    } catch (e) {
      stats.unreachable++;
      log.error('  turnstile: Cloudflare not reachable (' + (e && e.name === 'AbortError' ? 'timeout' : (e && e.message) || e) + ') — form let through');
      return { ok: true, unreachable: true };
    }
  }

  /** What a page needs to know: the public key, or nothing. */
  function meta() { return on ? '<meta name="glv-ts" content="' + sitekey.replace(/[^A-Za-z0-9_-]/g, '') + '">' : ''; }
  function status() { return Object.assign({ enabled: on }, stats); }

  return { check, meta, status, enabled: on };
}

/* The browser side, appended to the guard script on every public page.
   For a POST to one of the protected forms it gets a fresh answer from an
   invisible widget (shown as a small box at the bottom only when Cloudflare
   wants a tick), adds it as X-Glv-Ts, then sends. One answer per send. */
const CLIENT_JS = `(function(){var m=document.querySelector('meta[name="glv-ts"]');var key=m&&m.content;if(!key||window.__glvTs)return;window.__glvTs=1;
var PROT=/^\\/(api\\/(auth\\/signup|auth\\/forgot|enquiries|assist|apply|chat\\/start)|send\\.php)$/;
var need=function(u,o){try{var x=new URL(u,location.href);return x.origin===location.origin&&PROT.test(x.pathname)&&String((o&&o.method)||'GET').toUpperCase()==='POST';}catch(e){return false;}};
var ld=null;function load(){if(ld)return ld;ld=new Promise(function(ok,no){if(window.turnstile)return ok();window.__glvTsReady=function(){ok();};var s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__glvTsReady';s.async=true;s.onerror=function(){ld=null;no(new Error('load'));};document.head.appendChild(s);});return ld;}
var box,wid=null,q=[];function get(){return load().then(function(){return new Promise(function(ok,no){
if(!box){box=document.createElement('div');box.style.cssText='position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:10000';document.body.appendChild(box);}
q.push({ok:ok,no:no});if(wid===null){wid=turnstile.render(box,{sitekey:key,appearance:'interaction-only',execution:'execute',
callback:function(t){var w=q.splice(0);w.forEach(function(p){p.ok(t);});setTimeout(function(){try{turnstile.reset(wid);}catch(e){}},0);},
'error-callback':function(){var w=q.splice(0);w.forEach(function(p){p.no(new Error('check'));});},'timeout-callback':function(){try{turnstile.reset(wid);}catch(e){}}});}
if(q.length===1)try{turnstile.execute(wid);}catch(e){}setTimeout(function(){var i=q.findIndex(function(p){return p.ok===ok;});if(i>=0){q.splice(i,1);no(new Error('slow'));}},60000);});});}
if(document.readyState!=='loading')setTimeout(load,1500);else document.addEventListener('DOMContentLoaded',function(){setTimeout(load,1500);});
var F=window.fetch;window.fetch=function(u,o){var url=typeof u==='string'?u:(u&&u.url)||'';if(!need(url,o))return F.apply(this,arguments);var self=this;
return get().then(function(t){o=Object.assign({},o||{});var h=new Headers(o.headers||{});h.set('X-Glv-Ts',t);o.headers=h;return F.call(self,u,o);},function(){return F.call(self,u,o);});};})();`;

module.exports = { open, CLIENT_JS };
