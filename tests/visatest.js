const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:8099';
const ok=[],bad=[];
const check=(n,p,note)=>(p?ok:bad).push(n+(note?' — '+note:''));
const stamp=Date.now();
const F='/tmp/visa-funds-'+stamp+'.pdf';
(async()=>{
 fs.writeFileSync(F, Buffer.from('%PDF-1.4 blocked account confirmation'));
 const b=await chromium.launch();
 const stu=await b.newContext({viewport:{width:1440,height:1050}});
 await stu.request.post(BASE+'/api/auth/login',{data:{email:'student@glovels.com',password:'glovels123'}});
 const me=await(await stu.request.get(BASE+'/api/state')).json();
 const p=await stu.newPage();
 const errs=[];p.on('pageerror',e=>errs.push(String(e)));
 await p.goto(BASE+'/visa',{waitUntil:'domcontentloaded'});
 await p.waitForTimeout(2800);
 check('the screen no longer admits to being a demo',!(await p.content()).includes('Demo screen'));
 /* Counted from the page's own list rather than hardcoded. The visa checklist
    grows — the cover letter we write was added to it — and a suite that pins
    the number fails on every addition while proving nothing about whether the
    cards match the list. */
 /* VISA_DOCS is not a global on this page — it lives inside the page's own
    closure — so the number is counted from the slot definitions inlined in the
    source instead. */
 const wantVisa = ((await p.content()).match(/\{id:'visa-[a-z]+'/g) || []).length;
 check('there is a card per visa document',
   wantVisa > 0 && (await p.$$('#visaGrid .sl')).length === wantVisa,
   (await p.$$('#visaGrid .sl')).length + ' cards for ' + wantVisa + ' documents');
 const [ch]=await Promise.all([p.waitForEvent('filechooser'),p.click('[data-vdrop="visa-funds"]')]);
 await ch.setFiles(F);
 await p.waitForTimeout(2600);
 check('uploading one shows the file on the card',
   (await p.textContent('[data-vid="visa-funds"]')).includes('visa-funds-'+stamp));
 check('and it says it is with the counsellor',
   /In review/i.test(await p.textContent('[data-vid="visa-funds"]')));
 const st=await(await stu.request.get(BASE+'/api/state')).json();
 check('the file is on their record',!!st.docs['visa-funds'],Object.keys(st.docs).join(','));
 check('waiting to be checked',(st.docs['visa-funds']||{}).status==='wait');
 /* and NOT duplicated into the Documents screen's shared-files list */
 await p.goto(BASE+'/documents',{waitUntil:'domcontentloaded'});
 await p.waitForTimeout(2600);
 const shared=await p.textContent('#sharedList').catch(()=>'');
 check('it does not also appear under files shared in the conversation',
   !shared.includes('visa-funds-'+stamp), shared.slice(0,60));
 check('no page errors for the student',errs.length===0,errs.slice(0,2).join(' | '));
 /* the counsellor checks it */
 const staff=await b.newContext({viewport:{width:1600,height:1050}});
 await staff.request.post(BASE+'/api/auth/login',{data:{email:'admin@glovels.com',password:'glovels123'}});
 const ops=await staff.newPage();
 const oerr=[];ops.on('pageerror',e=>oerr.push(String(e)));
 await ops.goto(BASE+'/counsellor?student='+me.user.id,{waitUntil:'domcontentloaded'});
 await ops.waitForTimeout(3000);
 await ops.click('.tab[data-t="file"]');
 await ops.waitForTimeout(900);
 check('the counsellor sees the visa file on their record',
   (await ops.textContent('#docs')).includes('visa-funds-'+stamp),
   (await ops.textContent('#docs')||'').replace(/\s+/g,' ').slice(0,90));
 const v=ops.locator('#docs li',{hasText:'visa-funds-'+stamp}).locator('[data-verify]');
 check('with a way to verify it',await v.count()>=1);
 await v.first().click();
 await ops.waitForTimeout(2200);
 const after=await(await stu.request.get(BASE+'/api/state')).json();
 check('verifying it marks it verified on the student’s record',
   (after.docs['visa-funds']||{}).status==='ok',(after.docs['visa-funds']||{}).status);
 await p.goto(BASE+'/visa',{waitUntil:'domcontentloaded'});
 await p.waitForTimeout(2800);
 check('and the student’s progress moves',
   (await p.textContent('#vRingTxt'))!=='0%',await p.textContent('#vRingTxt'));
 check('no page errors for the counsellor',oerr.length===0,oerr.slice(0,2).join(' | '));
 await b.close();
 try{fs.unlinkSync(F)}catch(e){}
 console.log('\nPASS');ok.forEach(x=>console.log('  ✓ '+x));
 if(bad.length){console.log('\nFAIL');bad.forEach(x=>console.log('  ✗ '+x));}
 console.log(`\n${ok.length} passed, ${bad.length} failed`);
 process.exit(bad.length?1:0);
})().catch(e=>{console.error(e);process.exit(2)});
