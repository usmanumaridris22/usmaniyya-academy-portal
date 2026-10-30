import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, passwordHash, verifyPassword, audit } from './db.js';

const app = express();
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const isProd = process.env.NODE_ENV === 'production';
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: isProd ? { directives: { defaultSrc:["'self'"], scriptSrc:["'self'"], styleSrc:["'self'", "'unsafe-inline'"], imgSrc:["'self'", 'data:', 'https://res.cloudinary.com'], connectSrc:["'self'"], objectSrc:["'none'"], frameAncestors:["'self'"] } } : false, crossOriginEmbedderPolicy:false, frameguard: isProd ? {action:'deny'} : false, crossOriginResourcePolicy:{policy:'cross-origin'} }));
app.use(express.json({limit:'100kb'}));
app.use(cookieParser());

// Only JSON mutations from this origin are accepted. Together with SameSite cookies this
// blocks cross-origin form submissions; TLS and a reverse proxy are required in production.
app.use('/api', (req,res,next) => {
  if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
    const origin = req.get('origin');
    if (origin) {
      try {
        const host = new URL(origin).host;
        const validHosts = [req.get('host'), req.get('x-forwarded-host')?.split(',')[0].trim()].filter(Boolean);
        if (!validHosts.includes(host)) return res.status(403).json({error:'Request origin is not allowed.'});
      } catch { return res.status(403).json({error:'Request origin is not allowed.'}); }
    }
    if (!req.is('application/json')) return res.status(415).json({error:'Send JSON data.'});
  }
  next();
});
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const text = (value, max=300) => typeof value === 'string' ? value.trim().slice(0,max) : '';
const validEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 160;
const asId = value => Number.isSafeInteger(Number(value)) && Number(value)>0 ? Number(value) : 0;
const validDate = s => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const d=new Date(s+'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10)===s; };
const validTime = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const safeUser = u => ({id:u.id, name:u.name, email:u.email, role:u.role, phone:u.phone});
const rate = new Map();
function limit(bucket, max, ms) {
  return (req,res,next) => {
    const key = `${bucket}:${req.ip}`; const now = Date.now(); let entry = rate.get(key);
    if (!entry || entry.until < now) entry={count:0,until:now+ms};
    entry.count++; rate.set(key,entry);
    if (entry.count > max) return res.status(429).json({error:'Too many attempts. Please try again later.'});
    next();
  };
}
function getSession(req) {
  const token = req.cookies.ua_session;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = db.prepare(`SELECT u.id,u.name,u.email,u.role,u.phone,u.status,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).get(sha(token));
  if (!row || row.expires_at < Date.now() || row.status !== 'active') return null;
  return row;
}
function requireAuth(req,res,next) { req.user=getSession(req); if(!req.user) return res.status(401).json({error:'Please sign in to continue.'}); next(); }
function requireRole(...roles) { return (req,res,next) => roles.includes(req.user.role) ? next() : res.status(403).json({error:'You do not have permission to access this resource.'}); }
function cookieOptions(req) {
  // The development preview can be embedded on a different site. A partitioned,
  // Secure cookie keeps that isolated preview usable without exposing a bearer token
  // to JavaScript. Production remains SameSite=Strict and refuses framing.
  const embeddedPreview = !isProd && !!req.secure;
  return {httpOnly:true,secure:!!req.secure || isProd,sameSite:embeddedPreview?'none':'strict',partitioned:embeddedPreview,path:'/',maxAge:8*60*60*1000};
}
function notify(userId,title,body,kind='info') { db.prepare('INSERT INTO notifications(user_id,title,body,kind) VALUES (?,?,?,?)').run(userId,title,body,kind); }
function learnerUsers(studentId) { return db.prepare('SELECT user_id AS id FROM students WHERE id=? UNION SELECT p.user_id AS id FROM parent_students ps JOIN parents p ON p.id=ps.parent_id WHERE ps.student_id=?').all(studentId,studentId); }
function schoolTerm() { return db.prepare(`SELECT t.id, t.name AS term, t.starts_on, t.ends_on, a.id AS session_id, a.name AS session FROM terms t JOIN academic_sessions a ON a.id=t.session_id WHERE t.is_current=1 LIMIT 1`).get() || null; }
function childrenFor(user) {
  if (user.role==='student') return db.prepare(`SELECT st.id,u.name,st.admission_number,c.name AS class_name,c.id AS class_id FROM students st JOIN users u ON u.id=st.user_id JOIN classes c ON c.id=st.class_id WHERE st.user_id=?`).all(user.id);
  if (user.role==='parent') return db.prepare(`SELECT st.id,u.name,st.admission_number,c.name AS class_name,c.id AS class_id FROM parent_students ps JOIN parents p ON p.id=ps.parent_id JOIN students st ON st.id=ps.student_id JOIN users u ON u.id=st.user_id JOIN classes c ON c.id=st.class_id WHERE p.user_id=?`).all(user.id);
  return [];
}
function canSeeStudent(user,studentId) { return user.role==='admin' || childrenFor(user).some(c=>c.id===studentId); }
function teacherId(user) { return db.prepare('SELECT id FROM teachers WHERE user_id=?').get(user.id)?.id; }
function teacherHas(user, classId, subjectId=null) {
  const t = teacherId(user); if(!t) return false;
  return subjectId ? !!db.prepare('SELECT 1 FROM teacher_assignments WHERE teacher_id=? AND class_id=? AND subject_id=?').get(t,classId,subjectId) : !!db.prepare('SELECT 1 FROM teacher_assignments WHERE teacher_id=? AND class_id=?').get(t,classId);
}
function withGrade(results) {
  const bands = db.prepare('SELECT * FROM grading_bands ORDER BY min_score DESC').all();
  return results.map(r=> { const total = Number(r.ca_score)+Number(r.exam_score); const band=bands.find(b=>total>=b.min_score) || {grade:'—',remark:''}; return {...r,total,grade:band.grade,remark:band.remark}; });
}
function fail(res,message,status=400) { return res.status(status).json({error:message}); }

app.get('/api/health', (req,res)=>res.json({status:'ok',demo:true}));
app.get('/api/public', (req,res)=>{
  const announcements=db.prepare("SELECT id,title,body,published_at FROM announcements WHERE audience='all' ORDER BY published_at DESC,id DESC LIMIT 4").all();
  const events=db.prepare("SELECT id,title,description,event_date,start_time,location FROM events WHERE event_date >= date('now') ORDER BY event_date,start_time LIMIT 5").all();
  res.json({announcements,events});
});
app.post('/api/applications',limit('applications',12,60*60*1000),(req,res)=>{
  const learner=text(req.body.learnerName,100), guardian=text(req.body.guardianName,100), email=text(req.body.email,160).toLowerCase(), classApplied=text(req.body.classApplied,80), note=text(req.body.note,1500);
  if(learner.length<2||guardian.length<2||!validEmail(email)||!classApplied) return fail(res,'Please complete all required fields with a valid email.');
  const ref='UA-'+crypto.randomBytes(5).toString('hex').toUpperCase();
  db.prepare('INSERT INTO applications(reference,learner_name,guardian_name,email,class_applied,note) VALUES (?,?,?,?,?,?)').run(ref,learner,guardian,email,classApplied,note);
  audit(null,'Submitted demo application','application',ref);
  res.status(201).json({reference:ref,message:'Your demo application has been saved. It has not been emailed to the school.'});
});
app.post('/api/applications/track',limit('track',20,60*60*1000),(req,res)=>{
  const ref=text(req.body.reference,40).toUpperCase(), email=text(req.body.email,160).toLowerCase();
  const result=db.prepare('SELECT reference,learner_name,class_applied,status,created_at FROM applications WHERE reference=? AND email=? COLLATE NOCASE').get(ref,email);
  if(!result) return fail(res,'No application found with those details.',404);
  res.json(result);
});
app.post('/api/contact',limit('contact',12,60*60*1000),(req,res)=>{
  const name=text(req.body.name,100), email=text(req.body.email,160).toLowerCase(), subject=text(req.body.subject,160), message=text(req.body.message,2000);
  if(name.length<2 || !validEmail(email) || subject.length<2 || message.length<5) return fail(res,'Please complete all fields with a valid email.');
  db.prepare('INSERT INTO enquiries(name,email,subject,message) VALUES (?,?,?,?)').run(name,email,subject,message);
  res.status(201).json({message:'Your demo message was saved in this workspace. Email delivery is not connected.'});
});

app.post('/api/auth/login',limit('login',30,15*60*1000),(req,res)=>{
  const email=text(req.body.email,160).toLowerCase(), password=typeof req.body.password==='string' ? req.body.password.slice(0,200) : '';
  const role=text(req.body.role,20);
  const user=db.prepare('SELECT * FROM users WHERE email=?').get(email);
  // A fixed dummy hash ensures an unknown email still takes a comparable scrypt computation.
  const hash=user?.password_hash || 'scrypt$0d9ca0f09a644eafb1dd886138109fdc$0a6f819d1c4b3fe79d9473be4cc430cfa7469410f59963fc7d519d14f55b7fac18a8d8f7a9f0ee82917536e916b0529d56d1fb05160ef390196527a7366a32bd';
  if(!verifyPassword(password,hash)||!user||user.status!=='active'||(role && user.role!==role)) return fail(res,'Incorrect email, password, or portal selection.',401);
  const token=crypto.randomBytes(32).toString('hex');
  if(req.cookies.ua_session && /^[a-f0-9]{64}$/.test(req.cookies.ua_session)) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(req.cookies.ua_session));
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').run(sha(token),user.id,Date.now()+8*60*60*1000);
  res.cookie('ua_session',token,cookieOptions(req));
  audit(user.id,'Signed in','session');
  res.json({user:safeUser(user), children:childrenFor(user), term:schoolTerm()});
});
app.get('/api/auth/me',requireAuth,(req,res)=>res.json({user:safeUser(req.user),children:childrenFor(req.user),term:schoolTerm()}));
app.post('/api/auth/logout',requireAuth,(req,res)=>{
  if(req.cookies.ua_session) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(req.cookies.ua_session));
  const {maxAge,...clearOptions}=cookieOptions(req); res.clearCookie('ua_session',clearOptions);
  res.json({ok:true});
});
app.post('/api/auth/change-password',requireAuth,limit('password',15,60*60*1000),(req,res)=>{
  const old=typeof req.body.currentPassword==='string'?req.body.currentPassword:'', next=typeof req.body.newPassword==='string'?req.body.newPassword:'';
  const user=db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
  if(!verifyPassword(old,user.password_hash)) return fail(res,'Your current password is incorrect.');
  if(next.length<10||next.length>128) return fail(res,'New password must be between 10 and 128 characters.');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash(next),req.user.id);
  // Revoke all other sessions, keep the current one.
  db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(req.user.id,sha(req.cookies.ua_session));
  audit(req.user.id,'Changed password','user',String(req.user.id));
  res.json({message:'Password updated. Other sessions have been signed out.'});
});
app.patch('/api/profile',requireAuth,(req,res)=>{
  const name=text(req.body.name,100),phone=text(req.body.phone,30);
  if(name.length<2) return fail(res,'Please enter your name.');
  db.prepare('UPDATE users SET name=?,phone=? WHERE id=?').run(name,phone,req.user.id);
  audit(req.user.id,'Updated profile','user',String(req.user.id));
  res.json({user:{...safeUser(req.user),name,phone},message:'Profile updated.'});
});
app.get('/api/notifications',requireAuth,(req,res)=>res.json(db.prepare('SELECT id,title,body,kind,is_read,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id)));
app.patch('/api/notifications/:id/read',requireAuth,(req,res)=>{
  const result=db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(asId(req.params.id),req.user.id);
  if(!result.changes) return fail(res,'Notification not found.',404); res.json({ok:true});
});
app.post('/api/notifications/read-all',requireAuth,(req,res)=>{ db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.user.id); res.json({ok:true}); });
app.get('/api/events',requireAuth,(req,res)=>res.json(db.prepare('SELECT * FROM events ORDER BY event_date,start_time').all()));
app.get('/api/announcements',requireAuth,(req,res)=>res.json(req.user.role==='admin' ? db.prepare('SELECT id,title,body,audience,published_at FROM announcements ORDER BY published_at DESC,id DESC').all() : db.prepare("SELECT id,title,body,audience,published_at FROM announcements WHERE audience='all' OR audience=? ORDER BY published_at DESC,id DESC").all(req.user.role)));
app.get('/api/books',requireAuth,(req,res)=>{
  const q=`%${text(req.query.q,100).replace(/[\\%_]/g,'\\$&')}%`;
  res.json(db.prepare("SELECT * FROM books WHERE title LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\' ORDER BY title").all(q,q,q));
});

app.get('/api/student/:id/data',requireAuth,(req,res)=>{
  const id=asId(req.params.id);
  if(!canSeeStudent(req.user,id)) return fail(res,'You do not have access to this student.',403);
  const student=db.prepare(`SELECT st.id,st.user_id,u.name,u.email,u.phone,st.admission_number,st.status,c.id AS class_id,c.name AS class_name,c.level FROM students st JOIN users u ON u.id=st.user_id JOIN classes c ON c.id=st.class_id WHERE st.id=?`).get(id);
  if(!student) return fail(res,'Student not found.',404);
  const attendance=db.prepare('SELECT date,status FROM attendance WHERE student_id=? ORDER BY date DESC LIMIT 90').all(id);
  const timetable=db.prepare(`SELECT tt.*,s.name AS subject,u.name AS teacher FROM timetable tt JOIN subjects s ON s.id=tt.subject_id LEFT JOIN teachers t ON t.id=tt.teacher_id LEFT JOIN users u ON u.id=t.user_id WHERE tt.class_id=? ORDER BY tt.weekday,tt.start_time`).all(student.class_id);
  const assignments=db.prepare(`SELECT a.*,s.name AS subject,u.name AS teacher,su.id AS submission_id,su.response,su.submitted_at FROM assignments a JOIN subjects s ON s.id=a.subject_id JOIN teachers t ON t.id=a.teacher_id JOIN users u ON u.id=t.user_id LEFT JOIN submissions su ON su.assignment_id=a.id AND su.student_id=? WHERE a.class_id=? ORDER BY a.due_date`).all(id,student.class_id);
  const exams=db.prepare(`SELECT e.*,s.name AS subject FROM examinations e JOIN subjects s ON s.id=e.subject_id WHERE e.class_id=? ORDER BY e.exam_date`).all(student.class_id);
  const results=withGrade(db.prepare(`SELECT r.id,r.ca_score,r.exam_score,r.status,s.name AS subject,t.name AS term,a.name AS session FROM results r JOIN subjects s ON s.id=r.subject_id JOIN terms t ON t.id=r.term_id JOIN academic_sessions a ON a.id=t.session_id WHERE r.student_id=? AND r.status='published' ORDER BY s.name`).all(id));
  const fees=db.prepare(`SELECT f.*,t.name AS term,COALESCE((SELECT SUM(p.amount_kobo) FROM payments p WHERE p.fee_id=f.id),0) AS paid_kobo FROM fees f JOIN terms t ON t.id=f.term_id WHERE f.student_id=? ORDER BY f.id DESC`).all(id);
  const payments=db.prepare(`SELECT p.id,p.reference,p.amount_kobo,p.paid_at,f.title FROM payments p JOIN fees f ON f.id=p.fee_id WHERE f.student_id=? ORDER BY p.id DESC`).all(id);
  const subjects=db.prepare(`SELECT DISTINCT s.id,s.name,s.code,u.name AS teacher FROM teacher_assignments ta JOIN subjects s ON s.id=ta.subject_id JOIN teachers t ON t.id=ta.teacher_id JOIN users u ON u.id=t.user_id WHERE ta.class_id=? ORDER BY s.name`).all(student.class_id);
  const borrowings=db.prepare(`SELECT b.id,bo.title,bo.author,b.borrowed_at,b.due_date,b.returned_at FROM borrowings b JOIN books bo ON bo.id=b.book_id WHERE b.student_id=? ORDER BY b.id DESC`).all(id);
  res.json({student,term:schoolTerm(),attendance,timetable,assignments,exams,results,fees,payments,subjects,borrowings});
});
app.post('/api/student/:id/submissions',requireAuth,requireRole('student'),(req,res)=>{
  const studentId=asId(req.params.id), assignmentId=asId(req.body.assignmentId), response=text(req.body.response,5000);
  if(!canSeeStudent(req.user,studentId)) return fail(res,'You do not have access to this student.',403);
  const row=db.prepare('SELECT a.id,a.class_id,a.due_date,a.teacher_id,a.subject_id,st.class_id AS student_class FROM assignments a JOIN students st ON st.id=? WHERE a.id=?').get(studentId,assignmentId);
  if(!row||row.class_id!==row.student_class) return fail(res,'Assignment not found.',404);
  if(response.length<5) return fail(res,'Please enter a response of at least 5 characters.');
  db.transaction(()=>{
    db.prepare(`INSERT INTO submissions(assignment_id,student_id,response) VALUES (?,?,?) ON CONFLICT(assignment_id,student_id) DO UPDATE SET response=excluded.response,submitted_at=CURRENT_TIMESTAMP`).run(assignmentId,studentId,response);
    const assigned=db.prepare('SELECT t.user_id FROM teachers t JOIN teacher_assignments ta ON ta.teacher_id=t.id WHERE t.id=? AND ta.class_id=? AND ta.subject_id=?').get(row.teacher_id,row.class_id,row.subject_id);
    if(assigned) notify(assigned.user_id,'Assignment submission',`${req.user.name} submitted a response.`,'assignment');
    audit(req.user.id,'Submitted assignment','submission',`assignment ${assignmentId}`);
  })();
  res.json({message:'Your response has been submitted.'});
});
app.get('/api/receipts/:id',requireAuth,(req,res)=>{
  const r=db.prepare(`SELECT p.id,p.reference,p.amount_kobo,p.paid_at,f.title,f.student_id,u.name AS student_name,st.admission_number,c.name AS class_name FROM payments p JOIN fees f ON f.id=p.fee_id JOIN students st ON st.id=f.student_id JOIN users u ON u.id=st.user_id JOIN classes c ON c.id=st.class_id WHERE p.id=?`).get(asId(req.params.id));
  if(!r) return fail(res,'Receipt not found.',404); if(!canSeeStudent(req.user,r.student_id)) return fail(res,'You do not have access to this receipt.',403);
  res.json(r);
});

function recipientsFor(user) {
  if(user.role==='admin') return db.prepare('SELECT id,name,role FROM users WHERE id<>? AND status=\'active\' ORDER BY name').all(user.id);
  const admin=db.prepare("SELECT id,name,role FROM users WHERE role='admin' AND status='active' AND id<>?").all(user.id);
  let others=[];
  if(user.role==='student'||user.role==='parent') {
    const children=childrenFor(user);
    for(const child of children) others.push(...db.prepare(`SELECT DISTINCT u.id,u.name,u.role FROM teacher_assignments ta JOIN teachers t ON t.id=ta.teacher_id JOIN users u ON u.id=t.user_id WHERE ta.class_id=? AND u.status='active'`).all(child.class_id));
  } else if(user.role==='teacher') {
    const tid=teacherId(user);
    others=db.prepare(`SELECT DISTINCT u.id,u.name,u.role FROM teacher_assignments ta JOIN students st ON st.class_id=ta.class_id JOIN users u ON u.id=st.user_id WHERE ta.teacher_id=? AND u.status='active' UNION SELECT DISTINCT u.id,u.name,u.role FROM teacher_assignments ta JOIN students st ON st.class_id=ta.class_id JOIN parent_students ps ON ps.student_id=st.id JOIN parents p ON p.id=ps.parent_id JOIN users u ON u.id=p.user_id WHERE ta.teacher_id=? AND u.status='active'`).all(tid,tid);
  }
  return [...new Map([...admin,...others].map(x=>[x.id,x])).values()].filter(x=>x.id!==user.id);
}
app.get('/api/messages',requireAuth,(req,res)=>{
  const recipients=recipientsFor(req.user);
  const messages=db.prepare(`SELECT m.id,m.sender_id,m.recipient_id,m.body,m.created_at,s.name AS sender_name,r.name AS recipient_name FROM messages m JOIN users s ON s.id=m.sender_id JOIN users r ON r.id=m.recipient_id WHERE m.sender_id=? OR m.recipient_id=? ORDER BY m.id ASC LIMIT 300`).all(req.user.id,req.user.id);
  res.json({recipients,messages});
});
app.post('/api/messages',requireAuth,limit('messages',120,60*60*1000),(req,res)=>{
  const recipient=asId(req.body.recipientId), body=text(req.body.body,2000);
  if(!recipientsFor(req.user).some(r=>r.id===recipient)) return fail(res,'You cannot message this account.',403);
  if(body.length<1) return fail(res,'Please write a message.');
  db.prepare('INSERT INTO messages(sender_id,recipient_id,body) VALUES (?,?,?)').run(req.user.id,recipient,body);
  notify(recipient,'New message',`${req.user.name} sent you a message.`,'message');
  res.status(201).json({message:'Message sent.'});
});

app.get('/api/teacher/data',requireAuth,requireRole('teacher'),(req,res)=>{
  const tid=teacherId(req.user); if(!tid) return fail(res,'Teacher profile not found.',404);
  const assignments=db.prepare(`SELECT ta.id,ta.class_id,ta.subject_id,c.name AS class_name,s.name AS subject FROM teacher_assignments ta JOIN classes c ON c.id=ta.class_id JOIN subjects s ON s.id=ta.subject_id WHERE ta.teacher_id=? ORDER BY c.name,s.name`).all(tid);
  const students=db.prepare(`SELECT DISTINCT st.id,u.name,st.admission_number,c.id AS class_id,c.name AS class_name FROM students st JOIN users u ON u.id=st.user_id JOIN classes c ON c.id=st.class_id JOIN teacher_assignments ta ON ta.class_id=st.class_id WHERE ta.teacher_id=? AND st.status='active' ORDER BY u.name`).all(tid);
  const timetable=db.prepare(`SELECT DISTINCT tt.*,s.name AS subject,c.name AS class_name FROM timetable tt JOIN subjects s ON s.id=tt.subject_id JOIN classes c ON c.id=tt.class_id WHERE tt.teacher_id=? ORDER BY tt.weekday,tt.start_time`).all(tid);
  const tasks=db.prepare(`SELECT a.*,s.name AS subject,c.name AS class_name,(SELECT COUNT(*) FROM submissions su WHERE su.assignment_id=a.id) AS submission_count FROM assignments a JOIN subjects s ON s.id=a.subject_id JOIN classes c ON c.id=a.class_id WHERE a.teacher_id=? AND EXISTS(SELECT 1 FROM teacher_assignments ta WHERE ta.teacher_id=a.teacher_id AND ta.class_id=a.class_id AND ta.subject_id=a.subject_id) ORDER BY a.id DESC`).all(tid);
  const submissions=db.prepare(`SELECT su.id,su.response,su.submitted_at,a.title,u.name AS student_name FROM submissions su JOIN assignments a ON a.id=su.assignment_id JOIN students st ON st.id=su.student_id JOIN users u ON u.id=st.user_id WHERE a.teacher_id=? AND EXISTS(SELECT 1 FROM teacher_assignments ta WHERE ta.teacher_id=a.teacher_id AND ta.class_id=a.class_id AND ta.subject_id=a.subject_id) ORDER BY su.id DESC`).all(tid);
  const results=withGrade(db.prepare(`SELECT r.id,r.student_id,r.class_id,r.subject_id,r.ca_score,r.exam_score,r.status,s.name AS subject,c.name AS class_name,u.name AS student_name,t.name AS term FROM results r JOIN subjects s ON s.id=r.subject_id JOIN classes c ON c.id=r.class_id JOIN students st ON st.id=r.student_id JOIN users u ON u.id=st.user_id JOIN terms t ON t.id=r.term_id WHERE EXISTS(SELECT 1 FROM teacher_assignments ta WHERE ta.teacher_id=? AND ta.class_id=r.class_id AND ta.subject_id=r.subject_id) ORDER BY r.id DESC`).all(tid));
  const attendance=db.prepare(`SELECT a.id,a.student_id,a.date,a.status,u.name AS student_name,c.name AS class_name FROM attendance a JOIN students st ON st.id=a.student_id JOIN users u ON u.id=st.user_id JOIN classes c ON c.id=a.class_id WHERE EXISTS(SELECT 1 FROM teacher_assignments ta WHERE ta.teacher_id=? AND ta.class_id=a.class_id) ORDER BY a.date DESC,u.name LIMIT 100`).all(tid);
  const exams=db.prepare(`SELECT e.*,c.name AS class_name,s.name AS subject FROM examinations e JOIN classes c ON c.id=e.class_id JOIN subjects s ON s.id=e.subject_id WHERE EXISTS(SELECT 1 FROM teacher_assignments ta WHERE ta.teacher_id=? AND ta.class_id=e.class_id AND ta.subject_id=e.subject_id) ORDER BY e.exam_date`).all(tid);
  res.json({assignments,students,timetable,tasks,submissions,results,attendance,exams,term:schoolTerm()});
});
app.post('/api/teacher/attendance',requireAuth,requireRole('teacher'),(req,res)=>{
  const studentId=asId(req.body.studentId),date=text(req.body.date,10),status=text(req.body.status,20);
  const student=db.prepare('SELECT id,class_id,user_id FROM students WHERE id=?').get(studentId);
  if(!student||!teacherHas(req.user,student.class_id)) return fail(res,'This student is not in an assigned class.',403);
  if(!validDate(date)||!['present','absent','late'].includes(status)) return fail(res,'Choose a valid date and attendance status.');
  const previous=db.prepare('SELECT status FROM attendance WHERE student_id=? AND date=?').get(studentId,date);
  db.transaction(()=>{
    db.prepare(`INSERT INTO attendance(student_id,class_id,date,status,recorded_by) VALUES (?,?,?,?,?) ON CONFLICT(student_id,date) DO UPDATE SET status=excluded.status,class_id=excluded.class_id,recorded_by=excluded.recorded_by`).run(studentId,student.class_id,date,status,req.user.id);
    if(!previous || previous.status!==status) for(const recipient of learnerUsers(studentId)) notify(recipient.id,'Attendance updated',`Attendance for ${date} was recorded as ${status}.`,'attendance');
    audit(req.user.id,'Recorded attendance','attendance',`student ${studentId}, ${date}: ${status}`);
  })();
  res.json({message:'Attendance saved.'});
});
app.post('/api/teacher/assignments',requireAuth,requireRole('teacher'),(req,res)=>{
  const classId=asId(req.body.classId),subjectId=asId(req.body.subjectId),title=text(req.body.title,160),description=text(req.body.description,3000),dueDate=text(req.body.dueDate,10);
  if(!teacherHas(req.user,classId,subjectId)) return fail(res,'You can only create assignments for your assigned subjects and classes.',403);
  if(title.length<3||description.length<5||!validDate(dueDate)) return fail(res,'Complete the title, instructions and due date.');
  const tid=teacherId(req.user);
  const transaction=db.transaction(()=>{
    db.prepare('INSERT INTO assignments(class_id,subject_id,teacher_id,title,description,due_date) VALUES (?,?,?,?,?,?)').run(classId,subjectId,tid,title,description,dueDate);
    const users=db.prepare(`SELECT u.id FROM students s JOIN users u ON u.id=s.user_id WHERE s.class_id=? UNION SELECT pu.id FROM students s JOIN parent_students ps ON ps.student_id=s.id JOIN parents p ON p.id=ps.parent_id JOIN users pu ON pu.id=p.user_id WHERE s.class_id=?`).all(classId,classId);
    for(const u of users) notify(u.id,'New assignment',`${title} has been assigned.`,'assignment');
    audit(req.user.id,'Created assignment','assignment',title);
  }); transaction(); res.status(201).json({message:'Assignment created for your class.'});
});
app.post('/api/teacher/results',requireAuth,requireRole('teacher'),(req,res)=>{
  const studentId=asId(req.body.studentId), subjectId=asId(req.body.subjectId),termId=asId(req.body.termId),ca=Number(req.body.caScore),exam=Number(req.body.examScore);
  const student=db.prepare('SELECT * FROM students WHERE id=?').get(studentId);
  if(!student||!teacherHas(req.user,student.class_id,subjectId)) return fail(res,'You can only submit results for your assigned students and subjects.',403);
  if(!db.prepare('SELECT id FROM terms WHERE id=?').get(termId)||req.body.caScore==null||req.body.caScore===''||req.body.examScore==null||req.body.examScore===''||!Number.isFinite(ca)||!Number.isFinite(exam)||ca<0||ca>40||exam<0||exam>60) return fail(res,'Enter CA from 0–40 and exam score from 0–60.');
  const existing=db.prepare('SELECT id,status FROM results WHERE student_id=? AND subject_id=? AND term_id=?').get(studentId,subjectId,termId);
  if(existing?.status==='published') return fail(res,'A published result cannot be changed by a teacher. Contact an administrator.',403);
  db.prepare(`INSERT INTO results(student_id,class_id,subject_id,term_id,ca_score,exam_score,status,submitted_by) VALUES (?,?,?,?,?,?,'pending',?) ON CONFLICT(student_id,subject_id,term_id) DO UPDATE SET ca_score=excluded.ca_score,exam_score=excluded.exam_score,status='pending',submitted_by=excluded.submitted_by`).run(studentId,student.class_id,subjectId,termId,ca,exam,req.user.id);
  for(const admin of db.prepare("SELECT id FROM users WHERE role='admin' AND status='active'").all()) notify(admin.id,'Result awaiting approval','A teacher has submitted a result for review.','result');
  audit(req.user.id,'Submitted result for approval','result',`student ${studentId}, subject ${subjectId}`);
  res.json({message:'Result saved and awaiting administrator approval.'});
});

app.get('/api/admin/data',requireAuth,requireRole('admin'),(req,res)=>{
  const counts={
    students:db.prepare("SELECT COUNT(*) AS n FROM students WHERE status='active'").get().n,
    teachers:db.prepare('SELECT COUNT(*) AS n FROM teachers').get().n,
    staff:db.prepare('SELECT COUNT(*) AS n FROM staff').get().n,
    classes:db.prepare('SELECT COUNT(*) AS n FROM classes').get().n,
    attendance:db.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN status='present' THEN 1 ELSE 0 END) AS present FROM attendance").get(),
    outstanding:db.prepare('SELECT COALESCE(SUM(amount_kobo),0)-(SELECT COALESCE(SUM(amount_kobo),0) FROM payments) AS amount FROM fees').get().amount
  };
  const students=db.prepare(`SELECT st.id,st.user_id,u.name,u.email,st.admission_number,st.status,c.id AS class_id,c.name AS class_name FROM students st JOIN users u ON u.id=st.user_id JOIN classes c ON c.id=st.class_id ORDER BY u.name`).all();
  const teachers=db.prepare(`SELECT t.id,u.id AS user_id,u.name,u.email,t.department FROM teachers t JOIN users u ON u.id=t.user_id ORDER BY u.name`).all();
  const staff=db.prepare(`SELECT st.id,u.id AS user_id,u.name,u.email,st.position,st.department FROM staff st JOIN users u ON u.id=st.user_id ORDER BY u.name`).all();
  const parents=db.prepare(`SELECT p.id,u.id AS user_id,u.name,u.email,p.relationship,GROUP_CONCAT(su.name, ', ') AS children FROM parents p JOIN users u ON u.id=p.user_id LEFT JOIN parent_students ps ON ps.parent_id=p.id LEFT JOIN students s ON s.id=ps.student_id LEFT JOIN users su ON su.id=s.user_id GROUP BY p.id ORDER BY u.name`).all();
  const classes=db.prepare('SELECT c.*,a.name AS session FROM classes c LEFT JOIN academic_sessions a ON a.id=c.session_id ORDER BY c.name').all();
  const subjects=db.prepare('SELECT * FROM subjects ORDER BY name').all();
  const sessions=db.prepare('SELECT * FROM academic_sessions ORDER BY id DESC').all();
  const terms=db.prepare('SELECT t.*,a.name AS session FROM terms t JOIN academic_sessions a ON a.id=t.session_id ORDER BY t.id DESC').all();
  const teaching=db.prepare(`SELECT ta.id,ta.teacher_id,ta.class_id,ta.subject_id,u.name AS teacher,c.name AS class_name,s.name AS subject FROM teacher_assignments ta JOIN teachers t ON t.id=ta.teacher_id JOIN users u ON u.id=t.user_id JOIN classes c ON c.id=ta.class_id JOIN subjects s ON s.id=ta.subject_id ORDER BY c.name,s.name`).all();
  const results=withGrade(db.prepare(`SELECT r.id,r.student_id,r.class_id,r.subject_id,r.ca_score,r.exam_score,r.status,s.name AS subject,c.name AS class_name,u.name AS student_name,t.name AS term FROM results r JOIN subjects s ON s.id=r.subject_id JOIN classes c ON c.id=r.class_id JOIN students st ON st.id=r.student_id JOIN users u ON u.id=st.user_id JOIN terms t ON t.id=r.term_id ORDER BY r.id DESC`).all());
  const fees=db.prepare(`SELECT f.*,u.name AS student_name,c.name AS class_name,t.name AS term,COALESCE((SELECT SUM(p.amount_kobo) FROM payments p WHERE p.fee_id=f.id),0) AS paid_kobo FROM fees f JOIN students st ON st.id=f.student_id JOIN users u ON u.id=st.user_id JOIN classes c ON c.id=st.class_id JOIN terms t ON t.id=f.term_id ORDER BY f.id DESC`).all();
  const payments=db.prepare(`SELECT p.id,p.reference,p.amount_kobo,p.paid_at,u.name AS student_name,f.title FROM payments p JOIN fees f ON f.id=p.fee_id JOIN students st ON st.id=f.student_id JOIN users u ON u.id=st.user_id ORDER BY p.id DESC`).all();
  const activity=db.prepare(`SELECT a.id,a.action,a.entity,a.detail,a.created_at,COALESCE(u.name,'Visitor') AS actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100`).all();
  const attendance=db.prepare(`SELECT a.id,a.date,a.status,u.name AS student_name,c.name AS class_name FROM attendance a JOIN students st ON st.id=a.student_id JOIN users u ON u.id=st.user_id JOIN classes c ON c.id=a.class_id ORDER BY a.date DESC,u.name LIMIT 100`).all();
  const applications=db.prepare('SELECT id,reference,learner_name,guardian_name,email,class_applied,status,created_at FROM applications ORDER BY id DESC LIMIT 100').all();
  const enquiries=db.prepare('SELECT id,name,email,subject,message,created_at FROM enquiries ORDER BY id DESC LIMIT 100').all();
  const borrowings=db.prepare(`SELECT br.*,b.title,u.name AS student_name FROM borrowings br JOIN books b ON b.id=br.book_id JOIN students st ON st.id=br.student_id JOIN users u ON u.id=st.user_id ORDER BY br.id DESC`).all();
  const users=db.prepare('SELECT id,name,email,role,status FROM users ORDER BY name').all();
  const announcements=db.prepare('SELECT * FROM announcements ORDER BY id DESC').all();
  const events=db.prepare('SELECT * FROM events ORDER BY event_date').all();
  const timetable=db.prepare(`SELECT tt.*,c.name AS class_name,s.name AS subject,u.name AS teacher FROM timetable tt JOIN classes c ON c.id=tt.class_id JOIN subjects s ON s.id=tt.subject_id LEFT JOIN teachers t ON t.id=tt.teacher_id LEFT JOIN users u ON u.id=t.user_id ORDER BY c.name,tt.weekday,tt.start_time`).all();
  const exams=db.prepare(`SELECT e.*,c.name AS class_name,s.name AS subject FROM examinations e JOIN classes c ON c.id=e.class_id JOIN subjects s ON s.id=e.subject_id ORDER BY e.exam_date`).all();
  const grading=db.prepare('SELECT * FROM grading_bands ORDER BY min_score DESC').all();
  res.json({counts,students,teachers,staff,parents,classes,subjects,sessions,terms,teaching,results,fees,payments,activity,attendance,applications,enquiries,borrowings,users,announcements,events,timetable,exams,grading,term:schoolTerm()});
});
app.post('/api/admin/students',requireAuth,requireRole('admin'),(req,res)=>{
  const name=text(req.body.name,100),email=text(req.body.email,160).toLowerCase(),password=typeof req.body.password==='string'?req.body.password:'',admission=text(req.body.admissionNumber,50),classId=asId(req.body.classId);
  if(name.length<2||!validEmail(email)||password.length<10||password.length>128||admission.length<2||!db.prepare('SELECT id FROM classes WHERE id=?').get(classId)) return fail(res,'Complete all fields. Password must be at least 10 characters.');
  try { db.transaction(()=>{ const uid=db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?,'student')").run(name,email,passwordHash(password)).lastInsertRowid; db.prepare('INSERT INTO students(user_id,admission_number,class_id) VALUES (?,?,?)').run(uid,admission,classId); notify(uid,'Welcome to your portal','Your student account is ready.','info'); audit(req.user.id,'Registered student','student',admission); })(); res.status(201).json({message:'Student account created.'}); } catch(e) { if(String(e.message).includes('UNIQUE')) return fail(res,'That email or admission number is already in use.'); throw e; }
});
app.patch('/api/admin/students/:id',requireAuth,requireRole('admin'),(req,res)=>{
  const id=asId(req.params.id),classId=asId(req.body.classId),status=text(req.body.status,20),name=text(req.body.name,100),email=text(req.body.email,160).toLowerCase(),admission=text(req.body.admissionNumber,50);
  if(!db.prepare('SELECT id FROM students WHERE id=?').get(id)) return fail(res,'Student not found.',404);
  if(!db.prepare('SELECT id FROM classes WHERE id=?').get(classId)||!['active','inactive'].includes(status)||name.length<2||!validEmail(email)||admission.length<2) return fail(res,'Provide a valid name, email, admission number, class and status.');
  try {db.transaction(()=>{db.prepare('UPDATE students SET class_id=?,status=?,admission_number=? WHERE id=?').run(classId,status,admission,id);db.prepare('UPDATE users SET name=?,email=?,status=? WHERE id=(SELECT user_id FROM students WHERE id=?)').run(name,email,status,id);audit(req.user.id,'Updated student record','student',String(id));})();res.json({message:'Student record updated.'});}
  catch(e){if(String(e.message).includes('UNIQUE'))return fail(res,'That email or admission number is already in use.');throw e;}
});
app.post('/api/admin/teachers',requireAuth,requireRole('admin'),(req,res)=>{
  const name=text(req.body.name,100),email=text(req.body.email,160).toLowerCase(),password=typeof req.body.password==='string'?req.body.password:'',department=text(req.body.department,80);
  if(name.length<2||!validEmail(email)||password.length<10||password.length>128||!department) return fail(res,'Complete all fields. Password must be at least 10 characters.');
  try { db.transaction(()=>{ const uid=db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?,'teacher')").run(name,email,passwordHash(password)).lastInsertRowid; db.prepare('INSERT INTO teachers(user_id,department) VALUES (?,?)').run(uid,department); audit(req.user.id,'Registered teacher','teacher',email); })(); res.status(201).json({message:'Teacher account created. Assign their classes in Academics.'}); } catch(e) { if(String(e.message).includes('UNIQUE')) return fail(res,'That email is already in use.'); throw e; }
});
app.patch('/api/admin/teachers/:id',requireAuth,requireRole('admin'),(req,res)=>{
  const id=asId(req.params.id),name=text(req.body.name,100),email=text(req.body.email,160).toLowerCase(),department=text(req.body.department,80);
  if(!db.prepare('SELECT id FROM teachers WHERE id=?').get(id)) return fail(res,'Teacher not found.',404);
  if(name.length<2||!validEmail(email)||!department) return fail(res,'Provide a valid name, email and department.');
  try {db.transaction(()=>{db.prepare('UPDATE teachers SET department=? WHERE id=?').run(department,id);db.prepare('UPDATE users SET name=?,email=? WHERE id=(SELECT user_id FROM teachers WHERE id=?)').run(name,email,id);audit(req.user.id,'Updated teacher profile','teacher',String(id));})();res.json({message:'Teacher profile updated.'});}
  catch(e){if(String(e.message).includes('UNIQUE')) return fail(res,'That email is already in use.');throw e;}
});
app.post('/api/admin/staff',requireAuth,requireRole('admin'),(req,res)=>{
  const name=text(req.body.name,100),email=text(req.body.email,160).toLowerCase(),password=typeof req.body.password==='string'?req.body.password:'',department=text(req.body.department,80),position=text(req.body.position,80);
  if(name.length<2||!validEmail(email)||password.length<10||password.length>128||!department||!position) return fail(res,'Complete all fields. Password must be at least 10 characters.');
  try {db.transaction(()=>{const uid=db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?,'admin')").run(name,email,passwordHash(password)).lastInsertRowid;db.prepare('INSERT INTO staff(user_id,position,department) VALUES (?,?,?)').run(uid,position,department);audit(req.user.id,'Registered administrative staff','staff',email);})();res.status(201).json({message:'Administrative staff account created with administrator access.'});}
  catch(e){if(String(e.message).includes('UNIQUE'))return fail(res,'That email is already in use.');throw e;}
});
app.post('/api/admin/parents',requireAuth,requireRole('admin'),(req,res)=>{
  const name=text(req.body.name,100),email=text(req.body.email,160).toLowerCase(),password=typeof req.body.password==='string'?req.body.password:'',studentId=asId(req.body.studentId),relationship=text(req.body.relationship,50)||'Guardian';
  if(name.length<2||!validEmail(email)||password.length<10||password.length>128||!db.prepare('SELECT id FROM students WHERE id=?').get(studentId)) return fail(res,'Complete all fields and choose a student. Password must be at least 10 characters.');
  try { db.transaction(()=>{ const uid=db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?,'parent')").run(name,email,passwordHash(password)).lastInsertRowid; const pid=db.prepare('INSERT INTO parents(user_id,relationship) VALUES (?,?)').run(uid,relationship).lastInsertRowid; db.prepare('INSERT INTO parent_students(parent_id,student_id) VALUES (?,?)').run(pid,studentId); audit(req.user.id,'Registered and linked parent','parent',email); })(); res.status(201).json({message:'Parent account created and linked.'}); } catch(e) { if(String(e.message).includes('UNIQUE')) return fail(res,'That email is already in use.'); throw e; }
});
app.post('/api/admin/parents/:id/link',requireAuth,requireRole('admin'),(req,res)=>{
  const parentId=asId(req.params.id),studentId=asId(req.body.studentId);
  if(!db.prepare('SELECT id FROM parents WHERE id=?').get(parentId)||!db.prepare('SELECT id FROM students WHERE id=?').get(studentId)) return fail(res,'Choose a valid parent and student.');
  const result=db.prepare('INSERT OR IGNORE INTO parent_students(parent_id,student_id) VALUES (?,?)').run(parentId,studentId);
  if(!result.changes) return fail(res,'That learner is already linked to this parent.');
  audit(req.user.id,'Linked parent and learner','parent',String(parentId));res.json({message:'Learner linked to parent account.'});
});
app.post('/api/admin/attendance',requireAuth,requireRole('admin'),(req,res)=>{
  const studentId=asId(req.body.studentId),date=text(req.body.date,10),status=text(req.body.status,20),student=db.prepare('SELECT id,class_id FROM students WHERE id=?').get(studentId);
  if(!student||!validDate(date)||!['present','absent','late'].includes(status)) return fail(res,'Choose a valid learner, date and attendance status.');
  const previous=db.prepare('SELECT status FROM attendance WHERE student_id=? AND date=?').get(studentId,date);
  db.transaction(()=>{db.prepare(`INSERT INTO attendance(student_id,class_id,date,status,recorded_by) VALUES (?,?,?,?,?) ON CONFLICT(student_id,date) DO UPDATE SET status=excluded.status,class_id=excluded.class_id,recorded_by=excluded.recorded_by`).run(studentId,student.class_id,date,status,req.user.id);if(!previous||previous.status!==status)for(const r of learnerUsers(studentId))notify(r.id,'Attendance updated',`Attendance for ${date} was recorded as ${status}.`,'attendance');audit(req.user.id,'Recorded attendance','attendance',`student ${studentId}, ${date}: ${status}`);})();
  res.json({message:'Attendance saved.'});
});
app.post('/api/admin/academic/:kind',requireAuth,requireRole('admin'),(req,res)=>{
  const kind=req.params.kind, name=text(req.body.name,100);
  try {
    if(kind==='sessions') {
      const start=text(req.body.startsOn,10),end=text(req.body.endsOn,10);
      if(!name||!validDate(start)||!validDate(end)||start>end) return fail(res,'Provide a session name and valid start/end dates.');
      db.transaction(()=>{if(req.body.current){db.prepare('UPDATE academic_sessions SET is_current=0').run();db.prepare('UPDATE terms SET is_current=0').run();} db.prepare('INSERT INTO academic_sessions(name,starts_on,ends_on,is_current) VALUES (?,?,?,?)').run(name,start,end,req.body.current?1:0);})();
    } else if(kind==='terms') {
      const sessionId=asId(req.body.sessionId),start=text(req.body.startsOn,10),end=text(req.body.endsOn,10);
      if(!name||!db.prepare('SELECT id FROM academic_sessions WHERE id=?').get(sessionId)||!validDate(start)||!validDate(end)||start>end) return fail(res,'Provide a session, term and valid dates.');
      db.transaction(()=>{if(req.body.current){db.prepare('UPDATE terms SET is_current=0').run();db.prepare('UPDATE academic_sessions SET is_current=0').run();db.prepare('UPDATE academic_sessions SET is_current=1 WHERE id=?').run(sessionId);} db.prepare('INSERT INTO terms(session_id,name,starts_on,ends_on,is_current) VALUES (?,?,?,?,?)').run(sessionId,name,start,end,req.body.current?1:0);})();
    } else if(kind==='classes') {
      const level=text(req.body.level,60)||'Secondary',sessionId=asId(req.body.sessionId);
      if(!name||!db.prepare('SELECT id FROM academic_sessions WHERE id=?').get(sessionId)) return fail(res,'Provide a class name and session.');
      db.prepare('INSERT INTO classes(name,level,session_id) VALUES (?,?,?)').run(name,level,sessionId);
    } else if(kind==='subjects') {
      const code=text(req.body.code,20).toUpperCase(); if(!name||!code) return fail(res,'Provide a subject name and code.');
      db.prepare('INSERT INTO subjects(name,code) VALUES (?,?)').run(name,code);
    } else if(kind==='teaching') {
      const tid=asId(req.body.teacherId),cid=asId(req.body.classId),sid=asId(req.body.subjectId);
      if(!db.prepare('SELECT id FROM teachers WHERE id=?').get(tid)||!db.prepare('SELECT id FROM classes WHERE id=?').get(cid)||!db.prepare('SELECT id FROM subjects WHERE id=?').get(sid)) return fail(res,'Choose a valid teacher, class and subject.');
      db.prepare('INSERT INTO teacher_assignments(teacher_id,class_id,subject_id) VALUES (?,?,?)').run(tid,cid,sid);
    } else return fail(res,'Unknown academic resource.',404);
    audit(req.user.id,`Created ${kind}`,'academics',name); res.status(201).json({message:'Academic record saved.'});
  } catch(e) { if(String(e.message).includes('UNIQUE')) return fail(res,'That record already exists.'); throw e; }
});
app.post('/api/admin/academic/:kind/:id/activate',requireAuth,requireRole('admin'),(req,res)=>{
  const id=asId(req.params.id),kind=req.params.kind;
  if(kind==='sessions'){
    if(!db.prepare('SELECT id FROM academic_sessions WHERE id=?').get(id)) return fail(res,'Session not found.',404);
    db.transaction(()=>{db.prepare('UPDATE academic_sessions SET is_current=0').run();db.prepare('UPDATE academic_sessions SET is_current=1 WHERE id=?').run(id);db.prepare('UPDATE terms SET is_current=0 WHERE session_id<>?').run(id);audit(req.user.id,'Changed current session','academics',String(id));})();
  } else if(kind==='terms'){
    const term=db.prepare('SELECT id,session_id FROM terms WHERE id=?').get(id);if(!term)return fail(res,'Term not found.',404);
    db.transaction(()=>{db.prepare('UPDATE terms SET is_current=0').run();db.prepare('UPDATE terms SET is_current=1 WHERE id=?').run(id);db.prepare('UPDATE academic_sessions SET is_current=0').run();db.prepare('UPDATE academic_sessions SET is_current=1 WHERE id=?').run(term.session_id);audit(req.user.id,'Changed current term','academics',String(id));})();
  } else return fail(res,'Unknown academic resource.',404);
  res.json({message:kind==='terms'?'Current term updated.':'Current session updated. Select a current term if needed.'});
});
app.post('/api/admin/results/:id/publish',requireAuth,requireRole('admin'),(req,res)=>{
  const id=asId(req.params.id),result=db.prepare('SELECT r.*,s.user_id FROM results r JOIN students s ON s.id=r.student_id WHERE r.id=?').get(id);
  if(!result) return fail(res,'Result not found.',404); if(result.status==='published') return fail(res,'This result is already published.');
  db.transaction(()=>{db.prepare("UPDATE results SET status='published',published_at=CURRENT_TIMESTAMP WHERE id=?").run(id); notify(result.user_id,'Result published','A new result is available in your grade sheet.','result'); const parents=db.prepare('SELECT p.user_id FROM parent_students ps JOIN parents p ON p.id=ps.parent_id WHERE ps.student_id=?').all(result.student_id); for(const p of parents) notify(p.user_id,'Result published','A new result is available for your linked learner.','result'); audit(req.user.id,'Approved and published result','result',String(id));})();
  res.json({message:'Result approved and published.'});
});
app.post('/api/admin/fees',requireAuth,requireRole('admin'),(req,res)=>{
  const sid=asId(req.body.studentId),tid=asId(req.body.termId),title=text(req.body.title,150),amount=Number(req.body.amount),due=text(req.body.dueDate,10);
  if(!db.prepare('SELECT id FROM students WHERE id=?').get(sid)||!db.prepare('SELECT id FROM terms WHERE id=?').get(tid)||title.length<2||!Number.isFinite(amount)||Math.round(amount*100)<1||amount>1e8||!validDate(due)) return fail(res,'Please provide a valid student, term, amount and due date.');
  db.prepare('INSERT INTO fees(student_id,term_id,title,amount_kobo,due_date) VALUES (?,?,?,?,?)').run(sid,tid,title,Math.round(amount*100),due);
  audit(req.user.id,'Created fee','fee',title); res.status(201).json({message:'Fee recorded.'});
});
app.post('/api/admin/payments',requireAuth,requireRole('admin'),(req,res)=>{
  const feeId=asId(req.body.feeId),amount=Number(req.body.amount),fee=db.prepare(`SELECT f.*,COALESCE((SELECT SUM(amount_kobo) FROM payments WHERE fee_id=f.id),0) AS paid FROM fees f WHERE f.id=?`).get(feeId);
  if(!fee||!Number.isFinite(amount)||Math.round(amount*100)<1||Math.round(amount*100)>fee.amount_kobo-fee.paid) return fail(res,'Enter an amount within the outstanding balance.');
  const reference='UA-'+crypto.randomBytes(5).toString('hex').toUpperCase();
  const id=db.prepare('INSERT INTO payments(fee_id,amount_kobo,reference,recorded_by) VALUES (?,?,?,?)').run(feeId,Math.round(amount*100),reference,req.user.id).lastInsertRowid;
  for(const recipient of learnerUsers(fee.student_id)) notify(recipient.id,'Payment recorded',`A payment was recorded for ${fee.title}.`,'payment');
  audit(req.user.id,'Recorded offline payment','payment',reference); res.status(201).json({message:'Offline payment recorded.',reference,id:Number(id)});
});
app.post('/api/admin/announcements',requireAuth,requireRole('admin'),(req,res)=>{
  const title=text(req.body.title,160),body=text(req.body.body,3000),audience=text(req.body.audience,20)||'all';
  if(title.length<3||body.length<5||!['all','student','parent','teacher'].includes(audience)) return fail(res,'Enter a title, message and valid audience.');
  db.prepare('INSERT INTO announcements(title,body,audience,created_by) VALUES (?,?,?,?)').run(title,body,audience,req.user.id);
  const users=audience==='all'?db.prepare("SELECT id FROM users WHERE status='active'").all():db.prepare("SELECT id FROM users WHERE role=? AND status='active'").all(audience);
  for(const u of users) notify(u.id,'New announcement',title,'notice');
  audit(req.user.id,'Published announcement','announcement',title); res.status(201).json({message:'Announcement published.'});
});
app.post('/api/admin/events',requireAuth,requireRole('admin'),(req,res)=>{
  const title=text(req.body.title,160),description=text(req.body.description,1000),date=text(req.body.date,10),time=text(req.body.time,5),location=text(req.body.location,160);
  if(title.length<3||description.length<5||!validDate(date)||!validTime(time)||!location) return fail(res,'Complete the event details with a valid date and time.');
  db.transaction(()=>{db.prepare('INSERT INTO events(title,description,event_date,start_time,location,created_by) VALUES (?,?,?,?,?,?)').run(title,description,date,time,location,req.user.id);for(const u of db.prepare("SELECT id FROM users WHERE status='active'").all()) notify(u.id,'New school event',title,'event');audit(req.user.id,'Created event','event',title);})();
  res.status(201).json({message:'Event added.'});
});
app.post('/api/admin/books',requireAuth,requireRole('admin'),(req,res)=>{
  const title=text(req.body.title,160),author=text(req.body.author,120),category=text(req.body.category,80),copies=Number(req.body.copies);
  if(title.length<2||author.length<2||!category||!Number.isInteger(copies)||copies<1||copies>10000) return fail(res,'Enter a title, author, category and valid copy count.');
  db.prepare('INSERT INTO books(title,author,category,total_copies,available_copies) VALUES (?,?,?,?,?)').run(title,author,category,copies,copies);
  audit(req.user.id,'Added book','book',title); res.status(201).json({message:'Book added to the catalogue.'});
});
app.post('/api/admin/borrowings',requireAuth,requireRole('admin'),(req,res)=>{
  const sid=asId(req.body.studentId),bid=asId(req.body.bookId),due=text(req.body.dueDate,10),book=db.prepare('SELECT * FROM books WHERE id=?').get(bid);
  if(!book||book.available_copies<1||!db.prepare('SELECT id FROM students WHERE id=?').get(sid)||!validDate(due)) return fail(res,'Choose an available book, student and valid return date.');
  db.transaction(()=>{db.prepare("INSERT INTO borrowings(student_id,book_id,borrowed_at,due_date) VALUES (?,?,date('now'),?)").run(sid,bid,due); db.prepare('UPDATE books SET available_copies=available_copies-1 WHERE id=?').run(bid); audit(req.user.id,'Issued library book','borrowing',book.title);})();
  res.status(201).json({message:'Book issued.'});
});
app.post('/api/admin/borrowings/:id/return',requireAuth,requireRole('admin'),(req,res)=>{
  const borrow=db.prepare('SELECT * FROM borrowings WHERE id=?').get(asId(req.params.id));
  if(!borrow||borrow.returned_at) return fail(res,'Active borrowing record not found.',404);
  db.transaction(()=>{db.prepare("UPDATE borrowings SET returned_at=date('now') WHERE id=?").run(borrow.id); db.prepare('UPDATE books SET available_copies=available_copies+1 WHERE id=?').run(borrow.book_id); audit(req.user.id,'Returned library book','borrowing',String(borrow.id));})();
  res.json({message:'Book returned.'});
});
app.patch('/api/admin/applications/:id',requireAuth,requireRole('admin'),(req,res)=>{
  const id=asId(req.params.id),status=text(req.body.status,30);
  if(!['Received','Under review','Accepted','Not accepted'].includes(status)) return fail(res,'Choose a valid status.');
  const result=db.prepare('UPDATE applications SET status=? WHERE id=?').run(status,id); if(!result.changes) return fail(res,'Application not found.',404);
  audit(req.user.id,'Updated application status','application',String(id)); res.json({message:'Application status updated.'});
});
app.post('/api/admin/users/:id/reset-password',requireAuth,requireRole('admin'),(req,res)=>{
  const id=asId(req.params.id),password=typeof req.body.password==='string'?req.body.password:'';
  if(id===req.user.id) return fail(res,'Use your profile settings to change your own password.');
  if(password.length<10||password.length>128||!db.prepare('SELECT id FROM users WHERE id=?').get(id)) return fail(res,'Choose an account and a password of 10–128 characters.');
  db.transaction(()=>{db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash(password),id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);audit(req.user.id,'Reset account password','user',String(id));})();
  res.json({message:'Password reset. Existing sessions were revoked.'});
});


app.post('/api/admin/timetable',requireAuth,requireRole('admin'),(req,res)=>{
  const classId=asId(req.body.classId),subjectId=asId(req.body.subjectId),teacherId=asId(req.body.teacherId),weekday=Number(req.body.weekday),start=text(req.body.startTime,5),end=text(req.body.endTime,5),room=text(req.body.room,80);
  if(!db.prepare('SELECT 1 FROM teacher_assignments WHERE teacher_id=? AND class_id=? AND subject_id=?').get(teacherId,classId,subjectId)||!Number.isInteger(weekday)||weekday<1||weekday>5||!validTime(start)||!validTime(end)||start>=end) return fail(res,'Choose an assigned teacher, class and subject with valid times.');
  db.prepare('INSERT INTO timetable(class_id,subject_id,teacher_id,weekday,start_time,end_time,room) VALUES (?,?,?,?,?,?,?)').run(classId,subjectId,teacherId,weekday,start,end,room);
  audit(req.user.id,'Added timetable lesson','timetable',`class ${classId}, subject ${subjectId}`);res.status(201).json({message:'Timetable lesson added.'});
});
app.post('/api/admin/exams',requireAuth,requireRole('admin'),(req,res)=>{
  const classId=asId(req.body.classId),subjectId=asId(req.body.subjectId),title=text(req.body.title,160),date=text(req.body.date,10),time=text(req.body.time,5),venue=text(req.body.venue,120);
  if(!db.prepare('SELECT id FROM classes WHERE id=?').get(classId)||!db.prepare('SELECT id FROM subjects WHERE id=?').get(subjectId)||title.length<3||!validDate(date)||!validTime(time)||!venue) return fail(res,'Complete the exam details with a valid class, subject, date and time.');
  db.prepare('INSERT INTO examinations(class_id,subject_id,title,exam_date,start_time,venue) VALUES (?,?,?,?,?,?)').run(classId,subjectId,title,date,time,venue);
  for(const student of db.prepare('SELECT id FROM students WHERE class_id=?').all(classId)) for(const recipient of learnerUsers(student.id)) notify(recipient.id,'New examination scheduled',title,'exam');
  audit(req.user.id,'Scheduled examination','examination',title);res.status(201).json({message:'Examination scheduled.'});
});
app.post('/api/admin/grading',requireAuth,requireRole('admin'),(req,res)=>{
  const bands=req.body.bands;
  if(!Array.isArray(bands)||bands.length<1||bands.length>12) return fail(res,'Provide between 1 and 12 grading bands.');
  const cleaned=bands.map(b=>({min:Number(b.min_score),grade:text(b.grade,10),remark:text(b.remark,80)}));
  if(cleaned.some(b=>!Number.isFinite(b.min)||b.min<0||b.min>100||!b.grade||!b.remark)||!cleaned.some(b=>b.min===0)||new Set(cleaned.map(b=>b.min)).size!==cleaned.length) return fail(res,'Bands need unique minimums between 0 and 100, a grade and remark, including a minimum of 0.');
  db.transaction(()=>{db.prepare('DELETE FROM grading_bands').run();for(const b of cleaned)db.prepare('INSERT INTO grading_bands(min_score,grade,remark) VALUES (?,?,?)').run(b.min,b.grade,b.remark);audit(req.user.id,'Updated grading bands','academics');})();res.json({message:'Grading system updated.'});
});

app.use('/api',(req,res)=>res.status(404).json({error:'API endpoint not found.'}));
app.use((err,req,res,next)=>{ if(res.headersSent) return next(err); if(err.type==='entity.parse.failed') return res.status(400).json({error:'Invalid JSON request.'}); if(err.type==='entity.too.large') return res.status(413).json({error:'Request is too large.'}); console.error(err); res.status(500).json({error:'Something went wrong. Please try again.'}); });
if(isProd) {
  app.use(express.static(path.join(root,'dist')));
  app.get('*',(req,res)=>res.sendFile(path.join(root,'dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({server:{middlewareMode:true,host:'0.0.0.0',allowedHosts:true},appType:'spa'});
  app.use(vite.middlewares);
}
const port=Number(process.env.PORT)||3000;
app.listen(port,'0.0.0.0',()=>console.log(`Usmaniyya Academy running on port ${port} (${isProd?'production':'demo development'})`));
