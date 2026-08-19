# Session Handover — 19 Aug 2026

Context for picking this up cold. `ROADMAP.md` remains the feature log; this
is the working state and the open defects.

## Where things live

- Code: `github.com/rsambamurthy/ERP`, branch `main`
- Backend: Railway project "Enterprise Resource Planning", service `ERP`,
  **Development** environment, root dir `/backend`. Note the `production`
  environment has no config for the ERP service — only Development is set up.
- Frontend: Vercel project `erp` → `erp.integratatech.ai`
- DB: Railway Postgres (`railway` database). Migrations are applied by hand:
  `psql "$DATABASE_URL" -f db/migration_0NN_*.sql`

## Fixed on 19 Aug

1. Bulk upload failed with "Unexpected server error" on 9,625 rows. Four
   separate causes stacked: express.json() at the default 100kb limit
   (payload was 2.5MB); `lib/email.ts` committed empty, breaking every
   build; `migration_028` never applied to the database; and Code/Address
   missing from the frontend `BusinessPartner` type so they never rendered.
2. Bulk apply was one awaited Prisma call per row — 9,625 sequential round
   trips, no transaction. Now resolved in memory and inserted with chunked
   `createMany` inside one transaction.
3. The error handler collapsed everything into a 500. Body-parser size and
   parse failures now return 413/400 with an actionable message.
4. Every lookup dropdown replaced with a searchable picker
   (`components/shared/SearchPicker.tsx` + six wrappers). Search boxes on
   the Business Partner, Item and Team lists.
5. `GET /business-partners/lookup` — narrow projection for the pickers.
   ~4MB per page load became ~500KB. It carries `stateCode` even though the
   picker never shows it: Sales Invoice and Purchase Bill derive CGST+SGST
   vs IGST from it. Do not drop that field.
6. Item CRUD (detail page, edit, toggle, delete), delete wired for
   Customer/Vendor, and contacts/addresses/bank accounts un-gated for
   customers.

## Known defects — not yet fixed

- **GSTR-1 reads the customer GSTIN live.** `lib/gstReports.ts` joins
  `inv.businessPartner.gstin` rather than a snapshot on the invoice, so
  editing a customer's GSTIN retroactively rewrites already-filed returns.
  Sales Invoice should snapshot `partner_gstin` and `place_of_supply` at
  posting time. **Highest priority — it is a filed-return correctness bug.**
- **A partner can hold only one GSTIN.** GSTIN is state-specific, so a
  multi-state customer is currently unmodellable except as separate partner
  records, which splits their ledger. Suggested fix: add `gstin`,
  `state_code`, `is_default` to `vendor_addresses` (an address with a GSTIN
  IS the registration point) rather than inventing a partner-branch entity.
- **Two address models, nothing bridging them.** Bulk upload writes
  `business_partners.address` (JSON); the detail UI reads/writes
  `vendor_addresses`. Neither sees the other.
- **Bulk upload "As On Date" is silently discarded.** The template collects
  it and the preview parses it, but `business_partners` has no
  `opening_balance_date` column (Account has one; partners do not). Either
  add the column or drop the template column.

## Missing master-data fields (customer/vendor)

No commercial terms exist at all: credit limit, payment terms/credit days,
default currency, price list, default sales/purchase account, lead time.
India statutory gaps: **PAN** (present on OrgUser and Company Master, absent
on partners — needed for TDS), GST registration type
(Regular/Composition/Unregistered/SEZ/Overseas), MSME/Udyam number, TDS
section, reverse-charge flag.

Credit limit + payment terms are the ones that unlock invoice-level aging,
which is the top open item in ROADMAP.md.

## Design decisions taken

- **Keep one `business_partners` table** for customers and vendors. 13
  models carry a `businessPartnerId` FK, and `JournalLine.business_partner_id`
  is the sub-ledger tag behind Trade Receivables/Payables. A split means two
  nullable FKs plus a check constraint, and branching in every report. There
  is also a third `bp_type` — `ITEM` — behind each stock item.
- **Address-level GST registration, not a partner-branch entity.** One level
  of nullable columns instead of a hierarchy with three child tables and
  "which level owns this contact?" ambiguity. Revisit only if per-branch
  credit limits or separate statements are needed.
- **Filtering is client-side** on partners/items/members: those list
  endpoints have no pagination, so the rows are already in memory.

## Environment notes

- PowerShell blocks `npx.ps1` under the default execution policy — use
  `npx.cmd`, and run it from `frontend/` where TypeScript is installed.
- Frontend `tsc --noEmit` should report zero errors. The backend reports
  ~283 without a generated Prisma client; that is expected noise, they
  disappear once `prisma generate` runs.
- `frontend/tsconfig.tsbuildinfo` is tracked and shouldn't be — it is a
  build cache that dirties the tree on every typecheck.
- Also still committed by accident: `rmtest_delete_me.txt` and three
  `commit_*.sh` scripts at the repo root.

## Before real users

`SMTP_USER`/`SMTP_PASS` are not set on Railway, so OTPs fall back to
`devOtp` in the API response, and `EXPOSE_DEV_OTP` still defaults to true.
Both need sorting before anyone outside the founding team registers.