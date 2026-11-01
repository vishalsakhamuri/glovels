/* Patch 226: the core flow — finder answers, pay, universities shown at once,
   ask the counsellor. Run against a server with UNLOCK_UNPAID=on. */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
let bad = 0; const check = (n, ok, note) => { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok || note == null ? '' : ' — ' + note)); if (!ok) bad++; };
(async()=>{const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1280,height:900}});const p=await ctx.newPage();
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto(BASE+'/');await p.waitForTimeout(1200);
await p.selectOption('#fCountry','DE');await p.selectOption('#fLevel','master');
const fields=await p.$$eval('#fField option',o=>o.map(x=>x.value).filter(Boolean));
await p.selectOption('#fField', fields.find(f=>/Computer/.test(f))||fields[0]);
await p.fill('#fCgpa','8.2');await p.selectOption('#fEnglish','ielts:7.5');await p.selectOption('#fWork','12');
await p.click('#fMoreBtn');await p.selectOption('#fGre','none');
const ans=await p.evaluate(()=>window.glvFinderAnswers());console.log('answers',JSON.stringify(ans));
const mail='buyer'+Date.now()+'@example.com';
const r=await p.evaluate(async([a,m])=>{const x=await fetch('/api/orders',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({packageId:'pkg-roadmap',name:'Ravi Kumar',email:m,phone:'+919811112222',acceptedTerms:true,answers:a})});return x.status+' '+JSON.stringify((await x.json()).matched||{})},[ans,mail]);
console.log('order',r);check('paying delivers the universities straight away', /"delivered":[1-9]/.test(r) && /"needsProfile":false/.test(r), r);
/* Patch 227: no password screen first — the universities, with a banner. */
const wr=await p.evaluate(async()=>{const x=await fetch('/api/profile',{method:'PUT',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({profile:{g_field:'X'}})});return x.status});
check('before a password is chosen, the record cannot be changed', wr===403, wr);
await p.goto(BASE+'/dashboard.html');await p.waitForTimeout(2500);
check('paying lands on the dashboard, not a password form', !/login/.test(p.url()), p.url());
await p.waitForSelector('#pwBanner',{timeout:5000}).catch(()=>{});check('a banner asks for a password and says the login was emailed', /emailed your login details/.test(await p.textContent('#pwBanner').catch(()=>'')));
const head=await p.$$eval('main h2',h=>h.map(x=>x.textContent.trim()).slice(0,3));console.log('first headings',head);
const rows=await p.$$eval('#slWrap tbody tr',r=>r.length).catch(()=>0);check('the dashboard opens on Your universities', head[0]==='Your universities', head.join('|'));check('with the universities listed', rows>0, rows);check('and the counsellor-confirms note with a message button', !!(await p.$('#slAsk')) && /counsellor will confirm/i.test(await p.textContent('#slAsk')));console.log('rows',await p.$$eval('#slWrap tbody tr',r=>r.length).catch(()=>0),'askBox',!!(await p.$('#slAsk')));
const st=await p.evaluate(async()=>{const s=await (await fetch('/api/state')).json();return {prof:Object.keys(s.profile||{}).filter(k=>/^(d_|e_|a_|w_|g_)/.test(k)).join(','),short:(s.shortlist||[]).length}});console.log('state',JSON.stringify(st));
if(await p.$('#slBetter')){await p.click('#slBetter');await p.waitForURL(/messages/,{timeout:6000}).catch(()=>{});
 const draft=await p.inputValue('#box').catch(()=>'');check('Message my counsellor opens Messages with a starter line', /About my universities/.test(draft), draft);}
check('no page errors', errs.length===0, errs.join('; '));console.log(bad?bad+' failed':'payflowtest: all passed');await b.close();process.exit(bad?1:0);})();
