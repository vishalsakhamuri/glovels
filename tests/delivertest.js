/**
 * Finished work, handed back to the people waiting for it.
 *
 * Vishal: "lor and sop, visa check list of the counsellor has finalised. it
 * should be shared to the partner in the student documents. this place these
 * should be available." And: "visa cover letter can be in visa file."
 *
 * A counsellor could already send a file — but only into the CONVERSATION,
 * under a random `shared-…` key. The agency has no conversation, by design,
 * and the student's own Documents screen shows named slots. So a finished SOP
 * sent the only way there was to send it appeared on neither screen.
 *
 * Three slots are ours to fill rather than the student's: the SOP, the
 * recommendation letters, and the visa cover letter. They arrive VERIFIED,
 * which is the one place this deliberately differs from every other upload —
 * an upload waits because somebody here has to read it, and these were written
 * by somebody here.
 *
 * The refusals matter as much as the delivery: a slot we do not produce, a
 * counsellor who does not hold the case, and an agency that is not theirs.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8099'; const S=Date.now();
let pass=0,fail=0; const ok=(c,m)=>{c?pass++:(fail++,console.log('  FAIL: '+m));};
(async()=>{
 const b=await chromium.launch();
 const admin=await b.newContext();
 await admin.request.post(BASE+'/api/auth/login',{data:{email:'admin@glovels.com',password:'glovels123'}});

 // an agency with a student
 const pe='deliv'+S+'@agency.example', pw='deliv-'+S;
 await admin.request.post(BASE+'/api/staff/people',{data:{name:'Deliv Agency '+S,email:pe,password:pw,role:'partner'}});
 const P=await b.newContext();
 await P.request.post(BASE+'/api/auth/login',{data:{email:pe,password:pw}});
 await P.request.post(BASE+'/api/auth/change',{data:{current:pw,password:pw+'X'}});
 await P.request.post(BASE+'/api/auth/login',{data:{email:pe,password:pw+'X'}});
 const add=await (await P.request.post(BASE+'/api/partner/students',
   {data:{students:[{name:'Deliv Student',email:'ds'+S+'@ex.example'}]}})).json();
 const sid=add.added[0].id;
 ok(!!sid,'student created');

 // a counsellor, assigned
 const co=await (await admin.request.post(BASE+'/api/staff/people',
   {data:{name:'Deliv C'+S,email:'dc'+S+'@glovels.com',password:'dc-'+S,role:'counsellor'}})).json();
 const coId=co.person?co.person.id:co.id;
 await admin.request.put(BASE+'/api/staff/student/'+sid+'/counsellor',{data:{counsellorId:coId}});
 const C=await b.newContext();
 await C.request.post(BASE+'/api/auth/login',{data:{email:'dc'+S+'@glovels.com',password:'dc-'+S}});
 await C.request.post(BASE+'/api/auth/change',{data:{current:'dc-'+S,password:'dc-'+S+'X'}});
 await C.request.post(BASE+'/api/auth/login',{data:{email:'dc'+S+'@glovels.com',password:'dc-'+S+'X'}});

 // deliver an SOP
 const put=async(key,name)=>C.request.post(BASE+'/api/staff/student/'+sid+'/document/'+key+'/file',
   {multipart:{file:{name,mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 finished '+key)}}});
 const r1=await put('sop','Deliv-Student-SOP-final.pdf');
 ok(r1.ok(),'counsellor delivers an SOP — '+r1.status()+' '+(await r1.text()).slice(0,90));
 const r2=await put('visa-cover','Deliv-Student-visa-cover.pdf');
 ok(r2.ok(),'and a visa cover letter — '+r2.status());

 // a slot we do NOT produce is refused
 const r3=await put('passport','their-passport.pdf');
 ok(r3.status()===422,'a slot we do not produce is refused — '+r3.status());

 // the partner sees it
 const st=await (await P.request.get(BASE+'/api/partner/student/'+sid)).json();
 ok(st.docs && st.docs.sop, 'the SOP is on the partner’s copy of the file');
 ok(st.docs && st.docs.sop && st.docs.sop.status==='ok','and arrives verified — '+(st.docs.sop||{}).status);
 ok(st.docs && st.docs['visa-cover'],'the visa cover letter too');

 // and can download it
 const dl=await P.request.get(BASE+'/api/partner/student/'+sid+'/document/sop/file');
 ok(dl.ok(),'the partner can download it — '+dl.status());
 ok((await dl.body()).toString().includes('finished sop'),'and it is the right file');

 // another agency cannot
 const oe='other'+S+'@agency.example', ow='other-'+S;
 await admin.request.post(BASE+'/api/staff/people',{data:{name:'Other '+S,email:oe,password:ow,role:'partner'}});
 const O=await b.newContext();
 await O.request.post(BASE+'/api/auth/login',{data:{email:oe,password:ow}});
 await O.request.post(BASE+'/api/auth/change',{data:{current:ow,password:ow+'X'}});
 await O.request.post(BASE+'/api/auth/login',{data:{email:oe,password:ow+'X'}});
 const steal=await O.request.get(BASE+'/api/partner/student/'+sid+'/document/sop/file');
 ok(steal.status()===404,'another agency cannot download it — '+steal.status());

 // a counsellor who does not hold the case cannot deliver
 const co2=await (await admin.request.post(BASE+'/api/staff/people',
   {data:{name:'Nosy C'+S,email:'nc'+S+'@glovels.com',password:'nc-'+S,role:'counsellor'}})).json();
 const N=await b.newContext();
 await N.request.post(BASE+'/api/auth/login',{data:{email:'nc'+S+'@glovels.com',password:'nc-'+S}});
 await N.request.post(BASE+'/api/auth/change',{data:{current:'nc-'+S,password:'nc-'+S+'X'}});
 await N.request.post(BASE+'/api/auth/login',{data:{email:'nc'+S+'@glovels.com',password:'nc-'+S+'X'}});
 const nope=await N.request.post(BASE+'/api/staff/student/'+sid+'/document/sop/file',
   {multipart:{file:{name:'x.pdf',mimeType:'application/pdf',buffer:Buffer.from('x')}}});
 ok(nope.status()===403,'a counsellor without the case is refused — '+nope.status());

 console.log('\n'+pass+' passed, '+fail+' failed');
 await b.close(); process.exit(fail?1:0);
})();
