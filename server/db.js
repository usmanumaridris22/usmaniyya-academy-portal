import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const db = new Database(process.env.DB_PATH || path.join(root, 'usmaniyya.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('student','parent','teacher','admin')),
  phone TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS academic_sessions (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, starts_on TEXT, ends_on TEXT, is_current INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS terms (id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES academic_sessions(id), name TEXT NOT NULL, starts_on TEXT, ends_on TEXT, is_current INTEGER NOT NULL DEFAULT 0, UNIQUE(session_id,name));
CREATE TABLE IF NOT EXISTS classes (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, level TEXT NOT NULL DEFAULT 'Secondary', session_id INTEGER REFERENCES academic_sessions(id));
CREATE TABLE IF NOT EXISTS subjects (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, code TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS students (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id), admission_number TEXT NOT NULL UNIQUE, class_id INTEGER NOT NULL REFERENCES classes(id), status TEXT NOT NULL DEFAULT 'active');
CREATE TABLE IF NOT EXISTS parents (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id), relationship TEXT DEFAULT 'Guardian');
CREATE TABLE IF NOT EXISTS parent_students (parent_id INTEGER NOT NULL REFERENCES parents(id), student_id INTEGER NOT NULL REFERENCES students(id), PRIMARY KEY(parent_id, student_id));
CREATE TABLE IF NOT EXISTS teachers (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id), department TEXT NOT NULL DEFAULT 'General');
CREATE TABLE IF NOT EXISTS staff (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id), position TEXT NOT NULL, department TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS teacher_assignments (id INTEGER PRIMARY KEY, teacher_id INTEGER NOT NULL REFERENCES teachers(id), class_id INTEGER NOT NULL REFERENCES classes(id), subject_id INTEGER NOT NULL REFERENCES subjects(id), UNIQUE(teacher_id,class_id,subject_id));
CREATE TABLE IF NOT EXISTS attendance (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), class_id INTEGER NOT NULL REFERENCES classes(id), date TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('present','absent','late')), recorded_by INTEGER REFERENCES users(id), UNIQUE(student_id,date));
CREATE TABLE IF NOT EXISTS timetable (id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id), subject_id INTEGER NOT NULL REFERENCES subjects(id), teacher_id INTEGER REFERENCES teachers(id), weekday INTEGER NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, room TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS assignments (id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id), subject_id INTEGER NOT NULL REFERENCES subjects(id), teacher_id INTEGER NOT NULL REFERENCES teachers(id), title TEXT NOT NULL, description TEXT NOT NULL, due_date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS submissions (id INTEGER PRIMARY KEY, assignment_id INTEGER NOT NULL REFERENCES assignments(id), student_id INTEGER NOT NULL REFERENCES students(id), response TEXT NOT NULL, submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(assignment_id,student_id));
CREATE TABLE IF NOT EXISTS examinations (id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id), subject_id INTEGER NOT NULL REFERENCES subjects(id), title TEXT NOT NULL, exam_date TEXT NOT NULL, start_time TEXT NOT NULL, venue TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS results (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), class_id INTEGER NOT NULL REFERENCES classes(id), subject_id INTEGER NOT NULL REFERENCES subjects(id), term_id INTEGER NOT NULL REFERENCES terms(id), ca_score REAL NOT NULL CHECK(ca_score BETWEEN 0 AND 40), exam_score REAL NOT NULL CHECK(exam_score BETWEEN 0 AND 60), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published')), submitted_by INTEGER REFERENCES users(id), published_at TEXT, UNIQUE(student_id,subject_id,term_id));
CREATE TABLE IF NOT EXISTS grading_bands (id INTEGER PRIMARY KEY, min_score REAL NOT NULL, grade TEXT NOT NULL, remark TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fees (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), term_id INTEGER NOT NULL REFERENCES terms(id), title TEXT NOT NULL, amount_kobo INTEGER NOT NULL, due_date TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY, fee_id INTEGER NOT NULL REFERENCES fees(id), amount_kobo INTEGER NOT NULL, reference TEXT NOT NULL UNIQUE, paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, recorded_by INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), title TEXT NOT NULL, body TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'info', is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS announcements (id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, audience TEXT NOT NULL DEFAULT 'all', created_by INTEGER REFERENCES users(id), published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, event_date TEXT NOT NULL, start_time TEXT NOT NULL, location TEXT NOT NULL, created_by INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS books (id INTEGER PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL, category TEXT NOT NULL, total_copies INTEGER NOT NULL DEFAULT 1, available_copies INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS borrowings (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), book_id INTEGER NOT NULL REFERENCES books(id), borrowed_at TEXT NOT NULL, due_date TEXT NOT NULL, returned_at TEXT);
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, sender_id INTEGER NOT NULL REFERENCES users(id), recipient_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS applications (id INTEGER PRIMARY KEY, reference TEXT NOT NULL UNIQUE, learner_name TEXT NOT NULL, guardian_name TEXT NOT NULL, email TEXT NOT NULL, class_applied TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Received', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS enquiries (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY, actor_id INTEGER REFERENCES users(id), action TEXT NOT NULL, entity TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS school_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, uploaded_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
`);

export function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}
export function verifyPassword(password, hash) {
  try {
    const [kind, salt, stored] = hash.split('$');
    if (kind !== 'scrypt' || !salt || !stored) return false;
    const a = crypto.scryptSync(password, salt, 64), b = Buffer.from(stored, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}
export function audit(actor, action, entity, detail = '') {
  db.prepare('INSERT INTO audit_logs(actor_id, action, entity, detail) VALUES (?, ?, ?, ?)').run(actor || null, action, entity, String(detail).slice(0, 500));
}
export function datePlus(days) {
  const date = new Date(); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10);
}
const seed = db.transaction(() => {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n) return;
  const year = new Date().getUTCFullYear();
  const start = new Date().getUTCMonth() >= 8 ? year : year - 1;
  const s = db.prepare('INSERT INTO academic_sessions(name, starts_on, ends_on, is_current) VALUES (?, ?, ?, 1)').run(`${start}/${start+1}`, `${start}-09-01`, `${start+1}-07-31`).lastInsertRowid;
  const t = db.prepare('INSERT INTO terms(session_id,name,starts_on,ends_on,is_current) VALUES (?, ?, ?, ?, 1)').run(s, 'First Term', `${start}-09-01`, `${start}-12-20`).lastInsertRowid;
  const classInsert = db.prepare('INSERT INTO classes(name,level,session_id) VALUES (?,?,?)');
  const c1 = classInsert.run('JSS 2A','Junior Secondary',s).lastInsertRowid;
  const c2 = classInsert.run('JSS 1A','Junior Secondary',s).lastInsertRowid;
  const c3 = classInsert.run('SSS 1A','Senior Secondary',s).lastInsertRowid;
  const addSubject = db.prepare('INSERT INTO subjects(name,code) VALUES (?,?)');
  const sub = {};
  for (const [name,code] of [['Mathematics','MTH'],['English Language','ENG'],['Basic Science','SCI'],['Social Studies','SOC'],['Computer Studies','ICT'],['Civic Education','CIV']]) sub[name] = Number(addSubject.run(name,code).lastInsertRowid);
  const addUser = db.prepare('INSERT INTO users(name,email,password_hash,role,phone) VALUES (?,?,?,?,?)');
  const ph = passwordHash('DemoPass123!');
  const u = {};
  for (const [key,name,email,role] of [
    ['student','Amina Yusuf','student@demo.usmaniyya.school','student'],
    ['parent','Hauwa Yusuf','parent@demo.usmaniyya.school','parent'],
    ['teacher','Zainab Bello','teacher@demo.usmaniyya.school','teacher'],
    ['admin','Abdullahi Musa','admin@demo.usmaniyya.school','admin'],
    ['student2','David Okafor','david@demo.usmaniyya.school','student'],
    ['teacher2','Tunde Adeyemi','tunde@demo.usmaniyya.school','teacher'],
    ['parent2','Ngozi Okafor','ngozi@demo.usmaniyya.school','parent']
  ]) u[key] = Number(addUser.run(name,email,ph,role,'').lastInsertRowid);
  const student = Number(db.prepare('INSERT INTO students(user_id,admission_number,class_id) VALUES (?,?,?)').run(u.student,'UA/2025/0142',c1).lastInsertRowid);
  const student2 = Number(db.prepare('INSERT INTO students(user_id,admission_number,class_id) VALUES (?,?,?)').run(u.student2,'UA/2025/0143',c1).lastInsertRowid);
  const p1 = db.prepare('INSERT INTO parents(user_id,relationship) VALUES (?,?)').run(u.parent,'Parent').lastInsertRowid;
  const p2 = db.prepare('INSERT INTO parents(user_id,relationship) VALUES (?,?)').run(u.parent2,'Parent').lastInsertRowid;
  db.prepare('INSERT INTO parent_students(parent_id,student_id) VALUES (?,?)').run(p1, student);
  db.prepare('INSERT INTO parent_students(parent_id,student_id) VALUES (?,?)').run(p2, student2);
  const teacher = Number(db.prepare('INSERT INTO teachers(user_id,department) VALUES (?,?)').run(u.teacher,'Sciences').lastInsertRowid);
  const teacher2 = Number(db.prepare('INSERT INTO teachers(user_id,department) VALUES (?,?)').run(u.teacher2,'Languages & Humanities').lastInsertRowid);
  db.prepare('INSERT INTO staff(user_id,position,department) VALUES (?,?,?)').run(u.admin,'School Administrator','Administration');
  const assn = db.prepare('INSERT INTO teacher_assignments(teacher_id,class_id,subject_id) VALUES (?,?,?)');
  for (const name of ['Mathematics','Basic Science','Computer Studies']) assn.run(teacher,c1,sub[name]);
  for (const name of ['English Language','Social Studies','Civic Education']) assn.run(teacher2,c1,sub[name]);
  assn.run(teacher,c2,sub.Mathematics); assn.run(teacher2,c3,sub['English Language']);
  const recAtt = db.prepare('INSERT INTO attendance(student_id,class_id,date,status,recorded_by) VALUES (?,?,?,?,?)');
  let recorded = 0;
  for (let days=1; recorded<20; days++) {
    const d = new Date(); d.setUTCDate(d.getUTCDate()-days); if ([0,6].includes(d.getUTCDay())) continue;
    const day = d.toISOString().slice(0,10);
    recAtt.run(student,c1,day,recorded === 8 ? 'absent' : recorded === 13 ? 'late' : 'present',u.teacher);
    recAtt.run(student2,c1,day,recorded === 5 ? 'absent' : 'present',u.teacher); recorded++;
  }
  const addSchedule = db.prepare('INSERT INTO timetable(class_id,subject_id,teacher_id,weekday,start_time,end_time,room) VALUES (?,?,?,?,?,?,?)');
  const names = ['Mathematics','English Language','Basic Science','Social Studies','Computer Studies','Civic Education'];
  for (let day=1; day<=5; day++) {
    for (let k=0; k<4; k++) {
      const name = names[(day + k - 1) % names.length]; const tm = name === 'Mathematics'||name === 'Basic Science'||name === 'Computer Studies' ? teacher : teacher2;
      addSchedule.run(c1,sub[name],tm,day,['08:00','09:00','10:30','11:30'][k],['08:50','09:50','11:20','12:20'][k], k===3?'Room 204':'Room 202');
    }
  }
  const addAssignment = db.prepare('INSERT INTO assignments(class_id,subject_id,teacher_id,title,description,due_date) VALUES (?,?,?,?,?,?)');
  addAssignment.run(c1,sub.Mathematics,teacher,'Practice: algebraic expressions','Solve the practice questions and explain your working in your own words.',datePlus(3));
  addAssignment.run(c1,sub['Basic Science'],teacher,'The living world','Describe the characteristics of living things with two examples.',datePlus(5));
  const oldAssignment = addAssignment.run(c1,sub['English Language'],teacher2,'A story worth telling','Write a short story about a lesson you learned.',datePlus(1)).lastInsertRowid;
  db.prepare('INSERT INTO submissions(assignment_id,student_id,response) VALUES (?,?,?)').run(oldAssignment,student,'My sample response has been submitted.');
  const addExam = db.prepare('INSERT INTO examinations(class_id,subject_id,title,exam_date,start_time,venue) VALUES (?,?,?,?,?,?)');
  addExam.run(c1,sub.Mathematics,'Mathematics assessment',datePlus(14),'09:00','Room 202');
  addExam.run(c1,sub['Basic Science'],'Basic Science assessment',datePlus(18),'10:00','Science Lab');
  const result = db.prepare('INSERT INTO results(student_id,class_id,subject_id,term_id,ca_score,exam_score,status,submitted_by,published_at) VALUES (?,?,?,?,?,?,?,?,?)');
  result.run(student,c1,sub.Mathematics,t,35,51,'published',u.teacher,new Date().toISOString());
  result.run(student,c1,sub['English Language'],t,33,49,'published',u.teacher2,new Date().toISOString());
  result.run(student,c1,sub['Basic Science'],t,32,46,'published',u.teacher,new Date().toISOString());
  result.run(student2,c1,sub.Mathematics,t,30,45,'pending',u.teacher,null);
  const grade = db.prepare('INSERT INTO grading_bands(min_score,grade,remark) VALUES (?,?,?)');
  for (const band of [[70,'A','Excellent'],[60,'B','Very good'],[50,'C','Good'],[45,'D','Fair'],[0,'F','Needs improvement']]) grade.run(...band);
  const fee = db.prepare('INSERT INTO fees(student_id,term_id,title,amount_kobo,due_date) VALUES (?,?,?,?,?)').run(student,t,'Tuition & learning resources',12500000,datePlus(20)).lastInsertRowid;
  db.prepare('INSERT INTO payments(fee_id,amount_kobo,reference,recorded_by) VALUES (?,?,?,?)').run(fee,8500000,'UA-DEMO-0001',u.admin);
  db.prepare('INSERT INTO fees(student_id,term_id,title,amount_kobo,due_date) VALUES (?,?,?,?,?)').run(student2,t,'Tuition & learning resources',12500000,datePlus(20));
  const notify = db.prepare('INSERT INTO notifications(user_id,title,body,kind) VALUES (?,?,?,?)');
  notify.run(u.student,'A new assignment awaits','Practice: algebraic expressions is ready to view.','assignment');
  notify.run(u.student,'Your results are available','Your published results are ready in Grade Sheet.','result');
  notify.run(u.student,'Welcome to your portal','Everything you need for school, in one place.','info');
  notify.run(u.parent,'Your child’s results are available','View Amina’s published results in your portal.','result');
  notify.run(u.teacher,'A new term is underway','Your class workspace is ready.','info');
  notify.run(u.admin,'Welcome to the admin dashboard','Your sample workspace is ready to explore.','info');
  const ann = db.prepare('INSERT INTO announcements(title,body,audience,created_by) VALUES (?,?,?,?)');
  ann.run('Welcome to a new term','We are excited to learn, grow and make meaningful memories together this term. This is a sample announcement.','all',u.admin);
  ann.run('A little reminder for learners','Remember to check your assignments and upcoming activities in your portal.','all',u.admin);
  ann.run('Learning resources are now available','Visit the library section to explore the sample catalogue.','all',u.admin);
  const evt = db.prepare('INSERT INTO events(title,description,event_date,start_time,location,created_by) VALUES (?,?,?,?,?,?)');
  evt.run('Science & Innovation Day','A day of curiosity, creativity and discovery.',datePlus(7),'10:00','School Auditorium',u.admin);
  evt.run('Parent–Teacher Meeting','An opportunity for families and teachers to connect.',datePlus(15),'09:00','School Hall',u.admin);
  evt.run('Inter-house Sports Day','Cheer on our learners in a day of friendly competition.',datePlus(25),'08:30','School Grounds',u.admin);
  const addBook = db.prepare('INSERT INTO books(title,author,category,total_copies,available_copies) VALUES (?,?,?,?,?)');
  const b1 = addBook.run('The River Between','Ngũgĩ wa Thiong’o','Literature',4,3).lastInsertRowid;
  addBook.run('Things Fall Apart','Chinua Achebe','Literature',6,5);
  addBook.run('Essential Mathematics for JSS 2','A. J. S. Oluwasanmi','Mathematics',8,8);
  addBook.run('A Short History of Nearly Everything','Bill Bryson','Science',3,2);
  addBook.run('Computer Studies for Junior Schools','Sample author','Technology',5,5);
  db.prepare('INSERT INTO borrowings(student_id,book_id,borrowed_at,due_date) VALUES (?,?,?,?)').run(student,b1,datePlus(-5),datePlus(9));
  db.prepare('INSERT INTO messages(sender_id,recipient_id,body) VALUES (?,?,?)').run(u.admin,u.student,'Hello Amina! Welcome to your student portal. Let us know if you need any help.');
  db.prepare('INSERT INTO school_settings(key,value) VALUES (?,?)').run('school_name','USMANIYYA ACADEMY');
  db.prepare('INSERT INTO school_settings(key,value) VALUES (?,?)').run('currency','NGN');
  audit(u.admin,'Initialised demo workspace','system','Seeded sample data for demonstration');
});
// Demo credentials must never be silently seeded into a production deployment.
const allowDemo = process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEMO_DATA === 'true';
if (allowDemo) seed();
if (process.env.NODE_ENV === 'production' && !allowDemo && db.prepare("SELECT 1 FROM users WHERE email LIKE '%@demo.usmaniyya.school' LIMIT 1").get()) {
  throw new Error('Refusing to start production with demo accounts. Use a fresh database or explicitly set ALLOW_DEMO_DATA=true for an isolated demonstration only.');
}
