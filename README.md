# Automated Equipment Borrowing System (EBS)

A campus web application for discovering academic equipment, requesting reservations, processing QR-assisted checkouts and returns, recording damage incidents, and exporting operational reports.

> **Project status:** This repository contains an implementation baseline for the listed workflows, not a production deployment certification. Configure institutional identity/email, TLS, backups, and production file/database hosting before handling real campus accounts or records.

## Features

- React, Vite, Tailwind CSS, React Router, and Axios client.
- Express REST API backed by MySQL with role-based permissions.
- Student and faculty registration, email verification, password reset, secure `HttpOnly` JWT cookie, and logout.
- Role-specific student, faculty, custodian, and administrator access.
- Borrower full names, manual administrator approval as an alternative to email verification, and an in-app notification center.
- Inventory search/filter, categories, image upload, QR generation, and archive behavior.
- Reservation requests with manual custodian/administrator approval or decline, borrower notifications, cancellation/history, account holds, active reservation limit, and schedule conflict checks.
- QR assisted checkout/return, return condition and damage incident recording, photo attachment, and downloadable digital checkout receipts.
- Scheduled overdue processing and email reminders when SMTP is configured.
- Staff dashboard summaries and inventory, usage, overdue, and damage CSV/PDF exports.
- Audit events for key account, inventory, reservation, checkout, return, and damage actions.

## Requirements

- Node.js 20 or newer and npm.
- MySQL 8.0.16 or newer (used for enforced check constraints and JSON).
- A mail server account for verification, reset, and notification email. SMTP is optional for local UI development but required to deliver messages.
- A modern browser. Custodian QR camera scanning requires HTTPS outside localhost and camera permission.

## Setup

1. Install root and client dependencies:

   ```sh
   npm install
   npm install --prefix client
   ```

2. Create a MySQL database and application user with least-privilege access. Run the schema:

   ```sh
   mysql -u root -p < database/schema.sql
   ```

   In PowerShell, use `Get-Content .\database\schema.sql | mysql -u root -p` if input redirection is unavailable.

3. Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell) and set database, institutional email domain, and SMTP settings. Never commit `.env`.
   For local development, run `npm run setup:jwt` once to create a strong random JWT secret in `.env` without displaying it. For production, set a managed high-entropy `JWT_SECRET` yourself.

4. Set `EBS_ADMIN_EMAIL` and a unique `EBS_ADMIN_PASSWORD` (at least 16 characters) in `.env`, then create the initial administrator, sample categories, and demo inventory:

   ```sh
   npm run seed
   ```

   Seeding does not create a default password or reset an existing administrator. It adds eight idempotent demo equipment records identified by `DEMO-*` asset codes; confirm actual quantities and availability with your campus before lending them.

5. Start both processes in separate terminals:

   ```sh
   npm run dev
   npm run dev:client
   ```

6. Open `http://localhost:5173`. The API listens on port 3000; Vite proxies `/api` and `/health`.

Production builds:

```sh
npm run build
```

Set `NODE_ENV=production`, configure `CLIENT_ORIGIN` and `APP_BASE_URL` to the deployed HTTPS origin, and serve the built `client/dist` through the Express process or a same-origin reverse proxy.

## Configuration

See `.env.example`. Important settings:

| Variable | Purpose |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL connection |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Signed access token configuration; use a high-entropy secret |
| `INSTITUTIONAL_EMAIL_DOMAIN` | Domain required for self-registered borrower accounts (default: `my.cspc.edu.ph`) |
| `MAX_ACTIVE_RESERVATIONS` | Per-borrower active reservation cap |
| `CAMPUS_TIMEZONE` | IANA campus timezone used for allowed service hours |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | Outbound email |
| `CLIENT_ORIGIN` | Comma-separated allowed browser origins |
| `APP_BASE_URL` | Public UI origin used in verification/reset links |
| `EBS_ADMIN_EMAIL`, `EBS_ADMIN_PASSWORD` | Initial admin seed credentials; never publish them |

Run `npm run setup:jwt` only for local development. It updates only a missing, placeholder, or too-short `JWT_SECRET` in `.env`, preserves valid secrets, and refuses to generate a secret when production is configured.

