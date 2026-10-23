# EBS API reference

Base path: `/api`. JSON request bodies use `Content-Type: application/json`, except equipment images (`multipart/form-data`, field `image`). Authentication uses the `ebs_token` HttpOnly cookie established by login; browsers send it automatically from the configured origin. The API uses Zod validation and parameterized MySQL queries.

## Roles

| Role | Permissions |
|---|---|
| `student` | Browse inventory, reserve/cancel own reservations, view own history |
| `faculty` | Borrower permissions |
| `custodian` | Browse inventory, process checkout/return, view reservations, reports |
| `administrator` | Custodian permissions, invite/disable accounts, update account names, manually approve borrower accounts, create categories, archive inventory, resolve damage reports |

## Authentication

| Method | Path | Access | Body / result |
|---|---|---|---|
| POST | `/auth/register` | Public | `{ role, fullName, studentId?, email, program?, password }`; creates an unverified student (requires studentId and program) or faculty borrower (studentId/program not required); role defaults to `student` |
| POST | `/auth/login` | Public, rate-limited | `{ email, password }`; sets the HttpOnly JWT cookie |
| POST | `/auth/logout` | Public | Clears the authentication cookie |
| GET | `/auth/me` | Authenticated | Current account and role |
| PATCH | `/auth/profile` | Authenticated | `{ fullName, studentId?, program? }`; updates own profile, never role or email |
| POST | `/auth/change-password` | Authenticated | `{ currentPassword, newPassword }`; changes own password at any time after required temporary-password setup |
| POST | `/auth/verify-email` | Public | `{ token }` |
| POST | `/auth/forgot-password` | Public, rate-limited | `{ email }`; always returns a non-enumerating response |
| POST | `/auth/reset-password` | Public | `{ token, password }` |
| POST | `/auth/change-temporary-password` | Authenticated temporary-password session | `{ currentPassword, newPassword }`; unlocks the account after the required first-sign-in change |

The administrator can invite user roles using `POST /users` (borrower invites include `fullName`). Custodian invitations return a one-time temporary password, mark the administrator-created account verified, and require a password change on first sign-in. Use `POST /auth/change-temporary-password` to change it; while the change is required, other authenticated operations are blocked. After setup, every role can change their own password at any time with `POST /auth/change-password`; the current password is required. Every role can update their own profile at `PATCH /auth/profile`, while email changes remain administrator-managed. The administrator can update a user's full name using `PATCH /users/:id/name` with `{ fullName }`, manually approve pending student/faculty borrowers using `POST /users/:id/approve-borrower`, resend an unverified user's password setup and verification links using `POST /users/:id/resend-invitation` (or generate a new temporary password for a custodian), resend verification using `POST /users/:id/resend-verification`, and deactivate/reactivate accounts using `PATCH /users/:id/status`. Passwords are stored as hashes and are never retrievable after issuance. Manual approval is an administrator attestation, not proof of mailbox ownership.

## Inventory

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/equipment?q=&category=&status=&page=&limit=` | Authenticated | Search/filter/paginate active items |
| POST | `/equipment` | Custodian, administrator | Create an item; returns generated QR value and image data URL |
| PUT | `/equipment/:id` | Custodian, administrator | Update provided inventory fields |
| DELETE | `/equipment/:id` | Administrator | Archives rather than physically deletes |
| POST | `/equipment/:id/image` | Custodian, administrator | Upload one JPEG/PNG/WebP image, max 5 MiB |
| GET | `/equipment/:id/qr` | Authenticated | QR value and data URL |
| GET | `/categories` | Authenticated | List categories |
| POST | `/categories` | Administrator | Create a category |

Create payload:

```json
{
  "assetCode": "AV-001",
  "name": "Portable projector",
  "description": "HDMI projector",
  "categoryId": 1,
  "serialNumber": "SERIAL-001",
  "quantity": 1,
  "location": "CCS Laboratory",
  "status": "Available"
}
```

## Reservations and loans

| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/reservations` | Student, faculty | Submit a reservation request using `{ equipmentId, pickupAt, dueAt, purpose }`; timestamps must be ISO 8601. New requests have `pending` status and require staff approval |
| GET | `/reservations` | Authenticated | Borrowers see their own history; custodians and administrators can see all or filter by `borrowerId` |
| POST | `/reservations/:id/approve` | Custodian, administrator | Approve a pending request when equipment capacity is available |
| POST | `/reservations/:id/reject` | Custodian, administrator | Decline a pending request using `{ reason }`; the reason is shared with the borrower |
| POST | `/reservations/:id/cancel` | Owner or staff | Cancel pending/approved reservation |
| POST | `/checkout` | Custodian, administrator | `{ qrCode, reservationCode }`; only an approved reservation can be checked out. Staff call this after the borrower physically collects the item; records the handover and notifies the borrower and processing staff member. Returns transaction ID, borrower, and due date |
| GET | `/receipts/:id/pdf` | Transaction borrower or staff | Download checkout receipt |
| POST | `/return` | Custodian, administrator | `{ qrCode, condition, notes?, photo? }`; staff call this only after physically receiving and inspecting an active loan. Records the return and notifies the borrower and processing staff member; non-good condition requires notes and a base64 data URL image (max 5 MiB) |
| GET | `/damage-reports/:id/photo` | Custodian, administrator | Download protected incident photo |
| GET | `/damage-reports?status=open` | Custodian, administrator | Review incident reports, optionally filtered by status |
| PUT | `/damage-reports/:id/resolve` | Administrator | Resolve report and clear holds when no other open issues/overdues remain |

## Dashboards and reports

| Method | Path | Access | Result |
|---|---|---|---|
| GET | `/reports/dashboard` | Custodian, administrator | Inventory/borrower/reservation/checkout/overdue/damage totals, monthly borrow count, popular items |
| GET | `/reports/:type/csv` | Custodian, administrator | CSV export; `type` is `usage`, `damage`, `overdue`, or `inventory` |
| GET | `/reports/:type/pdf` | Custodian, administrator | PDF export for the same report types |
| GET | `/notifications` | Authenticated | Current user’s reminder history |
| GET | `/health` | Public | API and MySQL health |

Error responses use `{ "error": "..." }`; validation responses also include a `details` array. Common status codes: 400 invalid input, 401 missing/invalid login, 403 role/account restriction, 404 missing route/resource, 409 conflict/duplicate, 429 rate limit, and 500 unexpected server error.
