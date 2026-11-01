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
const ch=await p.evaluate(async()=>{const x=await fetch('/api/auth/change',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({password:'NewPass12345!'})});return x.status+' '+(await x.text()).slice(0,100)});console.log('change',ch);
await p.goto(BASE+'/dashboard.html');await p.waitForTimeout(2500);
if(/login/.test(p.url())){console.log('on login (must change password) ->',p.url());}
const head=await p.$$eval('main h2',h=>h.map(x=>x.textContent.trim()).slice(0,3));console.log('first headings',head);
const rows=await p.$$eval('#slWrap tbody tr',r=>r.length).catch(()=>0);check('the dashboard opens on Your universities', head[0]==='Your universities', head.join('|'));check('with the universities listed', rows>0, rows);check('and the first-assessment note with ask buttons', !!(await p.$('#slAsk')));console.log('rows',await p.$$eval('#slWrap tbody tr',r=>r.length).catch(()=>0),'askBox',!!(await p.$('#slAsk')));
const st=await p.evaluate(async()=>{const s=await (await fetch('/api/state')).json();return {prof:Object.keys(s.profile||{}).filter(k=>/^(d_|e_|a_|w_|g_)/.test(k)).join(','),short:(s.shortlist||[]).length}});console.log('state',JSON.stringify(st));
if(await p.$('#slBetter')){await p.click('#slBetter');await p.waitForTimeout(800);const bm=await p.textContent('#slAskMsg');check('asking for better options reaches the counsellor', /Sent to your counsellor/.test(bm), bm);
 await p.click('#slReplGo');await p.waitForTimeout(300);console.log('replace empty ->',await p.textContent('#slAskMsg'));
 const o=await p.$$eval('#slRepl option',o=>o.map(x=>x.textContent));await p.selectOption('#slRepl',{index:1});await p.click('#slReplGo');await p.waitForTimeout(800);console.log('replace ->',await p.textContent('#slAskMsg'),'| opt',o[1]);
 const msgs=await p.evaluate(async()=>{const s=await (await fetch('/api/state')).json();return (s.messages||[]).filter(m=>m.who==='me').map(m=>m.t||m.body).slice(-2)});console.log('sent',JSON.stringify(msgs).slice(0,300));
 }
check('no page errors', errs.length===0, errs.join('; '));console.log(bad?bad+' failed':'payflowtest: all passed');await b.close();process.exit(bad?1:0);})();