For an existing database, apply each migration in `database/migrations` once before restarting the updated application. This includes `003-manual-reservation-approval.sql`, which makes `pending` the default for new reservation records. Run each migration against the database configured by `DB_NAME` in `.env` (for example, in PowerShell: `Get-Content .\database\migrations\003-manual-reservation-approval.sql | mysql -u root -p ebs_db`, replacing `ebs_db` with your database name), or paste the SQL into that database's SQL page in phpMyAdmin. If a migration reports that a column already exists, that particular schema change has already been applied; do not rerun it. New databases use `database/schema.sql`. Existing borrower names can be filled in through phpMyAdmin; newly registered and admin-invited borrowers provide their full name.

### Reservation approval workflow

Borrowers submit requests from the equipment catalogue; submission does not guarantee the reservation. The request appears as **Awaiting staff approval**. A custodian or administrator reviews it from the Reservations page and can approve it or decline it with a reason. The borrower sees the outcome in Notifications, and email is sent when SMTP is configured. Approval reserves the item but does not mean the borrower has collected it. After physically handing the approved item to the borrower, staff scan the equipment QR and reservation code in **Checkout & return** and confirm the pickup; both the borrower and the staff member who records it receive an in-app notification, and the borrower receives an email when SMTP is configured. When the borrower physically returns the item, staff inspect it and confirm the return on the same page. The borrower and processing staff member receive in-app notifications of the recorded return. Pending requests count against availability while awaiting review.

## Test accounts

No shared/default test passwords are committed. Create the initial administrator through the seed command. Self-registration creates a student or faculty borrower account for the configured institutional email domain. Students provide a student ID and program; faculty/instructors provide their name and institutional email. The borrower can use the one-time email link or an administrator can explicitly approve a student/faculty account from Administration. In development without SMTP, verification links are shown in the UI. For custodian accounts, an administrator creates the account and receives a one-time temporary password to share privately; the custodian must set a personal password at first sign-in. Seeded `DEMO-*` inventory is sample data and must be checked against real campus stock.

## API

All JSON APIs are under `/api`. Authentication is an `HttpOnly`, `SameSite=Strict` JWT cookie. Protected requests must be made from the configured allowed origin. See [API reference](./docs/API.md) for endpoints, roles, and payloads.

## Database and project structure

```text
app.js                 Express API and production SPA hosting
config/db.js           MySQL connection pool
database/schema.sql    MySQL schema, constraints, indexes, role seeds
server/middleware/     Authentication and error handling
server/routes/api.js   REST endpoints and validation
server/services/       Email, audit logging, overdue/reminder scheduler
server/scripts/seed.js Initial administrator and categories
client/src/            React UI, API client, role-aware pages
docs/                  API and requirements documentation
```

## Known limitations and production hardening

- Equipment images and incident photos are stored in MySQL BLOB columns. For larger deployments, use private object storage with malware scanning and short-lived authorized downloads.
- The included mail reminder scheduler runs inside the web process. Run a single dedicated worker or use a managed queue/scheduler in a multi-instance deployment.
- This project does not include institutional SSO/directory integration, SMS, barcode-device integration, or a transactional outbox.
- Dashboard charts are lightweight CSS summaries; add a charting library if richer filtering or interactive analytics are required.
- Configure HTTPS, backups/restore tests, monitoring, log retention, account recovery procedures, data retention, privacy notices, deployment secrets, and concurrency/load tests before production use.
- Reservation conflict checks are database-transaction protected per equipment record; test the quantity/unit model and multi-instance concurrency against the campus inventory policy before launch.
- Database migrations are not yet automated; the checked-in schema is the initial-install script.

## AI assistance disclosure

AI assistance was used to scaffold and implement portions of the application and documentation. The student team is responsible for reviewing, understanding, testing, adapting, and defending every submitted change.

## Team

Automated Equipment Borrowing System (EBS) — Camarines Sur Polytechnic Colleges, College of Computer Studies, BSIT.

Team members: Hazel Berina; Angel Nicole Pandes; Junel O. Trajada.

## License

See [LICENSE](./LICENSE).


Testing pull request.


