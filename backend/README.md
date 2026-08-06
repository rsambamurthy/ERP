# ERP backend

Node.js + Express + Prisma: the onboarding endpoints from section 7 of the
design spec, plus the accounting core (Chart of Accounts, Business Partners,
Journal Entries, Ledger, Trial Balance) ported from SmartAppt's Financial
Accounting module.

## Local development

```bash
npm install
cp .env.example .env      # set DATABASE_URL to your Postgres instance, and JWT_SECRET
psql "$DATABASE_URL" -f ../db/registration_schema_v2.sql
psql "$DATABASE_URL" -f ../db/migration_002_accounting.sql
npx prisma generate
npx prisma db seed         # seeds domain_types, modules, coa_templates
npm run dev
```

Runs at http://localhost:4000. `GET /health` for a quick check.

Note: `registration_schema_v2.sql`, not `prisma migrate`, is the source of
truth for the actual DDL — it has the `trg_lock_org_domains` trigger and
CHECK constraints Prisma's schema language can't express. `prisma/schema.prisma`
mirrors it for the typed client; `prisma generate` only reads that file, it
doesn't need a DB connection.

## Endpoints

| Endpoint | Notes |
|---|---|
| `POST /auth/register` | Creates `organizations` + `users` + `org_users` (OWNER) + `onboarding_state`. Returns `devOtp` in the response (until a real SMS/email provider is wired up — set `EXPOSE_DEV_OTP=false` to turn that off). |
| `POST /auth/verify-otp` | Checks the OTP, advances org to `PENDING_DOMAIN`, and returns a JWT (`token`) — the wizard and every screen after it use this. |
| `POST /auth/login` | Returning users: email/phone + password → JWT. |
| `GET /domain-types` | Reads from the `domain_types` seed. |
| `POST /onboarding/domain` | Upserts `org_domains` (one or more). Rejects with 409 once `domain_locked_at` is set. |
| `POST /onboarding/provision` | Seeds `accounts` from core + selected domains' `coa_templates` (flagged `is_system`), enables modules, creates the head-office `branches` row. |
| `GET /onboarding/status` | Returns `onboarding_state.step`. |
| `POST /branches` | Not domain-locked — add a location any time. |

All routes below require `Authorization: Bearer <token>` from login/verify-otp.

| Endpoint | Notes |
|---|---|
| `GET/POST /accounts`, `PATCH /accounts/:id`, `PATCH /accounts/:id/toggle`, `DELETE /accounts/:id` | Chart of Accounts. System (templated) accounts keep code/type/hierarchy fixed; everything else is editable. |
| `GET/POST /business-partners`, `PATCH /business-partners/:id`, `PATCH /business-partners/:id/toggle`, `DELETE /business-partners/:id` | Customer/vendor master — the sub-ledger behind control accounts. `?bpType=CUSTOMER\|VENDOR` filters the list. |
| `GET/POST /journal` | List (most recent 200) / post a balanced double-entry voucher. Control-account lines require a `businessPartnerId`. Posting locks the org's domain selection (DB trigger). |
| `GET /journal/ledger?accountId=&businessPartnerId=&from=&to=` | Running balance for one account, or one partner's cut of a control account. |
| `GET /journal/trial-balance?asOf=&branchId=` | Net debit/credit per account as of a date. |

`domain_locked_at` itself is set by the database trigger the moment a
`journal_entries` row is inserted, not by any of these endpoints — none of
this code writes to `journal_entries` yet, so domains stay editable until
real transactional endpoints are built later.

## Deploying to Railway

1. In the Railway project already connected to the `ERP` GitHub repo, open
   that service's Settings and set **Root Directory** to `backend`.
2. Add the `DATABASE_URL` env var pointing at the Postgres service in the
   same project (Railway's variable reference syntax, e.g.
   `${{Postgres.DATABASE_URL}}`, works if both services are in one project).
3. Push — Railpack will detect `package.json`, run `npm install`
   (triggering `postinstall: prisma generate`), then `npm run build` and
   `npm start`.
4. Add a `JWT_SECRET` env var (any long random string) — required for
   `/auth/login` and every accounting endpoint.
5. Once deployed, run the schema, migration, and seed against the Railway
   Postgres instance (from your machine, using the same `DATABASE_URL`):
   ```bash
   psql "$DATABASE_URL" -f ../db/registration_schema_v2.sql
   psql "$DATABASE_URL" -f ../db/migration_002_accounting.sql
   npx prisma db seed
   ```
6. Copy the service's public URL into the frontend's `NEXT_PUBLIC_API_URL`
   on Vercel.

## Known gaps (MVP)

- OTP delivery surfaces in the API response (`devOtp`), not real SMS/email.
- JWT auth is a shared-secret HS256 token, 30-day expiry, no refresh/revoke
  flow — fine for MVP, not a production auth system.
- Journal entries don't carry a branch selector in the UI yet — they post
  against the caller's `branchId` (null for most OWNER accounts today), so
  multi-branch orgs will want that added before it matters.
- `coa_templates`' unique constraint doesn't dedupe core rows (NULL
  `domain_type_id`) against each other — noted in the design spec; the seed
  script works around it by checking before inserting rather than relying on
  the DB constraint.
