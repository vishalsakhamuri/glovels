const { chromium } = require('playwright');
/* See the note in taskuitest.js: BASE comes from the environment, so the
   suite tests the server it was pointed at. */
const BASE = process.env.BASE || 'http://localhost:8099';
const ok=(t,c,e)=>console.log((c?'  ✓ ':'  ✗ ')+t+(c?'':' — '+(e??'')));
const day=n=>new Date(Date.now()+n*864e5).toISOString().slice(0,10);
(async()=>{
  const b=await chromium.launch(); const errs=[]; const st=Date.now().toString(36);
  const a=await b.newContext({viewport:{width:1440,height:950}});
  await a.request.post(BASE+'/api/auth/login',{data:{email:'admin@glovels.com',password:'glovels123'}});
  let r=await a.request.post(BASE+'/api/staff/people',{data:{name:'Ph Counsellor',email:'phc'+st+'@glovels.com',password:'phc-'+st,role:'counsellor'}});
  const cId=(await r.json()).person.id;
  r=await a.request.post(BASE+'/api/staff/people',{data:{name:'Ph Student',email:'phs'+st+'@ex.example',password:'phs-'+st,role:'student'}});
  const sId=(await r.json()).person.id;
  await a.request.put(BASE+'/api/staff/student/'+sId+'/counsellor',{data:{counsellorId:cId}});
  const s=await b.newContext();
  await s.request.post(BASE+'/api/auth/login',{data:{email:'phs'+st+'@ex.example',password:'phs-'+st}});
  await s.request.post(BASE+'/api/auth/change',{data:{password:'phs-'+st+'X'}});
  await s.request.post(BASE+'/api/auth/login',{data:{email:'phs'+st+'@ex.example',password:'phs-'+st+'X'}});
  await s.request.post(BASE+'/api/orders',{data:{packageId:'pkg-boarding',name:'Ph Student',email:'phs'+st+'@ex.example',phone:'9876543210',acceptedTerms:true}});
  const cat=await (await a.request.get(BASE+'/api/staff/catalogue?per=40')).json();
  for(const p of (cat.programmes||[]).slice(0,4)) await a.request.post(BASE+'/api/staff/student/'+sId+'/shortlist',{data:{id:p.id}});

  // --- office funnel
  const ap=await a.newPage(); ap.on('pageerror',e=>errs.push('admin: '+e));
  await ap.goto(BASE+'/admin#tasks',{waitUntil:'domcontentloaded'}); await ap.waitForTimeout(3200);
  const tiles=await ap.$$eval('#fnStrip button',bs=>bs.map(x=>({k:x.dataset.fn,n:x.querySelector('b').textContent,l:x.querySelector('span').textContent})));
  ok('the office sees a tile for every phase', tiles.length===9, tiles.length);
  /* Nine: 'Services in progress' sits between Visa and Departed, for work
     that is not on the university journey — a loan, a language course. */
  ok('  · named in order', tiles.map(t=>t.l).join(' → ')==='Enrolled → Profile and documents → Shortlisting → Writing (SOP/LOR) → Applying → Waiting on offers → Visa → Services and extra work → Departed', tiles.map(t=>t.l).join(' → '));
  ok('  · with a count on each', tiles.some(t=>Number(t.n)>0), JSON.stringify(tiles.map(t=>t.l+'='+t.n)));
  // click a phase that has somebody in it
  const busy=tiles.find(t=>Number(t.n)>0);
  await ap.click('[data-fn="'+busy.k+'"]'); await ap.waitForTimeout(1200);
  ok('clicking a phase filters the work to those files', await ap.$eval('[data-fn="'+busy.k+'"]',e=>e.getAttribute('aria-pressed'))==='true');
  ok('  · and says so, with a way back', await ap.$eval('#fnChip',e=>!e.hidden && /show everybody/.test(e.textContent)), await ap.$eval('#fnChip',e=>e.textContent));
  await ap.click('#fnChip'); await ap.waitForTimeout(1000);
  ok('  · which clears it', await ap.$eval('[data-fn="'+busy.k+'"]',e=>e.getAttribute('aria-pressed'))==='false');

  // --- counsellor file header
  const c=await b.newContext({viewport:{width:1440,height:950}});
  await c.request.post(BASE+'/api/auth/login',{data:{email:'phc'+st+'@glovels.com',password:'phc-'+st}});
  await c.request.post(BASE+'/api/auth/change',{data:{password:'phc-'+st+'X'}});
  await c.request.post(BASE+'/api/auth/login',{data:{email:'phc'+st+'@glovels.com',password:'phc-'+st+'X'}});
  const cp=await c.newPage(); cp.on('pageerror',e=>errs.push('counsellor: '+e));
  await cp.goto(BASE+'/counsellor?student='+sId,{waitUntil:'domcontentloaded'}); await cp.waitForTimeout(3000);
  ok('the counsellor sees the phase on the file', !!(await cp.$('.phase')));
  const ptxt=await cp.$eval('.phase',e=>e.textContent.replace(/\s+/g,' ').trim());
  ok('  · naming it and how long they have been there', /Enrolled|Profile|Shortlisting/.test(ptxt), ptxt);
  // push them into Applying so the "n of m" shows
  const rec=await (await c.request.get(BASE+'/api/staff/student/'+sId)).json();
  for(const t of rec.tasks.filter(x=>/Welcome|Profile completed|Shortlist confirmed|Statement of Purpose|Letters of Rec/.test(x.title)))
    await c.request.put(BASE+'/api/staff/task/'+t.id,{data:{status:'done'}});
  await cp.reload({waitUntil:'domcontentloaded'}); await cp.waitForTimeout(2500);
  await cp.click('[data-open="'+sId+'"]').catch(()=>{}); await cp.waitForTimeout(2000);
  const ptxt2=await cp.$eval('.phase',e=>e.textContent.replace(/\s+/g,' ').trim()).catch(()=>'no phase');
  ok('  · and counts the universities inside Applying', /Applying/.test(ptxt2) && /of \d+ done/.test(ptxt2), ptxt2);

  // --- student
  const sp=await s.newPage(); sp.on('pageerror',e=>errs.push('dash: '+e));
  await sp.goto(BASE+'/dashboard',{waitUntil:'domcontentloaded'}); await sp.waitForTimeout(2500);
  ok('the student is told where they are', await sp.$eval('#progPhase',e=>!e.hidden));
  const stxt=await sp.$eval('#progPhase',e=>e.textContent.replace(/\s+/g,' ').trim());
  ok('  · as a phase and a step number', /Applying/.test(stxt) && /Step \d+ of 9/.test(stxt), stxt);
  ok('  · with nothing about lateness or counsellors', !/late|behind|overdue|Ph Counsellor/i.test(stxt), stxt);
  await sp.setViewportSize({width:390,height:900}); await sp.waitForTimeout(500);
  ok('  · no sideways scroll on a phone', await sp.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
  await ap.setViewportSize({width:390,height:900}); await ap.waitForTimeout(600);
  ok('the funnel folds on a phone', await ap.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),
     await ap.evaluate(()=>document.documentElement.scrollWidth+' vs '+window.innerWidth));
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
