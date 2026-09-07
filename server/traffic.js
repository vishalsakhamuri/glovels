'use strict';
/*
 * How the site is found — counted here, on the server, from the requests
 * themselves.
 *
 * Google Analytics answers "how many people came from Google". It cannot
 * answer the question the office is going to ask in 2026, which is "is
 * ChatGPT sending us anyone, and has Claude even read our pages?" — because
 * the readers those assistants send out do not run scripts, and a good share
 * of the people they send arrive with an ad-blocker that strips the tag.
 * A page served is a fact the server already has. So: one row per public
 * page served, with the referrer sorted into where it came from, and the
 * crawlers kept apart and named.
 *
 * Nothing that identifies a person is kept. The visitor column is a hash of
 * address + browser + the day + a secret kept on the server, so two views on
 * one day count as one visitor and tomorrow the same person is a stranger.
 *
 * Kept for 180 days. At a thousand views a day that is under 200,000 rows —
 * a few tens of megabytes on the disk, read in a moment.
 */
const crypto = require('crypto');

const KEEP_DAYS = 180;

/* The assistants and the engines, by the host they send people from. Order
   matters only for the first match. */
const AI_SITES = [
  ['chatgpt.com', 'ChatGPT'], ['chat.openai.com', 'ChatGPT'], ['openai.com', 'ChatGPT'],
  ['claude.ai', 'Claude'], ['anthropic.com', 'Claude'],
  ['perplexity.ai', 'Perplexity'],
  ['gemini.google.com', 'Gemini'], ['bard.google.com', 'Gemini'],
  ['copilot.microsoft.com', 'Copilot'], ['bing.com/chat', 'Copilot'],
  ['you.com', 'You.com'], ['meta.ai', 'Meta AI'], ['grok.com', 'Grok'], ['x.ai', 'Grok'],
  ['duckduckgo.com/aichat', 'DuckDuckGo AI'], ['mistral.ai', 'Mistral'], ['chat.deepseek.com', 'DeepSeek'],
];
const SEARCH_SITES = [
  ['google.', 'Google'], ['bing.com', 'Bing'], ['duckduckgo.com', 'DuckDuckGo'],
  ['yahoo.', 'Yahoo'], ['yandex.', 'Yandex'], ['baidu.com', 'Baidu'], ['ecosia.org', 'Ecosia'],
  ['brave.com', 'Brave'], ['startpage.com', 'Startpage'],
];
const SOCIAL_SITES = [
  ['instagram.com', 'Instagram'], ['facebook.com', 'Facebook'], ['fb.com', 'Facebook'],
  ['linkedin.com', 'LinkedIn'], ['youtube.com', 'YouTube'], ['youtu.be', 'YouTube'],
  ['t.co', 'X'], ['twitter.com', 'X'], ['x.com', 'X'], ['whatsapp.com', 'WhatsApp'],
  ['reddit.com', 'Reddit'], ['quora.com', 'Quora'], ['telegram.', 'Telegram'], ['pinterest.', 'Pinterest'],
];

/* The crawlers, by the name they give in User-Agent. "AI" for the ones that
   feed an assistant — a visit from GPTBot or ClaudeBot is that assistant
   reading the page; "search" for the engines; "other" for the rest. */
const BOTS = [
  [/GPTBot/i, 'GPTBot (OpenAI training)', 'ai'],
  [/OAI-SearchBot/i, 'OAI-SearchBot (ChatGPT search)', 'ai'],
  [/ChatGPT-User/i, 'ChatGPT-User (a ChatGPT answer)', 'ai'],
  [/ClaudeBot/i, 'ClaudeBot (Anthropic)', 'ai'],
  [/Claude-User/i, 'Claude-User (a Claude answer)', 'ai'],
  [/Claude-SearchBot/i, 'Claude-SearchBot', 'ai'],
  [/anthropic-ai/i, 'anthropic-ai', 'ai'],
  [/PerplexityBot/i, 'PerplexityBot', 'ai'],
  [/Perplexity-User/i, 'Perplexity-User (a Perplexity answer)', 'ai'],
  [/Google-Extended/i, 'Google-Extended (Gemini training)', 'ai'],
  [/GoogleOther/i, 'GoogleOther', 'ai'],
  [/Applebot-Extended/i, 'Applebot-Extended (Apple Intelligence)', 'ai'],
  [/Amazonbot/i, 'Amazonbot (Alexa)', 'ai'],
  [/meta-externalagent|FacebookBot/i, 'Meta AI', 'ai'],
  [/Bytespider/i, 'Bytespider (ByteDance)', 'ai'],
  [/CCBot/i, 'CCBot (Common Crawl)', 'ai'],
  [/cohere-ai/i, 'Cohere', 'ai'],
  [/YouBot/i, 'YouBot (You.com)', 'ai'],
  [/DuckAssistBot/i, 'DuckAssistBot', 'ai'],
  [/MistralAI-User/i, 'Mistral', 'ai'],
  [/Diffbot/i, 'Diffbot', 'ai'],
  [/Googlebot/i, 'Googlebot', 'search'],
  [/AdsBot-Google|Google-InspectionTool|Storebot-Google/i, 'Google (other)', 'search'],
  [/bingbot/i, 'Bingbot', 'search'],
  [/DuckDuckBot/i, 'DuckDuckBot', 'search'],
  [/Applebot/i, 'Applebot', 'search'],
  [/YandexBot/i, 'YandexBot', 'search'],
  [/Baiduspider/i, 'Baiduspider', 'search'],
  [/Slurp/i, 'Yahoo Slurp', 'search'],
  [/AhrefsBot|SemrushBot|MJ12bot|DotBot|PetalBot|DataForSeoBot/i, 'SEO tools', 'other'],
  [/facebookexternalhit|Twitterbot|LinkedInBot|WhatsApp|TelegramBot|Slackbot|Discordbot/i, 'Link previews', 'other'],
  [/UptimeRobot|Pingdom|StatusCake|Render/i, 'Uptime checks', 'other'],
  [/HeadlessChrome|PhantomJS|Playwright|Puppeteer/i, 'Headless browsers', 'other'],
  [/bot|crawl|spider|scrapy|python-requests|curl\/|wget\/|Go-http-client|libwww|HttpClient/i, 'Other crawlers', 'other'],
];

