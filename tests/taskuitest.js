const { chromium } = require('playwright');
/* Honour BASE like every other suite. Hardcoded, this drove whichever server
   happened to hold 8099 — including, during a full run, the one another suite
   was in the middle of — so its result said nothing about the build under
   test and it failed at random. */
const BASE = process.env.BASE || 'http://localhost:8099';
const ok=(t,c,e)=>console.log((c?'  ✓ ':'  ✗ ')+t+(c?'':' — '+(e??'')));
const day=n=>new Date(Date.now()+n*864e5).toISOString().slice(0,10);
(async()=>{
  const b=await chromium.launch(); const errs=[];
  const stamp=Date.now().toString(36);
  const a=await b.newContext({viewport:{width:1440,height:950}});
  await a.request.post(BASE+'/api/auth/login',{data:{email:'admin@glovels.com',password:'glovels123'}});
  const cE='uc'+stamp+'@glovels.com', cP='uc-'+stamp;
  let r=await a.request.post(BASE+'/api/staff/people',{data:{name:'UI Counsellor',email:cE,password:cP,role:'counsellor'}});
  const cId=(await r.json()).person.id;
  const sE='us'+stamp+'@ex.example', sP='us-'+stamp;
  r=await a.request.post(BASE+'/api/staff/people',{data:{name:'UI Student',email:sE,password:sP,role:'student'}});
  const sId=(await r.json()).person.id;
  await a.request.put(BASE+'/api/staff/student/'+sId+'/counsellor',{data:{counsellorId:cId}});
  await a.request.post(BASE+'/api/staff/student/'+sId+'/tasks',{data:{title:'Collect the marksheets',due:day(5)}});

  // --- counsellor
  const c=await b.newContext({viewport:{width:1440,height:950}});
  await c.request.post(BASE+'/api/auth/login',{data:{email:cE,password:cP}});
  await c.request.post(BASE+'/api/auth/change',{data:{password:cP+'X'}});
  await c.request.post(BASE+'/api/auth/login',{data:{email:cE,password:cP+'X'}});
  const cp=await c.newPage(); cp.on('pageerror',e=>errs.push('counsellor: '+e));
  await cp.goto(BASE+'/counsellor?student='+sId,{waitUntil:'domcontentloaded'}); await cp.waitForTimeout(3000);
  ok('the counsellor has a Tasks tab on the file', !!(await cp.$('.tab[data-t="tasks"]')));
  await cp.click('.tab[data-t="tasks"]'); await cp.waitForTimeout(500);
  const rows=await cp.$$eval('#t-tasks tbody tr',r=>r.length);
  ok('  · listing the work with dates', rows>0, rows);
  const heads=await cp.$$eval('#t-tasks thead th',h=>h.map(x=>x.textContent.trim()));
  ok('  · What / By when / State', heads.slice(0,3).join('|')==='What|By when|State', heads.join('|'));
  ok('  · with a way to mark one done', !!(await cp.$('[data-task-done]')));
  const firstTitle=await cp.$eval('#t-tasks tbody tr td',e=>e.textContent.trim());
  await cp.click('[data-task-done]'); await cp.waitForTimeout(1800);
  const finished=await cp.$$eval('#t-tasks tbody tr',rs=>rs.filter(r=>/Finished/.test(r.textContent)).length);
  ok('  · and marking it done sticks', finished>0, finished);

  // --- admin sees it
  const ap=await a.newPage(); ap.on('pageerror',e=>errs.push('admin: '+e));
  await ap.goto(BASE+'/admin#tasks',{waitUntil:'domcontentloaded'}); await ap.waitForTimeout(3000);
  await ap.selectOption('#tkState','all'); await ap.waitForTimeout(1000);
  const txt=await ap.$eval('#tkRows',e=>e.textContent);
  ok('the office board shows that student', /UI Student/.test(txt), txt.slice(0,120));
  ok('  · and names the counsellor who owes it', /UI Counsellor/.test(txt));
  const ppl=await ap.$eval('#tkPeople',e=>e.textContent);
  ok('  · with an on-time figure once something is finished', /100%|\d+%/.test(ppl), ppl.slice(0,160));

  // --- student
  const st=await b.newContext({viewport:{width:1440,height:950}});
  await st.request.post(BASE+'/api/auth/login',{data:{email:sE,password:sP}});
  await st.request.post(BASE+'/api/auth/change',{data:{password:sP+'X'}});
  await st.request.post(BASE+'/api/auth/login',{data:{email:sE,password:sP+'X'}});
  const sp=await st.newPage(); sp.on('pageerror',e=>errs.push('dash: '+e));
  await sp.goto(BASE+'/dashboard',{waitUntil:'domcontentloaded'}); await sp.waitForTimeout(2500);
  ok('the student sees where their application has got to', await sp.$eval('#progSec',e=>!e.hidden));
  const steps=await sp.$$eval('#progList li',l=>l.length);
  ok('  · as a list of steps', steps>0, steps);
  const ptxt=await sp.$eval('#progSec',e=>e.textContent);
  ok('  · with target dates', /aiming for \d{4}-\d{2}/.test(ptxt)||/Done/.test(ptxt), ptxt.slice(0,200));
  ok('  · and nothing about the counsellor or being late',
    !/UI Counsellor|overdue|past its date|late/i.test(ptxt), ptxt.slice(0,200));
  const w=await sp.$eval('#progFill',e=>e.style.width);
  ok('  · and a bar that reflects it', /%$/.test(w), w);
  await sp.setViewportSize({width:390,height:900}); await sp.waitForTimeout(600);
  ok('  · no sideways scroll on a phone', await sp.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
