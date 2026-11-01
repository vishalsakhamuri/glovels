'use strict';
/*
 * Patch 204: the outside channels, read into the marketing board.
 *
 *  GOOGLE SEARCH CONSOLE — what people typed into Google before they saw
 *  Glovels: every keyword with its impressions, clicks, click-through rate and
 *  average position; the keywords RISING against the four weeks before (the
 *  trending topics); and the OPPORTUNITIES — searched often, shown on page
 *  one or two, rarely clicked — which is where a better title or a new page
 *  pays first. A service account (JSON key) that has been added as a user on
 *  the Search Console property; no person signs in.
 *
 *      GSC_SERVICE_ACCOUNT   the JSON key (as is, or base64)
 *      GSC_SITE              sc-domain:glovels.com  or  https://glovels.com/
 *
 *  META (Facebook + Instagram) — the ad account's spend, reach, impressions,
 *  clicks, CTR and cost per click, per campaign, per platform (Facebook /
 *  Instagram) and per country; and, when an Instagram business account is
 *  named, its followers and reach. The month's spend is copied into the
 *  spend book so cost per lead works without typing it.
 *
 *      META_ACCESS_TOKEN     a system-user token with ads_read (+ instagram_basic,
 *                            instagram_manage_insights for the Instagram part)
 *      META_AD_ACCOUNT       act_1234567890
 *      META_IG_USER          the Instagram business account id (optional)
 *
 * Both answers are kept for six hours; "Refresh" asks again. Nothing here
 * runs unless its keys are set.
 */
const crypto = require('crypto');
const https = require('https');
const http = require('http');

const CACHE_MS = 6 * 3600 * 1000;
const env = k => String(process.env[k] || '').trim();

function request(method, href, { headers, body, timeout } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(href);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, { method, headers: headers || {}, timeout: timeout || 20000 }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = JSON.parse(raw); } catch (e) { data = { raw }; }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const day = (n, from) => new Date((from || Date.now()) - n * 86400000).toISOString().slice(0, 10);

/* ------------------------------------------------------- Search Console */
function gscKey() {
  const raw = env('GSC_SERVICE_ACCOUNT');
  if (!raw) return null;
  try {
    const txt = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const k = JSON.parse(txt);
    return k.client_email && k.private_key ? k : null;
  } catch (e) { return null; }
}

let gscToken = { value: '', until: 0 };
async function googleToken(key) {
  if (gscToken.value && Date.now() < gscToken.until) return gscToken.value;
  const tokenUrl = env('GOOGLE_TOKEN_URL') || 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'RS256', typ: 'JWT' });
  const claim = enc({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: tokenUrl, iat: now, exp: now + 3600 });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(head + '.' + claim), key.private_key).toString('base64url');
  const body = 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + head + '.' + claim + '.' + sig;
  const r = await request('POST', tokenUrl, { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }, body });
  if (r.status !== 200 || !r.data.access_token) throw new Error('Google refused the key: ' + ((r.data.error_description || r.data.error) || r.status));
  gscToken = { value: r.data.access_token, until: Date.now() + (Number(r.data.expires_in || 3600) - 120) * 1000 };
  return gscToken.value;
}

async function gscQuery(token, site, body) {
  const base = env('GSC_API_BASE') || 'https://searchconsole.googleapis.com';
  const href = base + '/webmasters/v3/sites/' + encodeURIComponent(site) + '/searchAnalytics/query';
  const payload = JSON.stringify(body);
  const r = await request('POST', href, { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload) }, body: payload });
  if (r.status !== 200) throw new Error('Search Console said ' + r.status + ': ' + (((r.data || {}).error || {}).message || ''));
  return (r.data.rows || []).map(x => ({ key: x.keys, clicks: x.clicks || 0, impressions: x.impressions || 0,
    ctr: +(100 * (x.ctr || 0)).toFixed(2), position: +(x.position || 0).toFixed(1) }));
}