function botOf(ua) {
  if (!ua) return { bot: 'No user agent', group: 'other' };
  for (const [re, name, group] of BOTS) if (re.test(ua)) return { bot: name, group };
  return null;
}

function deviceOf(ua) {
  if (/iPad|Tablet|Kindle|Silk/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone/i.test(ua)) return 'phone';
  return 'desktop';
}

const hostOf = ref => {
  try { return new URL(ref).host.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; }
};

/**
 * Where a visit came from: the referrer's host and the UTM fields sorted into
 * one of: ai, search, social, campaign, referral, direct.
 */
function sourceOf(ref, query, ownHost) {
  const host = hostOf(ref);
  let full = host;
  try { if (host) full = (host + new URL(ref).pathname).toLowerCase(); } catch (e) {}
  const q = query || {};
  const campaign = String(q.utm_campaign || '').slice(0, 80);
  const medium = String(q.utm_medium || '').slice(0, 40);
  const utmSource = String(q.utm_source || '').slice(0, 60);

  const find = (list, s) => { for (const [k, name] of list) if (s.includes(k)) return name; return ''; };
  /* utm_source is a word, not a host — "instagram", "chatgpt" — so it is
     matched against the names as well as the hosts. */
  const named = (list, s) => {
    if (!s) return '';
    for (const [k, name] of list) if (name.toLowerCase() === s || k.startsWith(s + '.') || k === s) return name;
    return '';
  };
  const ai = find(AI_SITES, full) || named(AI_SITES, utmSource.toLowerCase());
  if (ai) return { source: 'ai', site: ai, campaign, medium };
  const search = find(SEARCH_SITES, host);
  if (search) return { source: /cpc|ppc|paid/i.test(medium) ? 'ads' : 'search', site: search, campaign, medium };
  const social = find(SOCIAL_SITES, host) || named(SOCIAL_SITES, utmSource.toLowerCase());
  if (social) return { source: 'social', site: social, campaign, medium };
  if (campaign || utmSource) return { source: /cpc|ppc|paid|ads?/i.test(medium) ? 'ads' : 'campaign', site: utmSource || 'campaign', campaign, medium };
  if (!host || host === ownHost) return { source: 'direct', site: '', campaign, medium };
  return { source: 'referral', site: host.slice(0, 80), campaign, medium };
}

