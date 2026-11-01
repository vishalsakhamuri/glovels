'use strict';
/*
 * Patch 212: THE NEWS DESK — every week, the study-abroad news, written up.
 *
 * "Claude will check the trending topics … and create weekly blogs so that
 *  trends are captured and SEO works better … like a news website. You can
 *  auto publish — give an option auto publish on or off in the admin panel."
 *  — Vishal, 1 Nov
 *
 * Once a week (Monday from 06:00, Europe/Rome) the site asks Claude — with
 * web search — for the three strongest study-abroad / work-abroad stories of
 * the last week or so: visa rules, fees, the blocked account, the Opportunity
 * Card, PR draws, intakes and deadlines, scholarships, what students are
 * talking about. Each comes back as a finished post with its sources. With
 * auto-publish ON they go live at once (and, if chosen, to Facebook,
 * Instagram and push); OFF, they wait as drafts in Blog for somebody to read.
 *
 *   ANTHROPIC_API_KEY   on Render → Environment. Without it the desk is off
 *                       and says so on the Blog screen.
 *   NEWSDESK_MODEL      optional; the model to write with.
 *
 * Settings (Blog → News desk): on/off, auto-publish on/off, posts a week,
 * and which channels a published post is shared to.
 */
const https = require('https');
const http = require('http');

const DEFAULTS = { on: true, auto: false, perWeek: 3, share: { facebook: false, instagram: false, push: false }, lastRun: '', lastWeek: '', last: null };
const settingsOf = raw => {
  const s = Object.assign({}, DEFAULTS, raw || {});
  s.share = Object.assign({}, DEFAULTS.share, (raw && raw.share) || {});
  s.perWeek = Math.max(1, Math.min(5, Number(s.perWeek) || 3));
  s.on = s.on !== false; s.auto = !!s.auto;
  return s;
};

function post(href, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(href);
    const lib = u.protocol === 'http:' ? http : https;
    const data = JSON.stringify(body);
    const req = lib.request(u, { method: 'POST', timeout: 240000, headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, headers) }, res => {
      let out = ''; res.on('data', c => { out += c; }); res.on('end', () => {
        let j = {}; try { j = JSON.parse(out); } catch (e) { j = { raw: out.slice(0, 300) }; }
        resolve({ status: res.statusCode, data: j });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.write(data); req.end();
  });
}

/* The ISO week, e.g. 2026-W45, in Rome. */
function weekOf(ms) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  const d = new Date(p + 'T12:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const w = 1 + Math.round(((d - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return d.getUTCFullYear() + '-W' + String(w).padStart(2, '0');
}
function romeNow(ms) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', weekday: 'short', hour: '2-digit', hourCycle: 'h23' });
  const o = {}; f.formatToParts(new Date(ms)).forEach(x => { o[x.type] = x.value; });
  return { weekday: o.weekday, hour: Number(o.hour) };
}

const PROMPT = (n, recent, today) => `You write the weekly news for Glovels (glovels.com), a study-abroad and work-abroad consultancy. Readers are students and job seekers mainly from India, Nepal, Sri Lanka, Bangladesh, Nigeria, Ghana, Kenya, the Philippines and non-EU Europe (Albania, Serbia, the Western Balkans), going mainly to Germany, and also Canada, the UK, Ireland, France, Poland, Spain, Italy, the USA and Australia; work routes include the Germany Opportunity Card, nursing, pharma and medical PG in Germany, and Canada and Australia PR.

Today is ${today}. Use web search to find what changed or is trending in the last 7–10 days: official changes (visa rules and fees, the German blocked-account amount, the Opportunity Card, work permits, PR draws, post-study work, caps) from primary sources (make-it-in-germany.com, auswaertiges-amt.de, daad.de, canada.ca, gov.uk, immi.homeaffairs.gov.au, travel.state.gov, EU and national ministries); intakes and application deadlines in the next 6–8 weeks; new scholarships; and what students are discussing.

Do not repeat these recent posts: ${recent.length ? recent.map(t => '"' + t + '"').join('; ') : 'none yet'}.

Pick the ${n} strongest stories (at least one hard-news change with an official source). For each write a complete post in plain, warm, expert English, 600–900 words. Every fact, figure and date must come from a page you actually opened in this search; leave out anything you are not sure of. Write in your own words — never copy sentences; at most one short quote (under 15 words) per source. No invented statistics, quotes or student stories. Never claim Glovels is "the first" or "the best".

The body uses only these conventions: "## Heading", "### Smaller heading", "- item", "1. item", "**bold**", "[words](https://url)", and tables as "| a | b |" with "|---|---|" under the header. Structure: what changed or what is new; who it affects; what to do now (numbered steps); key dates (a small table); a short FAQ (three ### questions); and a last line inviting readers to schedule a call with a Glovels counsellor or use the university finder. End the body with "## Sources" and a "- [title](url)" line for each source.

Answer with ONLY a JSON array, no other text, of ${n} objects:
[{"title": "under 65 characters, searched words first", "metaTitle": "under 60 characters", "metaDesc": "under 155 characters", "keywords": "5–8 comma-separated keywords", "tag": "one of News, Visa, Germany, Canada, UK, Scholarships, Work abroad, Deadlines", "excerpt": "two sentences", "body": "the post", "sources": ["https://…"]}]`;

