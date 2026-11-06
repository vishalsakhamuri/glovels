'use strict';
/*
 * Patch 275: the crawlers at the door.
 *
 * 6 Nov 2026: ClaudeBot fetched 223,000 files in two days, SEO tools and
 * unnamed scrapers another 44,000, OpenAI's search bot 22,000 — 70% of the
 * month's 25 GB of bandwidth gone in six days, and the University Finder
 * (the heaviest page) crawled through every combination of its filters.
 * Owner: "do not allow unnecessary data cache" — nobody should be copying
 * the site's data for their own store.
 *
 * Three kinds of crawler:
 *
 *   turned away  Crawlers that copy the web to train a model or sell SEO
 *                data, and unnamed scrapers (python-requests, curl, wget…).
 *                Headless browsers are not blocked: our own tests and
 *                previews use them. Everything but /robots.txt answers 403 with a
 *                few bytes. robots.txt tells the honest ones the same.
 *   welcome      The search engines (Google, Bing, DuckDuckGo, Apple, Yandex)
 *                and the assistants that read a page because a person asked
 *                (ChatGPT search and its user fetches, Claude's search and
 *                user fetches, Perplexity, DuckAssist) — they bring students.
 *                Each may fetch at most BOT_PER_MIN pages a minute (default
 *                60); above that 429 with Retry-After, which they honour by
 *                slowing down. None of them may page through the finder's
 *                filters (/find-university?…): every combination is a new
 *                address and none of it is worth indexing.
 *   everyone     Link previews (WhatsApp, Facebook…), uptime checks, people.
 *
 * On when the site is the live address (indexing allowed and GLOVELS_URL is
 * glovels.com), or with BOTGATE=on; BOTGATE=off turns it off.
 */

const BLOCK = new Set([
  'ClaudeBot (Anthropic)', 'anthropic-ai', 'GPTBot (OpenAI training)', 'Google-Extended (Gemini training)', 'GoogleOther',
  'Applebot-Extended (Apple Intelligence)', 'Amazonbot (Alexa)', 'Meta AI', 'Bytespider (ByteDance)', 'CCBot (Common Crawl)',
  'Cohere', 'Diffbot', 'YouBot (You.com)', 'SEO tools', 'Other crawlers',
]);
/* The robots.txt names of the same crawlers (and a few that do not announce
   themselves in a way botOf knows, but read robots.txt). */
const BLOCK_AGENTS = ['ClaudeBot', 'anthropic-ai', 'GPTBot', 'Google-Extended', 'GoogleOther', 'GoogleOther-Image', 'GoogleOther-Video',
  'Applebot-Extended', 'Amazonbot', 'meta-externalagent', 'meta-externalfetcher', 'FacebookBot', 'Bytespider', 'CCBot', 'cohere-ai',
  'cohere-training-data-crawler', 'Diffbot', 'YouBot', 'AI2Bot', 'Ai2Bot-Dolma', 'omgili', 'omgilibot', 'ImagesiftBot', 'Timpibot',
  'img2dataset', 'PanguBot', 'Kangaroo Bot', 'Scrapy', 'AhrefsBot', 'SemrushBot', 'MJ12bot', 'DotBot', 'PetalBot', 'DataForSeoBot',
  'BLEXBot', 'serpstatbot', 'SeekportBot', 'Barkrowler', 'MegaIndex.ru'];

function open({ traffic, config = {}, env = process.env, log = console } = {}) {
  const want = String(env.BOTGATE || '').toLowerCase();
  const live = !!config.allowIndexing && /(^|\.)glovels\.com$/i.test((() => { try { return new URL(config.siteUrl || '').hostname; } catch (e) { return ''; } })());
  const on = want === 'on' || (want !== 'off' && live);
  const perMin = Math.max(5, Number(env.BOT_PER_MIN) || 60);
  const buckets = new Map();   /* bot name → { tokens, at } */
  let turnedAway = 0, slowed = 0;

  function allowRate(name) {
    const now = Date.now();
    let b = buckets.get(name);
    if (!b) { b = { tokens: perMin, at: now }; buckets.set(name, b); }
    b.tokens = Math.min(perMin, b.tokens + (now - b.at) * perMin / 60000);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /*
   * check(req, pathname, query) → null to go on, or { code, headers, body }.
   */
  function check(req, pathname, query) {
    if (!on) return null;
    /* robots.txt for everyone; the API (payment webhooks, the app) and the
       app-link files have their own guards. */
    if (pathname === '/robots.txt' || pathname.startsWith('/api/') || pathname.startsWith('/.well-known/')) return null;
    const ua = String(req.headers['user-agent'] || '');
    const bot = traffic && traffic.botOf ? traffic.botOf(ua) : null;
    if (!bot || bot.bot === 'No user agent') return null;
    if (BLOCK.has(bot.bot)) {
      turnedAway++;
      try { traffic.blocked && traffic.blocked(req, pathname, bot); } catch (e) {}
      return { code: 403, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
        body: 'Not for crawlers. See /robots.txt\n' };
    }
    if (bot.group === 'other') return null;   /* link previews, uptime checks */
    /* welcome crawlers: not through the finder's filters, and not too fast */
    if (/^\/(?:[a-z]{2}\/)?find-university/.test(pathname) && query) {
      try { traffic.blocked && traffic.blocked(req, pathname, bot); } catch (e) {}
      return { code: 403, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
        body: 'The finder\'s filtered lists are for people. See /robots.txt\n' };
    }
    if (!allowRate(bot.bot)) {
      slowed++;
      return { code: 429, headers: { 'Retry-After': '120', 'Cache-Control': 'no-store' }, body: 'Slow down, please.\n' };
    }
    return null;
  }

  if (on) log.log('  crawlers   training/SEO/scrapers turned away; search and answer bots ' + perMin + '/min');
  return { check, on, status: () => ({ on, perMin, turnedAway, slowed }) };
}

module.exports = { open, BLOCK, BLOCK_AGENTS };