function open({ db, log = console }) {
  /* The salt for the visitor hash, minted once and kept, so a restart in the
     middle of a day does not turn every visitor into a new one. */
  let secret = '';
  try {
    const t = db.content('traffic') || {};
    if (!t.salt) { t.salt = crypto.randomBytes(16).toString('hex'); db.setContent('traffic', t, 'system'); }
    secret = t.salt;
  } catch (e) { secret = crypto.randomBytes(16).toString('hex'); }
  let lastPrune = '';

  /** One page served. `path` is the canonical path; `query` the parsed query. */
  function record(req, path, query) {
    try {
      const ua = String(req.headers['user-agent'] || '');
      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      const bot = botOf(ua);
      const ownHost = String(req.headers.host || '').replace(/^www\./, '').toLowerCase();
      const row = { day, ts: now.toISOString(), path: String(path).slice(0, 200) };
      if (bot) {
        Object.assign(row, { kind: 'bot', bot: bot.bot, source: bot.group });
      } else {
        const ip = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim()
          || (req.socket && req.socket.remoteAddress) || '';
        const visitor = crypto.createHmac('sha256', secret).update(ip + '|' + ua + '|' + day).digest('hex').slice(0, 16);
        Object.assign(row, { kind: 'page', device: deviceOf(ua), visitor },
          sourceOf(String(req.headers.referer || ''), query, ownHost));
      }
      db.hit(row);
      if (day !== lastPrune) {
        lastPrune = day;
        const cutoff = new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
        db.pruneHits(cutoff);
      }
    } catch (e) {
      log.error('  traffic ✗ ' + (e && e.message));
    }
  }

  const top = (map, n) => Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([name, count]) => ({ name, count }));

  /** The last `days` days, summarised for the Organisation screen. */
  function summary(days) {
    days = Math.max(1, Math.min(180, Number(days) || 30));
    const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
    const rows = db.hitsSince(since);
    const byDay = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - (days - 1 - i) * 86400000).toISOString().slice(0, 10);
      byDay[d] = { day: d, views: 0, visitors: new Set(), ai: 0, search: 0, bots: 0 };
    }
    const sources = {}, aiSites = {}, searchSites = {}, socialSites = {}, referrals = {};
    const pages = {}, campaigns = {}, devices = {}, bots = {}, aiPages = {};
    const visitors = new Set();
    let views = 0, botHits = 0;

    rows.forEach(h => {
      const d = byDay[h.day];
      if (h.kind === 'bot') {
        botHits++;
        if (d) d.bots++;
        const b = bots[h.bot] || (bots[h.bot] = { name: h.bot, group: h.source, hits: 0, pages: new Set(), last: '' });
        b.hits++; b.pages.add(h.path); if (h.ts > b.last) b.last = h.ts;
        if (h.source === 'ai') aiPages[h.path] = (aiPages[h.path] || 0) + 1;
        return;
      }
      views++;
      visitors.add(h.visitor);
      if (d) { d.views++; d.visitors.add(h.visitor); if (h.source === 'ai') d.ai++; if (h.source === 'search') d.search++; }
      sources[h.source] = (sources[h.source] || 0) + 1;
      if (h.source === 'ai') aiSites[h.site] = (aiSites[h.site] || 0) + 1;
      if (h.source === 'search' || h.source === 'ads') searchSites[h.site] = (searchSites[h.site] || 0) + 1;
      if (h.source === 'social') socialSites[h.site] = (socialSites[h.site] || 0) + 1;
      if (h.source === 'referral') referrals[h.site] = (referrals[h.site] || 0) + 1;
      if (h.campaign) campaigns[h.campaign + (h.medium ? ' · ' + h.medium : '')] = (campaigns[h.campaign + (h.medium ? ' · ' + h.medium : '')] || 0) + 1;
      pages[h.path] = (pages[h.path] || 0) + 1;
      devices[h.device] = (devices[h.device] || 0) + 1;
    });

    /* Enquiries and orders over the same days, by where the lead said it came
       from — the finder, the contact page, a blog post, the chat. */
    const enquiries = db.allEnquiries().filter(e => String(e.created_at).slice(0, 10) >= since);
    const enqBy = {}, enqByDay = {};
    enquiries.forEach(e => {
      const s = sourceOf(String(e.referrer || ''), {}, '');
      const label = s.source === 'direct' ? (e.source || 'website') : s.site || s.source;
      enqBy[label] = (enqBy[label] || 0) + 1;
      const d = String(e.created_at).slice(0, 10);
      enqByDay[d] = (enqByDay[d] || 0) + 1;
    });
    const orders = db.allOrders().filter(o => String(o.created_at).slice(0, 10) >= since);
    const paid = orders.filter(o => o.status === 'paid' || Number(o.paid_paise) > 0);

    return {
      days, since,
      totals: {
        views, visitors: visitors.size, botHits,
        ai: sources.ai || 0, search: (sources.search || 0) + (sources.ads || 0),
        enquiries: enquiries.length, orders: orders.length, paid: paid.length,
        aiCrawls: Object.values(bots).filter(b => b.group === 'ai').reduce((n, b) => n + b.hits, 0),
      },
      byDay: Object.values(byDay).map(d => ({
        day: d.day, views: d.views, visitors: d.visitors.size, ai: d.ai, search: d.search, bots: d.bots,
        enquiries: enqByDay[d.day] || 0,
      })),
      sources: top(sources, 10),
      ai: top(aiSites, 10),
      search: top(searchSites, 10),
      social: top(socialSites, 10),
      referrals: top(referrals, 10),
      campaigns: top(campaigns, 10),
      pages: top(pages, 15),
      aiPages: top(aiPages, 10),
      devices: top(devices, 3),
      bots: Object.values(bots).sort((a, b) => b.hits - a.hits).slice(0, 25)
        .map(b => ({ name: b.name, group: b.group, hits: b.hits, pages: b.pages.size, last: b.last })),
      enquiriesBy: top(enqBy, 10),
    };
  }

  return { record, summary, sourceOf, botOf };
}

module.exports = { open, sourceOf, botOf, deviceOf };