function parsePosts(text) {
  const s = String(text || '');
  const a = s.indexOf('['), b = s.lastIndexOf(']');
  if (a < 0 || b <= a) throw new Error('no JSON array in the answer');
  const arr = JSON.parse(s.slice(a, b + 1));
  if (!Array.isArray(arr)) throw new Error('the answer is not a list');
  return arr.filter(p => p && p.title && p.body && Array.isArray(p.sources) && p.sources.some(u => /^https?:\/\//.test(u)))
    .map(p => ({
      title: String(p.title).trim().slice(0, 120), metaTitle: String(p.metaTitle || '').slice(0, 200),
      metaDesc: String(p.metaDesc || '').slice(0, 320), keywords: String(p.keywords || '').slice(0, 300),
      tag: String(p.tag || 'News').slice(0, 60), excerpt: String(p.excerpt || '').slice(0, 500),
      body: /##\s*Sources/i.test(String(p.body)) ? String(p.body) : String(p.body) + '\n\n## Sources\n' + p.sources.map(u => '- [' + u.replace(/^https?:\/\//, '').slice(0, 60) + '](' + u + ')').join('\n'),
      sources: p.sources.filter(u => /^https?:\/\//.test(u)).slice(0, 12),
    }));
}

function open({ db, social, push, siteUrl, log = console, savePost }) {
  const settings = () => settingsOf(db.content('newsdesk'));
  const save = (patch, who) => db.setContent('newsdesk', Object.assign(settings(), patch), who || 'news desk');
  const key = () => String(process.env.ANTHROPIC_API_KEY || '').trim();
  let running = false;

  async function run(reason) {
    if (running) return { ok: false, error: 'The news desk is already writing.' };
    if (!key()) return { ok: false, error: 'Add ANTHROPIC_API_KEY on Render to switch the news desk on.' };
    running = true;
    const S = settings();
    const started = new Date().toISOString();
    try {
      const recent = (db.allPosts ? db.allPosts() : []).slice(0, 30).map(p => p.title);
      const today = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
      const r = await post((process.env.ANTHROPIC_API_BASE || 'https://api.anthropic.com') + '/v1/messages',
        { 'x-api-key': key(), 'anthropic-version': '2023-06-01' },
        { model: process.env.NEWSDESK_MODEL || 'claude-sonnet-5-5', max_tokens: 16000,
          tools: [{ type: process.env.NEWSDESK_SEARCH_TOOL || 'web_search_20250305', name: 'web_search', max_uses: 20 }],
          messages: [{ role: 'user', content: PROMPT(S.perWeek, recent, today) }] });
      if (r.status !== 200) throw new Error(((r.data || {}).error || {}).message || ('the writing service said ' + r.status));
      const text = (r.data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
      const posts = parsePosts(text).slice(0, S.perWeek);
      if (!posts.length) throw new Error('no usable post came back (each needs a title, a body and sources)');
      const made = [];
      for (const p of posts) {
        const row = savePost(p, S.auto ? 'published' : 'draft');
        const item = { id: row.id, slug: row.slug, title: row.title, status: row.status };
        if (S.auto && (S.share.facebook || S.share.instagram || S.share.push)) {
          try { item.shared = await social.share({ db, push, siteUrl, post: row, want: S.share }); } catch (e) { item.shared = { error: String(e.message || e) }; }
        }
        made.push(item);
      }
      const last = { at: started, reason, ok: true, posts: made, auto: S.auto };
      save({ lastRun: started, lastWeek: weekOf(Date.now()), last });
      db.log('news desk', S.auto ? 'published the weekly news' : 'drafted the weekly news', made.map(x => x.title).join(' | '));
      return last;
    } catch (e) {
      const last = { at: started, reason, ok: false, error: String(e.message || e) };
      save({ lastRun: started, lastWeek: weekOf(Date.now()), last });
      log.error('  news desk ✗ ' + last.error);
      return last;
    } finally { running = false; }
  }

  /* Every half hour: Monday from 06:00 in Rome, once a week. */
  function tick() {
    const S = settings();
    if (!S.on || !key()) return;
    const n = romeNow(Date.now());
    if (n.weekday !== 'Mon' || n.hour < 6) return;
    if (S.lastWeek === weekOf(Date.now())) return;
    run('weekly').catch(() => {});
  }
  let timer = null;
  function start() {
    if (timer) return;
    timer = setInterval(tick, 30 * 60000); if (timer.unref) timer.unref();
    const first = setTimeout(tick, 60000); if (first.unref) first.unref();
  }

  return { settings, save, run, start, status: () => Object.assign(settings(), { connected: !!key(), running }) };
}

module.exports = { open, settingsOf, parsePosts, weekOf };
