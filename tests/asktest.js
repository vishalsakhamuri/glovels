const BASE='http://localhost:8099'; let pass=0,fail=0;
const ok=(t,c,e)=>{c?pass++:fail++;console.log((c?'  ✓ ':'  ✗ ')+t+(c?'':' — '+(e??'')))};
const jar={}; async function req(w,m,p,b){const h={'content-type':'application/json'};if(jar[w])h.cookie=jar[w];
const r=await fetch(BASE+p,{method:m,headers:h,body:b?JSON.stringify(b):undefined});
const sc=r.headers.getSetCookie?r.headers.getSetCookie():[];if(sc.length)jar[w]=sc.map(c=>c.split(';')[0]).join('; ');
let j=null;try{j=await r.json()}catch(e){} return{status:r.status,ok:r.ok,body:j}}
const login=(w,e,p)=>req(w,'POST','/api/auth/login',{email:e,password:p});
const day=n=>new Date(Date.now()+n*864e5).toISOString().slice(0,10);
(async()=>{
  const st=Date.now().toString(36);
  await login('a','admin@glovels.com','glovels123');
  let r=await req('a','POST','/api/staff/people',{name:'Ask Counsellor',email:'ac'+st+'@glovels.com',password:'ac-'+st,role:'counsellor'});
  const cId=r.body.person.id, cE='ac'+st+'@glovels.com', cP='ac-'+st;
  r=await req('a','POST','/api/staff/people',{name:'Ask Student',email:'as'+st+'@ex.example',password:'as-'+st,role:'student'});
  const sId=r.body.person.id;
  await req('a','PUT','/api/staff/student/'+sId+'/counsellor',{counsellorId:cId});
  r=await req('a','POST','/api/staff/student/'+sId+'/tasks',{title:'Send the Stuttgart application',due:day(2)});
  const tId=r.body.task.id;

  // --- the office asks a question about a specific task
  r=await req('a','POST','/api/staff/student/'+sId+'/guide',
    {kind:'question',taskId:tId,body:'Why has this not happened? It was due last week.'});
  ok('the office can ask a question about a task', r.ok, r.status+' '+JSON.stringify(r.body).slice(0,120));
  const q=(r.body.notes||[]).find(n=>n.kind==='question');
  ok('  · it is recorded as a question, not a note', !!q && q.kind==='question', q&&q.kind);
  ok('  · carrying what it is about', q && /Stuttgart/.test(q.about||''), q&&q.about);
  ok('  · and open until answered', q && !q.answered, q&&q.answered);

  // a question about someone else's task is refused
  r=await req('a','POST','/api/staff/student/'+sId+'/guide',{kind:'question',taskId:999999,body:'x'});
  ok('  · a task from another file is refused', r.status===422, r.status+' '+(r.body.error||''));

  // --- the office's board of open questions
  r=await req('a','GET','/api/staff/questions');
  ok('the office sees every unanswered question', r.ok && (r.body.open||[]).some(x=>x.id===q.id),
     r.status+' open='+((r.body.open||[]).length));
  const board=(r.body.open||[]).find(x=>x.id===q.id);
  ok('  · naming the student, the counsellor and how long it has waited',
     board && board.student==='Ask Student' && board.to==='Ask Counsellor' && board.waitingDays>=0,
     JSON.stringify(board||{}).slice(0,160));

  // --- the counsellor answers
  await login('c',cE,cP); await req('c','POST','/api/auth/change',{password:cP+'X'}); await login('c',cE,cP+'X');
  r=await req('c','GET','/api/staff/student/'+sId+'/guidance');
  ok('the counsellor sees the question on the file',
     (r.body.notes||[]).some(n=>n.kind==='question'&&/Why has this not happened/.test(n.body)));
  r=await req('c','POST','/api/staff/note/'+q.id+'/reply',
    {body:'The transcript came back wrong. Reissued Monday, filing Thursday.'});
  ok('and can answer it', r.ok, r.status+' '+(r.body.error||''));
  const ans=(r.body.notes||[]).find(n=>n.kind==='answer');
  ok('  · the answer is on the same file', !!ans && /Reissued Monday/.test(ans.body));
  ok('  · pointing at the question it answers', ans && Number(ans.parentId)===Number(q.id), ans&&ans.parentId);

  // --- the question closes
  r=await req('a','GET','/api/staff/questions');
  ok('the question is no longer open', !(r.body.open||[]).some(x=>x.id===q.id),
     (r.body.open||[]).length+' still open');
  const done=(r.body.answered||[]).find(x=>x.id===q.id);
  ok('  · and the answer is attached to it', done && done.answers.length===1 && /Reissued/.test(done.answers[0].body),
     JSON.stringify(done||{}).slice(0,180));

  // --- you cannot answer a plain note
  r=await req('a','POST','/api/staff/student/'+sId+'/guide',{body:'Just so you know.'});
  const note=(r.body.notes||[]).filter(n=>n.kind==='note').pop();
  r=await req('c','POST','/api/staff/note/'+note.id+'/reply',{body:'ok'});
  ok('a plain note cannot be answered', r.status===409, r.status+' '+(r.body.error||''));
  r=await req('c','POST','/api/staff/note/'+q.id+'/reply',{body:'   '});
  ok('an empty answer is refused', r.status===422, r.status);

  // --- what the counsellor did this week
  await req('c','PUT','/api/staff/task/'+tId,{status:'done'});
  r=await req('a','GET','/api/staff/counsellor/'+cId+'/activity?days=7');
  const act=r.body.activity;
  ok('the office can read what a counsellor did this week', r.ok && act, r.status);
  ok('  · counting what they finished', act && act.finished>=1, JSON.stringify(act||{}).slice(0,200));
  ok('  · listing it by name', act && act.finishedList.some(x=>/Stuttgart/.test(x.title)),
     JSON.stringify((act||{}).finishedList||[]).slice(0,160));
  ok('  · and how much is still owed', act && typeof act.stillOwed==='number' && typeof act.late==='number',
     act && (act.stillOwed+'/'+act.late));
  r=await req('c','GET','/api/staff/counsellor/'+cId+'/activity');
  ok('a counsellor may read their own', r.ok, r.status);
  r=await req('c','GET','/api/staff/counsellor/1/activity');
  ok('  · but not a colleague’s', r.status===403, r.status);
  console.log('\n  '+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
