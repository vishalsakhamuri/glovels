/*
 * Patch 146 — the match is what a package buys.
 *
 * "There are free to search any unis in the search bar; exact uni based on the
 *  student profile is not possible without package."
 *
 * So: search and university pages stay open. What must not leak is the link
 * between a LOCKED row in the finder (a public programme matched to the
 * visitor's profile) and its name. It leaked three ways — the portal pages'
 * baked catalogue, /catalogue.json, and the real id on each locked row (the
 * same id a university page prints on its Apply button).
 */
const BASE = process.env.BASE || 'http://localhost:8099';
let pass = 0, fail = 0;
const ok = (t, c, e) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + t + (c ? '' : ' — ' + (e ?? ''))); };
const get = async p => { const r = await fetch(BASE + p); return { status: r.status, text: await r.text() }; };

(async () => {
  /* The portal pages' baked list may name public programmes — browsing by name
     is free — but none of its ids may be a locked row's. */
  const portal = (await get('/universities')).text;
  const baked = new Set([...portal.matchAll(/"id":\s*"([^"]+)"/g)].map(m => m[1]));
  const home = await get('/');
  ok('the home page carries no baked public programme', !/"isPublic":\s*true/.test(home.text));
  ok('/catalogue.json is not served to a visitor', (await get('/catalogue.json')).status === 404);

  const cat = JSON.parse((await get('/api/catalogue')).text);
  const locked = (cat.programmes || []).filter(p => p.isPublic && !p.university);
  ok('locked rows are still there to filter and count', locked.length > 0, locked.length);
  ok('  · each with a stand-in id and university key, not the real ones',
    locked.every(p => /^xp[0-9a-f]{14}$/.test(p.id) && /^xu[0-9a-f]{14}$/.test(p.uKey)), JSON.stringify(locked[0] || {}).slice(0, 120));

  const f = JSON.parse((await get('/api/universities/filter?country=DE')).text);
  const pu = (f.universities || []).find(u => u.isPublic);
  ok('public universities are still free to find', !!pu);
  if (pu) {
    const page = await get(pu.url);
    const ids = [...page.text.matchAll(/data-apply="([^"]+)"/g)].map(m => m[1]);
    ok('  · and their pages still list their programmes', ids.length > 0);
    const lockedIds = new Set(locked.map(p => p.id));
    ok('  · but no id on a university page matches a locked finder row', !ids.some(id => lockedIds.has(id)));
    ok('  · nor any id baked into the portal pages', ![...baked].some(id => lockedIds.has(id)));
  }
  const s = JSON.parse((await get('/api/universities/search?q=' + encodeURIComponent((pu && pu.name || 'uni').split(' ')[0]))).text);
  ok('the search bar still finds universities by name', (s.universities || []).length > 0);

  console.log('round146test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('crashed: ' + (e && e.stack || e)); process.exit(1); });
