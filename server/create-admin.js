// Bootstrap one administrator into a fresh production database.
// Supply credentials through a secret manager/environment, not committed source files.
import { db, passwordHash, audit } from './db.js';
const name=(process.env.BOOTSTRAP_ADMIN_NAME||'').trim();
const email=(process.env.BOOTSTRAP_ADMIN_EMAIL||'').trim().toLowerCase();
const password=process.env.BOOTSTRAP_ADMIN_PASSWORD||'';
if (db.prepare("SELECT 1 FROM users WHERE role='admin' LIMIT 1").get()) throw new Error('An administrator already exists; bootstrap is disabled.');
if (name.length<2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length<12 || password.length>128) throw new Error('Provide BOOTSTRAP_ADMIN_NAME, a valid BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD (12–128 characters).');
db.transaction(()=>{const id=db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?,'admin')").run(name,email,passwordHash(password)).lastInsertRowid;db.prepare("INSERT INTO staff(user_id,position,department) VALUES (?,'School Administrator','Administration')").run(id);audit(id,'Bootstrapped administrator','system');})();
console.log('Administrator created. Remove the bootstrap secrets from the environment.');
