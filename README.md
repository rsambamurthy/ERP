# ERP

Standalone MSME ERP. Reuses the design pattern of SmartAppt's Financial
Accounting core (journal entries, journal lines, business-partner sub-ledger)
as a new Postgres instance — not a shared database with SmartAppt.

## Scope

- **Launch domains:** Trading, Manufacturing. An org may hold both at once.
- **Out of scope:** Building Association stays a separate product on
  SmartAppt's existing unit-based schema.
- **Multi-branch:** orgs can have multiple branches; GST registration is
  state-wise in India, so GSTIN lives on the branch, not the org.
- **Domain lock:** an org's domain set (`org_domains`) is editable only
  until its first transaction — enforced by a Postgres trigger
  (`trg_lock_org_domains`) that stamps `organizations.domain_locked_at` the
  moment a `journal_entry` is posted.

## Repo layout

```
db/        registration_schema_v2.sql   -- Postgres DDL: domains, branches,
                                            accounts, business_partners,
                                            journal_entries/lines, items, BOM
docs/      Registration_Module_Spec_v2.docx  -- design spec: flow, schema
                                                 rationale, API endpoints,
                                                 open decisions
frontend/  Next.js registration wizard, deployed on Vercel — see
           frontend/README.md for setup and deploy steps
backend/   Node + Express + Prisma API implementing the onboarding
           endpoints, deployed on Railway — see backend/README.md
```

## Database

Postgres (matches SmartAppt's conventions — UUID PKs, snake_case,
`deleted_at` soft deletes). Provision a Postgres instance (Railway, Supabase,
or any standard Postgres host — the schema has no vendor-specific
extensions) and run:

```bash
psql "$DATABASE_URL" -f db/registration_schema_v2.sql
```

## Status

Registration/onboarding flow, schema, frontend wizard, and backend API are
drafted and reviewed. Open decisions are listed at the end of
`docs/Registration_Module_Spec_v2.docx`. Neither `frontend/` nor `backend/`
has been through a real `npm install`/build in the environment they were
written in (no package registry access there) — verify with a local install
or the first Vercel/Railway build before treating either as done.
