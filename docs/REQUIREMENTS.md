# Equipment Borrowing System — Requirements

## Purpose and scope

The Automated Equipment Borrowing System centralizes campus academic/laboratory equipment discovery, reservations, custody checkout and return, condition reporting, overdue handling, and circulation reports. It does not support commercial purchasing, vendor payments, or non-academic assets.

## Users and stakeholders

| Stakeholder | Interest / system role |
|---|---|
| Student borrowers | Search availability, reserve class/lab equipment, receive due reminders, view history |
| Faculty instructors | Borrow academic equipment for lectures, demonstrations, and exams |
| Equipment custodians / laboratory technicians | Operate inventory, scan checkout/return, inspect condition, handle incidents |
| System administrators / campus IT | Manage access, deployment, backups, uptime, and security |
| Department chairs / college deans | Review usage, overdue, and damage reports for planning and budgeting |
| Campus security officers | Inspect approved digital checkout details at exit points |
| Repair technicians / vendors | Receive maintenance details needed to repair equipment |

## Functional requirements

| ID | Requirement |
|---|---|
| FR-1 | Authenticate institutional users, verify email, hash passwords, support password reset, and enforce borrower, custodian, and administrator permissions. |
| FR-2 | Show searchable equipment with category, location, quantity, QR identity, and Available, Reserved, Checked Out, Under Maintenance, or Lost status. |
| FR-3 | Permit eligible borrowers to submit equipment requests with pickup, due time, and academic purpose; prevent schedule conflicts, account holds, and active-limit violations; require custodians or administrators to approve or decline requests before checkout. |
| FR-4 | Let custodians verify an approved reservation and asset QR, record the borrower, checkout time, processor, and due time, and provide a transaction receipt. |
| FR-5 | Record returned condition. Damaged/missing equipment requires incident notes and photo, creates an incident report, places a borrower hold, and moves equipment to maintenance. |
| FR-6 | Remind borrowers 24 hours and 2 hours before due and issue overdue alerts. The scheduler marks loans overdue after a 15-minute grace period and blocks further reservations. |
| FR-7 | Let administrators manage accounts and categories, and let authorized staff manage equipment and review/resolution of damage records. |
| FR-8 | Provide monthly usage, damage, overdue, and inventory reports in CSV and PDF formats. |
| FR-9 | Record key administrative and lending actions in an audit log. |

## Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | Search and common service-counter responses should complete within 2 seconds under the target campus load; verify with load testing before launch. |
| NFR-2 | Provide responsive layouts, semantic controls, visible validation, and keyboard support; conduct WCAG 2.1 AA testing before claiming compliance. |
| NFR-3 | Target 99% availability during campus operating hours, subject to deployment monitoring and recovery testing. |
| NFR-4 | Use HTTPS in deployment, password hashing, HttpOnly JWT cookies, role checks, parameterized queries, rate limiting, and restricted access to contact and incident data. |
| NFR-5 | Keep routes, database schema, and UI separated and document changes; introduce versioned migrations before production schema evolution. |
| INC-1 | Collect only the data required for lending (student ID where applicable, institutional email, and program). Do not collect gender, marital status, or honorific titles. |
| INC-2 | Define roles by system function and configure pickup/return availability to safe official operating hours. |
| INC-3 | Provide accessible pickup information and keyboard/screen-reader-compatible interactions. |

## Use cases

### Reserve equipment

- **Actor:** Student or faculty borrower.
- **Preconditions:** Authenticated, verified, no account hold/overdue loan, within active reservation limit.
- **Main flow:** Search catalogue → inspect availability → choose equipment → provide pickup/due times and academic purpose → system validates schedule and policy → system records a pending request and notifies borrower → custodian or administrator approves or declines the request → borrower receives the decision.
- **Alternates:** Reject unavailable/conflicting time slots, invalid input, over-limit requests, and accounts with outstanding holds; show actionable errors.
- **Postcondition:** Pending request appears in borrower and staff reservation history and reduces availability for the requested time window; only an approved request may be checked out.

### Process checkout

- **Actor:** Custodian.
- **Preconditions:** Custodian is authenticated; approved reservation and equipment are available.
- **Main flow:** Scan equipment QR → provide/confirm reservation code and borrower → system validates reservation and holds → create loan with checkout time/processor/due date → mark equipment checked out → send confirmation/receipt.
- **Alternates:** Reject invalid QR, wrong reservation/item pairing, unavailable equipment, or borrower with an overdue item.

### Process return

- **Actor:** Custodian.
- **Preconditions:** Active loan exists for the scanned equipment QR.
- **Main flow:** Scan item → inspect equipment → record condition → system records return and updates reservation/loan/inventory → send confirmation.
- **Damage alternate:** Require notes and photo, create incident report, place borrower hold, mark equipment under maintenance, and notify the borrower.

## Privacy and implementation notes

Gender, marital status, and honorific titles are intentionally excluded. SMS, campus directory SSO, vendor payment, and GPS tracking are outside the initial implementation scope. Security, performance, accessibility, and uptime targets require deployment-level verification and are not asserted solely by source code.
