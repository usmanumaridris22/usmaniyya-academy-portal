import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';

async function freePort(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}

test('database-backed workflows and server-side authorization',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'ua-test-')),port=await freePort(),base=`http://127.0.0.1:${port}`;
 const server=spawn(process.execPath,['server/index.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DB_PATH:path.join(dir,'test.sqlite'),NODE_ENV:'production',ALLOW_DEMO_DATA:'true'},stdio:['ignore','pipe','pipe']});
 let logs='';server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
 t.after(async()=>{server.kill('SIGTERM');await new Promise(r=>{if(server.exitCode!==null)r();else server.once('exit',r)});rmSync(dir,{recursive:true,force:true})});
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Test server did not start: '+logs)),15000);server.stdout.on('data',d=>{if(String(d).includes('running on port')){clearTimeout(timeout);resolve()}});server.once('exit',()=>{clearTimeout(timeout);reject(new Error('Test server exited: '+logs))})});
 async function request(path,{method='GET',cookie,body,headers={}}={}){const res=await fetch(base+'/api'+path,{method,headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});let data=await res.json();return {status:res.status,data,cookie:res.headers.get('set-cookie')?.split(';')[0],headers:res.headers};}
 async function login(role,email=role){const r=await request('/auth/login',{method:'POST',body:{email:`${email}@demo.usmaniyya.school`,password:'DemoPass123!',role}});assert.equal(r.status,200,JSON.stringify(r.data));assert.match(r.headers.get('set-cookie'),/HttpOnly/);assert.match(r.headers.get('set-cookie'),/SameSite=Strict/);assert.match(r.headers.get('set-cookie'),/Secure/);return r.cookie}
 await t.test('authentication, sessions and role boundaries',async()=>{
   assert.equal((await request('/admin/data')).status,401);
   assert.equal((await request('/auth/login',{method:'POST',body:{email:'student@demo.usmaniyya.school',password:'wrong',role:'student'}})).status,401);
   assert.equal((await request('/auth/login',{method:'POST',body:{email:'student@demo.usmaniyya.school',password:'DemoPass123!',role:'admin'}})).status,401);
   const student=await login('student'),parent=await login('parent'),teacher=await login('teacher'),admin=await login('admin'),student2=await login('student','david');
   t.context={student,parent,teacher,admin,student2};
   assert.equal((await request('/admin/data',{cookie:student})).status,403);
   assert.equal((await request('/admin/data',{cookie:teacher})).status,403);
   assert.equal((await request('/student/1/data',{cookie:student})).status,200);
   assert.equal((await request('/student/2/data',{cookie:student})).status,403);
   assert.equal((await request('/student/1/data',{cookie:parent})).status,200);
   assert.equal((await request('/student/2/data',{cookie:parent})).status,403);
   assert.equal((await request('/student/1/data',{cookie:teacher})).status,403);
   assert.equal((await request('/student/1/submissions',{method:'POST',cookie:parent,body:{assignmentId:1,response:'nope'}})).status,403);
   assert.equal((await request('/admin/events',{method:'POST',cookie:admin,headers:{origin:'https://evil.example'},body:{}})).status,403);
   assert.equal((await request('/auth/me',{cookie:student})).data.user.role,'student');
 });
 const {student,parent,teacher,admin,student2}=t.context;
 await t.test('assignment creation, scoped submission and notifications',async()=>{
   const td=(await request('/teacher/data',{cookie:teacher})).data,alloc=td.assignments.find(a=>a.class_name==='JSS 2A'&&a.subject==='Mathematics');assert.ok(alloc);
   const create=await request('/teacher/assignments',{method:'POST',cookie:teacher,body:{classId:alloc.class_id,subjectId:alloc.subject_id,title:'Test assignment',description:'Explain your work in a few words.',dueDate:'2030-01-15'}});assert.equal(create.status,201);
   const child=(await request('/student/1/data',{cookie:student})).data,task=child.assignments.find(a=>a.title==='Test assignment');assert.ok(task);
   assert.equal((await request('/student/1/submissions',{method:'POST',cookie:student,body:{assignmentId:task.id,response:'A complete sample response.'}})).status,200);
   assert.ok((await request('/teacher/data',{cookie:teacher})).data.submissions.some(s=>s.title==='Test assignment'));
   const notifications=(await request('/notifications',{cookie:student})).data;assert.ok(notifications.some(n=>n.title==='New assignment'));
   const parentNotifications=(await request('/notifications',{cookie:parent})).data;assert.ok(parentNotifications.some(n=>n.title==='New assignment'));
   assert.equal((await request(`/notifications/${parentNotifications[0].id}/read`,{method:'PATCH',cookie:student,body:{}})).status,404);
 });
 await t.test('results are scoped, calculated and require admin approval',async()=>{
   const td=(await request('/teacher/data',{cookie:teacher})).data,allocated=td.assignments.find(a=>a.class_name==='JSS 2A'&&a.subject==='Computer Studies');
   const all=(await request('/admin/data',{cookie:admin})).data;const unassigned=all.subjects.find(s=>s.name==='English Language');
   assert.equal((await request('/teacher/results',{method:'POST',cookie:teacher,body:{studentId:1,subjectId:unassigned.id,termId:td.term.id,caScore:35,examScore:50}})).status,403);
   const save=await request('/teacher/results',{method:'POST',cookie:teacher,body:{studentId:1,subjectId:allocated.subject_id,termId:td.term.id,caScore:36,examScore:54}});assert.equal(save.status,200);
   assert.ok(!(await request('/student/1/data',{cookie:student})).data.results.some(r=>r.subject==='Computer Studies'));
   const pending=(await request('/admin/data',{cookie:admin})).data.results.find(r=>r.subject==='Computer Studies');assert.equal(pending.status,'pending');assert.equal(pending.total,90);assert.equal(pending.grade,'A');
   assert.equal((await request(`/admin/results/${pending.id}/publish`,{method:'POST',cookie:student,body:{}})).status,403);
   assert.equal((await request(`/admin/results/${pending.id}/publish`,{method:'POST',cookie:admin,body:{}})).status,200);
   assert.ok((await request('/student/1/data',{cookie:parent})).data.results.some(r=>r.subject==='Computer Studies'&&r.total===90));
   assert.equal((await request('/teacher/results',{method:'POST',cookie:teacher,body:{studentId:1,subjectId:allocated.subject_id,termId:td.term.id,caScore:20,examScore:20}})).status,403);
 });
 await t.test('offline payments, receipts and scoped messaging',async()=>{
   const fee=(await request('/student/1/data',{cookie:student})).data.fees[0];
   assert.equal((await request('/admin/payments',{method:'POST',cookie:admin,body:{feeId:fee.id,amount:999999}})).status,400);
   const pay=await request('/admin/payments',{method:'POST',cookie:admin,body:{feeId:fee.id,amount:1500}});assert.equal(pay.status,201);
   assert.equal((await request(`/receipts/${pay.data.id}`,{cookie:student})).status,200);
   assert.equal((await request(`/receipts/${pay.data.id}`,{cookie:parent})).status,200);
   assert.equal((await request(`/receipts/${pay.data.id}`,{cookie:student2})).status,403);
   const contacts=(await request('/messages',{cookie:student})).data.recipients;assert.ok(contacts.some(c=>c.role==='teacher'));assert.ok(contacts.some(c=>c.role==='admin'));
   assert.equal((await request('/messages',{method:'POST',cookie:student,body:{recipientId:7,body:'Not authorised'}})).status,403);
   assert.equal((await request('/messages',{method:'POST',cookie:student,body:{recipientId:contacts.find(c=>c.role==='admin').id,body:'Hello, I have a question.'}})).status,201);
   assert.ok((await request('/messages',{cookie:admin})).data.messages.some(m=>m.body==='Hello, I have a question.'));
 });
 await t.test('public applications and admin tracking',async()=>{
   const submitted=await request('/applications',{method:'POST',body:{learnerName:'Example Learner',guardianName:'Example Guardian',email:'test@example.com',classApplied:'JSS 1',note:'Sample only'}});assert.equal(submitted.status,201);assert.match(submitted.data.reference,/^UA-/);
   const body={reference:submitted.data.reference,email:'test@example.com'};
   assert.equal((await request('/applications/track',{method:'POST',body})).data.status,'Received');
   assert.equal((await request('/applications/track',{method:'POST',body:{...body,email:'other@example.com'}})).status,404);
   const apps=(await request('/admin/data',{cookie:admin})).data.applications;const app=apps.find(a=>a.reference===body.reference);assert.ok(app);
   assert.equal((await request(`/admin/applications/${app.id}`,{method:'PATCH',cookie:admin,body:{status:'Under review'}})).status,200);
   assert.equal((await request('/applications/track',{method:'POST',body})).data.status,'Under review');
 });
 await t.test('administration updates, family linking and attendance notifications',async()=>{
   const ad=(await request('/admin/data',{cookie:admin})).data,david=ad.students.find(s=>s.name==='David Okafor'),p=ad.parents.find(p=>p.name==='Hauwa Yusuf');
   assert.equal((await request(`/admin/students/${david.id}`,{method:'PATCH',cookie:admin,body:{name:david.name,email:david.email,admissionNumber:david.admission_number,classId:david.class_id,status:'active'}})).status,200);
   assert.equal((await request(`/admin/parents/${p.id}/link`,{method:'POST',cookie:teacher,body:{studentId:david.id}})).status,403);
   assert.equal((await request(`/admin/parents/${p.id}/link`,{method:'POST',cookie:admin,body:{studentId:david.id}})).status,200);
   assert.equal((await request(`/student/${david.id}/data`,{cookie:parent})).status,200);
   assert.equal((await request('/admin/attendance',{method:'POST',cookie:admin,body:{studentId:david.id,date:'2030-01-03',status:'late'}})).status,200);
   assert.ok((await request('/notifications',{cookie:parent})).data.some(n=>n.title==='Attendance updated'));
 });
 await t.test('academic setup, validation and library issue/return',async()=>{
   assert.equal((await request('/teacher/attendance',{method:'POST',cookie:teacher,body:{studentId:1,date:'2030-02-30',status:'present'}})).status,400);
   assert.equal((await request('/admin/academic/sessions',{method:'POST',cookie:admin,body:{name:'2030/2031',startsOn:'2030-09-01',endsOn:'2031-07-31',current:true}})).status,201);
   const data=(await request('/admin/data',{cookie:admin})).data,session=data.sessions.find(s=>s.name==='2030/2031');assert.equal(session.is_current,1);
   assert.equal((await request('/admin/academic/terms',{method:'POST',cookie:admin,body:{name:'First Term',sessionId:session.id,startsOn:'2030-09-01',endsOn:'2030-12-20',current:true}})).status,201);
   assert.equal((await request('/admin/academic/classes',{method:'POST',cookie:admin,body:{name:'JSS Test',level:'Junior Secondary',sessionId:session.id}})).status,201);
   const term=(await request('/admin/data',{cookie:admin})).data.terms.find(t=>t.session_id===session.id);assert.equal((await request('/auth/me',{cookie:admin})).data.term.id,term.id);
   assert.equal((await request(`/admin/academic/terms/1/activate`,{method:'POST',cookie:student,body:{}})).status,403);
   assert.equal((await request(`/admin/academic/terms/1/activate`,{method:'POST',cookie:admin,body:{}})).status,200);
   assert.equal((await request('/auth/me',{cookie:admin})).data.term.id,1);
   const books=(await request('/books',{cookie:student})).data,book=books.find(b=>b.available_copies>0);
   assert.equal((await request('/admin/borrowings',{method:'POST',cookie:admin,body:{studentId:1,bookId:book.id,dueDate:'2030-10-10'}})).status,201);
   const active=(await request('/admin/data',{cookie:admin})).data.borrowings.find(b=>b.book_id===book.id&&!b.returned_at&&b.due_date==='2030-10-10');assert.ok(active);
   assert.equal((await request(`/admin/borrowings/${active.id}/return`,{method:'POST',cookie:admin,body:{}})).status,200);
 });
});
