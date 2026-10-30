# USMANIYYA ACADEMY — website and school portal

A responsive school website and database-backed demonstration of a four-role school management system. The public homepage, login, and mobile student dashboard were designed as the foundation; working teacher, parent and administrator workflows have also been added.

> **Important:** This is a demonstration, not a production-ready system. School facts, staff, learner records, announcements and events are sample content. The campus and student images are illustrative. Do not enter real personal, financial or sensitive information. The official logo is loaded from the exact URL supplied for this project, with a local copy of that same image as a fallback.

## Run locally

Requires Node.js 20.19+ (or 22.12+) and npm.

```sh
npm install
npm run dev
```

Open `http://localhost:3000`. The application seeds a local SQLite database (`usmaniyya.sqlite`) on first development startup. The database persists between restarts. To reset the demonstration, stop the server and delete `usmaniyya.sqlite`, `usmaniyya.sqlite-wal` and `usmaniyya.sqlite-shm`; a fresh sample database will be created at the next development start. This deletes all locally saved data.

The login page has one-click demo entry for each role. Alternatively, use the selected role’s credentials:

| Role | Email | Password |
| --- | --- | --- |
| Student | `student@demo.usmaniyya.school` | `DemoPass123!` |
| Parent | `parent@demo.usmaniyya.school` | `DemoPass123!` |
| Teacher | `teacher@demo.usmaniyya.school` | `DemoPass123!` |
| Administrator | `admin@demo.usmaniyya.school` | `DemoPass123!` |

These addresses are fictional demonstration accounts. All four passwords are intentionally public; they must never be used for a real deployment. An administrator can reset other accounts; doing so changes the demo credentials in that database.

## What works in this build

- **Public site:** responsive home, about, academics, admissions, sample staff directory, news/events and contact pages. Demo applications and enquiries are stored in SQLite. Applications can be tracked by reference and email, and their status updated by an administrator.
- **Authentication and access:** four role-specific dashboards; server-side role checks; students see their own records, parents see linked learners only, and teachers work within their allocated classes and subjects. Administrators can create students, teachers, administrative staff and parents, link additional learners to a parent, edit student and teacher details, and reset another account’s password.
- **Student and parent:** profile, attendance, weekly timetable, subjects, text assignment submissions, examination schedule, approved results, offline fee records, printable receipt and demo ID, library records, notices, events, academic calendar and authorised in-app messaging. The dashboard’s progress and attendance visualisations use stored records.
- **Teacher:** assigned class/student directory, attendance entry, assignment creation and text submission review, score entry for allocated subjects/classes, examination schedule and class performance summary. Submitted results are not visible to students or parents until approved.
- **Administrator:** overview and audit history, student/staff/parent management, classes, subjects and teaching allocations; creation and activation of academic sessions and terms; timetable and examination creation; result approval and configurable grade bands; fee charges and offline payment recording; announcements, events, library catalogue and borrowing/returns, application status and enquiries.
- **Communication:** in-app notifications with read/unread status and relationship-scoped in-app messaging. Selected assignment, attendance, examination, result, payment, event and message actions generate in-app notifications.
- **Printing:** grade sheets, attendance, receipts and demo ID cards use the browser print dialog, where “Save as PDF” is available. There is no server-generated PDF service.

## Known limitations / not yet connected

- All school contact details, address, social accounts, history, official mission/vision, staff photographs, programmes and facilities need confirmation. Google Maps is not connected without a verified address. The generated photographs are not official school images.
- Admissions and contact forms only save locally in this demo; no email is sent and no real admissions processing occurs. No SMS, push or email delivery is configured.
- There is no online payment gateway, transaction verification or bank integration. Payments are manually recorded offline; no actual money is collected.
- Assignment answers are text only. File uploads, document storage/management, downloadable library files and a dedicated librarian role are not implemented.
- Email-based self-service password recovery is not connected. A signed-in user can change their password; an administrator can reset another account.
- Termly published subject results are available, but annual report aggregation, class position/ranking, configurable assessment weightings, bulk result import, and formal report-card templates are not implemented. Grades are based on CA out of 40 plus examination out of 60.
- Class changes can be made per student; bulk promotion, bulk attendance, record deletion, full timetable editing, and comprehensive staff editing are not complete. Administrative staff currently receive the full administrator role rather than granular departmental permissions.
- Search covers portal navigation, student records and the library, not a full-text search of all school data. School settings are limited to academic sessions, terms and grading; a complete settings and document-management interface is not present.
- Illustrative attendance and performance figures are calculated from the records supplied in the demo database; they are not official school statistics.

## Architecture

- React + Vite frontend, React Router, Lucide icons and locally hosted typefaces.
- Express API and relational SQLite database through `better-sqlite3`. Tables cover users, role profiles and parent links, classes, subjects, allocations, sessions/terms, attendance, timetables, assignments/submissions, examinations/results, grading, fees/payments, notifications, announcements/events, books/borrowing, messages, applications/enquiries and audit logs. A documents table is reserved but no document upload UI is implemented.
- Database-backed opaque sessions store only a SHA-256 token hash. Passwords are stored using salted `scrypt`; cookies are HttpOnly and expire after eight hours. Production uses Secure, SameSite Strict cookies; HTTPS development previews use Secure, partitioned SameSite None cookies so the demo can work when embedded cross-site. State-changing requests require JSON and reject mismatched browser origins. Basic input validation, in-memory request throttling and audit entries are included.
- Access checks are enforced on the server, not only in the interface. Published-result checks and receipt ownership are also server-side.

These controls are a foundation, **not** a security certification. Before using real data, commission a security and privacy review; configure HTTPS and trusted reverse proxies; add robust CSRF and distributed abuse controls as appropriate; implement MFA, monitoring, reliable backups and restore testing, encryption and retention policies, proper secrets management, secure file handling, privacy/consent workflows, and a production database/deployment architecture. The current in-memory throttling and single-host SQLite setup are not suitable for a multi-instance deployment.

To avoid silently deploying public demo credentials, production mode refuses to start with the known demo accounts unless `ALLOW_DEMO_DATA=true` is explicitly set. The flag is for isolated demonstrations **only**. A fresh production-mode database can be bootstrapped with `npm run setup:admin` using `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL`, and `BOOTSTRAP_ADMIN_PASSWORD` from a secure environment, but this does not replace the hardening and integrations listed above.

## Tests

```sh
npm test            # isolated database/API tests, including RBAC and publication flow
npm run build       # production frontend build
npm run test:ui     # optional browser workflows; requires Playwright Chromium and OS dependencies
```

API tests use a temporary database. UI tests also run against an isolated temporary database and exercise admissions tracking, contact, assignments, parent results, teacher result submission, administrator approval, offline payments and event creation.

## Project layout

- `src/pages/` — public pages, login and role-specific portal views.
- `src/components/` — shared branding, navigation and reusable UI.
- `src/styles.css` — design system, responsive layouts and print styles.
- `server/db.js` — relational schema, password functions and demo seed.
- `server/index.js` — authentication, access control and API routes.
- `server/create-admin.js` — administrator bootstrap for a fresh production-mode database.
- `tests/` — isolated API and optional browser workflow tests.
- `public/` — official-logo fallback, illustrative photography and local fonts.