/** Keywords, pages, countries, devices, rising keywords and opportunities. */
async function searchConsole(days) {
  const key = gscKey(), site = env('GSC_SITE');
  if (!key || !site) return { connected: false, why: !key ? 'GSC_SERVICE_ACCOUNT is not set (or is not a service-account JSON key).' : 'GSC_SITE is not set.' };
  days = Math.max(7, Math.min(90, Number(days) || 28));
  const token = await googleToken(key);
  /* Search Console runs about two days behind. */
  const end = day(2), start = day(2 + days - 1), pEnd = day(2 + days), pStart = day(2 + 2 * days - 1);
  const q = (dims, s, e, n) => gscQuery(token, site, { startDate: s, endDate: e, dimensions: dims, rowLimit: n || 250 });
  const [kw, kwPrev, pages, countries, devices, trend] = await Promise.all([
    q(['query'], start, end, 1000), q(['query'], pStart, pEnd, 1000), q(['page'], start, end, 100),
    q(['country'], start, end, 60), q(['device'], start, end, 5), q(['date'], start, end, 100),
  ]);
  const prev = {}; kwPrev.forEach(r => { prev[r.key[0]] = r; });
  const keywords = kw.map(r => ({ q: r.key[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
    prevImpressions: (prev[r.key[0]] || {}).impressions || 0, prevPosition: (prev[r.key[0]] || {}).position || null }));
  const totals = keywords.reduce((t, k) => { t.clicks += k.clicks; t.impressions += k.impressions; return t; }, { clicks: 0, impressions: 0 });
  const pt = kwPrev.reduce((t, k) => { t.clicks += k.clicks; t.impressions += k.impressions; return t; }, { clicks: 0, impressions: 0 });
  totals.ctr = totals.impressions ? +(100 * totals.clicks / totals.impressions).toFixed(2) : 0;
  totals.position = keywords.length ? +(keywords.reduce((n, k) => n + k.position * k.impressions, 0) / Math.max(1, totals.impressions)).toFixed(1) : 0;
  return {
    connected: true, site, start, end, totals, previous: pt,
    keywords: keywords.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 200),
    /* Trending: most new impressions against the same span before. */
    rising: keywords.filter(k => k.impressions >= 10 && k.impressions > 1.5 * k.prevImpressions)
      .map(k => Object.assign({ growth: k.prevImpressions ? Math.round(100 * (k.impressions - k.prevImpressions) / k.prevImpressions) : null }, k))
      .sort((a, b) => (b.impressions - b.prevImpressions) - (a.impressions - a.prevImpressions)).slice(0, 30),
    /* Where a better title pays first: seen a lot, on page one or two, rarely clicked. */
    opportunities: keywords.filter(k => k.impressions >= 50 && k.position >= 3 && k.position <= 20 && k.ctr < 3)
      .sort((a, b) => b.impressions - a.impressions).slice(0, 30),
    pages: pages.map(r => ({ page: r.key[0].replace(/^https?:\/\/[^/]+/, '') || '/', clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
    countries: countries.map(r => ({ code: String(r.key[0]).toUpperCase(), clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
    devices: devices.map(r => ({ name: r.key[0].toLowerCase(), clicks: r.clicks, impressions: r.impressions, ctr: r.ctr })),
    trend: trend.map(r => ({ day: r.key[0], clicks: r.clicks, impressions: r.impressions })).sort((a, b) => a.day < b.day ? -1 : 1),
  };
}

/* ----------------------------------------------------------------- Meta */
const ISO3 = { /* Meta answers countries in two letters already */ };
async function metaGet(path, params) {
  const base = env('META_API_BASE') || 'https://graph.facebook.com/v21.0';
  const u = new URL(base + path);
  Object.entries(params || {}).forEach(([k, v]) => u.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v)));
  u.searchParams.set('access_token', env('META_ACCESS_TOKEN'));
  const r = await request('GET', u.toString());
  if (r.status !== 200) throw new Error('Meta said ' + r.status + ': ' + (((r.data || {}).error || {}).message || ''));
  return r.data;
}
const num = v => Number(v || 0);
const leadsOf = actions => (actions || []).filter(a => /lead|complete_registration|contact/.test(a.action_type))
  .reduce((n, a) => n + num(a.value), 0);

async function meta(days) {
  const token = env('META_ACCESS_TOKEN'), acct = env('META_AD_ACCOUNT');
  if (!token || !acct) return { connected: false, why: !token ? 'META_ACCESS_TOKEN is not set.' : 'META_AD_ACCOUNT is not set.' };
  days = Math.max(1, Math.min(90, Number(days) || 30));
  const range = { since: day(days - 1), until: day(0) };
  const fields = 'campaign_name,spend,impressions,reach,clicks,inline_link_clicks,ctr,cpc,actions,account_currency';
  const id = acct.startsWith('act_') ? acct : 'act_' + acct;
  const [camps, plats, ctrs, daily] = await Promise.all([
    metaGet('/' + id + '/insights', { level: 'campaign', fields, time_range: range, limit: '200' }),
    metaGet('/' + id + '/insights', { level: 'account', fields, time_range: range, breakdowns: 'publisher_platform' }),
    metaGet('/' + id + '/insights', { level: 'account', fields, time_range: range, breakdowns: 'country', limit: '100' }),
    metaGet('/' + id + '/insights', { level: 'account', fields: 'spend,impressions,clicks', time_range: range, time_increment: '1' }),
  ]);
  const shape = r => ({ spend: num(r.spend), impressions: num(r.impressions), reach: num(r.reach),
    clicks: num(r.inline_link_clicks || r.clicks), ctr: +num(r.ctr).toFixed(2), cpc: +num(r.cpc).toFixed(2), leads: leadsOf(r.actions) });
  const out = {
    connected: true, account: id, currency: ((camps.data || [])[0] || (plats.data || [])[0] || {}).account_currency || '',
    since: range.since, until: range.until,
    campaigns: (camps.data || []).map(r => Object.assign({ name: r.campaign_name }, shape(r))).sort((a, b) => b.spend - a.spend),
    platforms: (plats.data || []).map(r => Object.assign({ name: r.publisher_platform === 'instagram' ? 'Instagram'
      : r.publisher_platform === 'facebook' ? 'Facebook' : r.publisher_platform === 'audience_network' ? 'Audience Network'
        : r.publisher_platform === 'messenger' ? 'Messenger' : String(r.publisher_platform || '') }, shape(r))),
    countries: (ctrs.data || []).map(r => Object.assign({ code: String(r.country || '').toUpperCase() }, shape(r))).sort((a, b) => b.spend - a.spend),
    daily: (daily.data || []).map(r => ({ day: r.date_start, spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks) })),
  };
  out.totals = out.platforms.reduce((t, p) => { ['spend', 'impressions', 'reach', 'clicks', 'leads'].forEach(k => { t[k] += p[k]; }); return t; },
    { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0 });
  out.totals.ctr = out.totals.impressions ? +(100 * out.totals.clicks / out.totals.impressions).toFixed(2) : 0;
  out.totals.cpc = out.totals.clicks ? +(out.totals.spend / out.totals.clicks).toFixed(2) : 0;
  const ig = env('META_IG_USER');
  if (ig) {
    try {
      const prof = await metaGet('/' + ig, { fields: 'username,followers_count,media_count' });
      const ins = await metaGet('/' + ig + '/insights', { metric: 'reach,profile_views,website_clicks', period: 'day',
        since: String(Math.floor(Date.parse(range.since) / 1000)), until: String(Math.floor(Date.now() / 1000)) });
      const sum = name => ((ins.data || []).find(x => x.name === name) || { values: [] }).values.reduce((n, v) => n + num(v.value), 0);
      out.instagram = { username: prof.username, followers: num(prof.followers_count), posts: num(prof.media_count),
        reach: sum('reach'), profileViews: sum('profile_views'), websiteClicks: sum('website_clicks') };
    } catch (e) { out.instagram = { error: String(e.message || e) }; }
  }
  return out;
}

/* ------------------------------------------------------------- the pair */
function open({ db, log = console }) {
  const cache = {};
  async function cached(name, days, fn, force) {
    const k = name + ':' + days;
    const c = cache[k];
    if (!force && c && Date.now() - c.at < CACHE_MS) return Object.assign({ cachedAt: new Date(c.at).toISOString() }, c.value);
    try {
      const value = await fn(days);
      if (value.connected) cache[k] = { at: Date.now(), value };
      return Object.assign({ cachedAt: new Date().toISOString() }, value);
    } catch (e) {
      log.error('  ' + name + ' ✗ ' + (e && e.message));
      if (c) return Object.assign({ cachedAt: new Date(c.at).toISOString(), stale: true, error: String(e.message || e) }, c.value);
      return { connected: true, error: String(e.message || e) };
    }
  }
  /** Meta's spend for this month and last, into the spend book. */
  function bookMetaSpend(m) {
    if (!m || !m.connected || m.error || !Array.isArray(m.daily)) return;
    const cur = (m.currency || 'INR').toUpperCase();
    const byMonth = {};
    m.daily.forEach(d => { const mo = String(d.day).slice(0, 7); byMonth[mo] = (byMonth[mo] || 0) + d.spend; });
    Object.entries(byMonth).forEach(([mo, spend]) => {
      /* Split by platform in the proportion the span shows. */
      const tot = m.platforms.reduce((n, p) => n + p.spend, 0) || 1;
      const rows = m.platforms.filter(p => p.spend > 0).map(p => ({
        channel: p.name === 'Instagram' ? 'Instagram Ads' : 'Facebook Ads',
        amountMinor: Math.round(100 * spend * p.spend / tot), currency: cur, note: 'From Meta', by: 'Meta',
      }));
      try { db.replaceImportedSpend('meta', mo, rows.length ? rows : [{ channel: 'Meta Ads', amountMinor: Math.round(100 * spend), currency: cur, note: 'From Meta', by: 'Meta' }]); } catch (e) {}
    });
  }
  return {
    status: () => ({
      searchConsole: { connected: !!(gscKey() && env('GSC_SITE')), site: env('GSC_SITE') },
      meta: { connected: !!(env('META_ACCESS_TOKEN') && env('META_AD_ACCOUNT')), instagram: !!env('META_IG_USER') },
    }),
    seo: (days, force) => cached('gsc', days, searchConsole, force),
    meta: async (days, force) => { const m = await cached('meta', days, meta, force); bookMetaSpend(m); return m; },
  };
}

module.exports = { open, searchConsole, meta };
