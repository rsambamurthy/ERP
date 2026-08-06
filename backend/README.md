# ERP backend

Node.js + Express + Prisma, implementing the six onboarding endpoints from
section 7 of the design spec, plus `POST /branches`.

## Local development

```bash
npm install
cp .env.example .env      # set DATABASE_URL to your Postgres instance
psql "$DATABASE_URL" -f ../db/registration_schema_v2.sql
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
| `POST /auth/register` | Creates `organizations` + `users` + `org_users` (OWNER) + `onboarding_state`. Logs the OTP to the console — no SMS/email provider wired up yet. |
| `POST /auth/verify-otp` | Checks the OTP, advances org to `PENDING_DOMAIN`. |
| `GET /domain-types` | Reads from the `domain_types` seed. |
| `POST /onboarding/domain` | Upserts `org_domains` (one or more). Rejects with 409 once `domain_locked_at` is set. |
| `POST /onboarding/provision` | Seeds `accounts` from core + selected domains' `coa_templates`, enables modules, creates the head-office `branches` row. |
| `GET /onboarding/status` | Returns `onboarding_state.step`. |
| `POST /branches` | Not domain-locked — add a location any time. |

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
4. Once deployed, run the schema and seed against the Railway Postgres
   instance (from your machine, using the same `DATABASE_URL`):
   ```bash
   psql "$DATABASE_URL" -f ../db/registration_schema_v2.sql
   npx prisma db seed
   ```
5. Copy the service's public URL into the frontend's `NEXT_PUBLIC_API_URL`
   on Vercel.

## Known gaps (MVP)

- OTP delivery is a console log, not real SMS/email.
- No auth/session tokens yet — `organizationId`/`userId` are passed around
  directly, fine for wiring up the wizard, not for production.
- `coa_templates`' unique constraint doesn't dedupe core rows (NULL
  `domain_type_id`) against each other — noted in the design spec; the seed
  script works around it by checking before inserting rather than relying on
  the DB constraint.
