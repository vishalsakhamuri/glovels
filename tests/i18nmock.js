'use strict';
/*
 * A stand-in for the Anthropic API, for the language tests: answers every
 * translation request at once, deterministically, so a suite can prove the
 * whole path — page served → units queued → translated → checked → page
 * served translated — without a key or a network.
 *
 *   node tests/i18nmock.js 8871        (or require it and call start(port))
 *
 * The "translation" of a string is the string with every word of letters
 * turned into [LANG:word]; placeholders, numbers and entities are kept.
 * The reviewer answers "ok" for every line, except that a source containing
 * the word "reviewfix" gets a corrected line, and a source containing
 * "breakme" loses its placeholders (so the server must flag it). A post
 * comes back with each paragraph marked the same way and every link kept.
 */
const http = require('http');

function mark(lang, s) {
  return String(s).replace(/(<\/?\d+\/?>|\{\d+\}|&[a-z#0-9]+;|\[[^\]]*\]\([^)]*\))|([\p{L}][\p{L}'’-]*)/gu, (m, keep, word) => keep ? keep : '[' + lang.toUpperCase() + ':' + word + ']');
}
function langOf(system) {
  const m = /into ([A-Z][a-z]+)/.exec(String(system || ''));
  const names = { Chinese: 'zh', Arabic: 'ar', Spanish: 'es', Russian: 'ru', French: 'fr', Portuguese: 'pt', Bengali: 'bn', Turkish: 'tr' };
  return (m && names[m[1]]) || 'xx';
}

function start(port) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = JSON.parse(body); } catch (e) { j = {}; }
      const system = String(j.system || '');
      const user = String(((j.messages || [])[0] || {}).content || '');
      const lang = langOf(system);
      calls.push({ system: system.slice(0, 60), lang, n: user.length });
      let text = '';
      const answer = out => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content: [{ type: 'text', text: out }], usage: { input_tokens: 10, output_tokens: 10 } }));
      };
      try {
        if (/^You translate blog posts/.test(system)) {
          const en = JSON.parse(user);
          const t = {};
          Object.keys(en).forEach(k => { t[k] = k === 'body' ? en[k].split('\n').map(line => /^(#+ |\||- |\d+\. )/.test(line) ? line.replace(/^(#+ |\||- |\d+\. )(.*)$/, (m, p, r) => p + mark(lang, r)) : mark(lang, line)).join('\n') : mark(lang, en[k]); });
          return answer(JSON.stringify(t));
        }
        if (/^You review a blog post/.test(system)) return answer(JSON.stringify({ ok: true }));
        if (/^You review translations/.test(system)) {
          const pairs = JSON.parse(user);
          return answer(JSON.stringify(pairs.map(p => /reviewfix/.test(p.en) ? mark(lang, p.en) + ' (reviewed)' : 'ok')));
        }
        if (/^You translate the website/.test(system)) {
          const arr = JSON.parse(user);
          return answer(JSON.stringify(arr.map(s => /breakme/.test(s) ? 'broken' : mark(lang, s))));
        }
        return answer('[]');
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: String(e.message) } }));
      }
    });
  });
  server.listen(port);
  return { server, calls, close: () => server.close() };
}

if (require.main === module) {
  const port = Number(process.argv[2]) || 8871;
  start(port);
  console.log('i18n mock on ' + port);
}
module.exports = { start, mark };
