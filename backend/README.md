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
psql "$DATABASE_URL" -f ../db/migration_003_users_admin.sql
psql "$DATABASE_URL" -f ../db/migration_004_module_subscriptions.sql
psql "$DATABASE_URL" -f ../db/migration_005_menu_config.sql
psql "$DATABASE_URL" -f ../db/migration_006_sales_purchase_inventory.sql
psql "$DATABASE_URL" -f ../db/migration_007_user_name_and_bp_code.sql
psql "$DATABASE_URL" -f ../db/migration_008_sales_purchase_returns.sql
psql "$DATABASE_URL" -f ../db/migration_009_custom_roles.sql
npx prisma generate
npx prisma db seed         # seeds domain_types, modules, coa_templates
npm run create-admin -- --email you@example.com --password "something long"   # makes yourself a platform admin
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
| `GET /journal/pnl?from=&to=` | Income vs expense for a period. |
| `GET /journal/balance-sheet?asOf=` | Assets vs liabilities+equity as of a date, with current earnings folded into equity. |
| `GET /journal/cash-book?from=&to=` | Combined Cash+Bank running balance. |
| `GET /journal/receipts-payments?from=&to=` | Same Cash+Bank movement, split by direction. |
| `GET /journal/day-book?from=&to=` | Every posted voucher, chronological. |

### Sales / Purchase / Inventory (`/items`, `/sales-invoices`, `/purchase-bills`, `/stock-adjustments`, `/inventory/*`)

v1: direct invoicing only (no Sales/Purchase Order stage — see ROADMAP.md), Purchase Bill and Sales Invoice and Stock Adjustment each create-and-post atomically, same UX as `/journal`. Every org picks a stock costing method exactly once (`GET/POST /items/costing-method`) before any item can be created — `WEIGHTED_AVG` or `FIFO`, enforced immutable at the route level. Costing math lives in `lib/costing.ts` (`receiveStock`/`consumeStock`), shared by all three document routes.

| Endpoint | Notes |
|---|---|
| `GET/POST /items/costing-method` | Read, or set-once, the org's stock valuation method. |
| `GET /items/stock-accounts` | The org's item control accounts (Inventory / Raw Materials / Finished Goods), for the item-create form. |
| `GET/POST /items`, `PATCH /items/:id`, `DELETE /items/:id` | Item master. Create also creates the paired `bpType = ITEM` Business Partner (never exposed separately) and, if `openingQuantity` is set, the opening stock movement. Delete only if it's never had a stock movement. |
| `GET/POST /purchase-bills`, `GET /purchase-bills/:id` | Stock inward. Posts: Dr each line's item stock account (tagged that item's BP) + Dr GST Input, Cr Trade Payables (tagged the vendor). |
| `GET/POST /sales-invoices`, `GET /sales-invoices/:id` | Stock outward — rejected if a branch's on-hand can't cover a line. Posts: Dr Trade Receivables (tagged the customer), Cr Sales Revenue + Cr GST Output, Dr Cost of Goods Sold, Cr each line's item stock account (tagged that item's BP). |
| `GET/POST /stock-adjustments` | Both directions in one document — IN (found stock/opening, needs an explicit `unitCost`) and OUT (write-off/shrinkage, costed automatically). Posts to Inventory Adjustments either direction. |
| `GET /inventory/stock-ledger?itemId=&branchId=&from=&to=` | Running quantity balance for one item — the Stock Movement equivalent of `/journal/ledger`. |
| `GET /inventory/valuation?branchId=` | Every item currently on hand and its value — reads `ItemStock.averageCost` for weighted-avg orgs, sums remaining `StockLot`s for FIFO orgs. |

### Bulk upload (`/accounts`, `/items`, `/business-partners` — `/bulk-upload/*`)

Same three-step flow on all three, ported from SmartAppt Gold's vendor/bank upload pattern (`lib/xlsxTemplate.ts` + `lib/upload.ts` are the shared pieces): `GET .../bulk-upload/template` downloads a styled `.xlsx` (header row, inline hints, dropdown validation on enum columns); `POST .../bulk-upload/preview` (multipart, field name `file`) parses it server-side and returns every row tagged `create` / `update` / `error` — nothing is written yet; `POST .../bulk-upload/apply` takes back only the rows the user confirmed (body `{ rows: [...] }`) and commits them. Matching an uploaded row to an existing record: Chart of Accounts by Account Code, Items by SKU, Business Partners by the optional `code` field (blank code always creates new — see `migration_007`). Requires `db/migration_007_user_name_and_bp_code.sql`.

### Sales / Purchase Returns (`/sales-returns`, `/purchase-returns`)

Always tied to an existing Sales Invoice / Purchase Bill — `GET .../invoice/:id/lines` (sales) or `GET .../bill/:id/lines` (purchase) returns each original line annotated with `alreadyReturned`/`remaining`, so the create form can cap quantities client-side (the server re-validates the cap regardless). `POST /sales-returns` line input is `{ salesInvoiceLineId, quantity, condition }` where condition is `GOOD` (re-enters sellable stock at the original line's cost, reverses Sales Revenue/GST Output/COGS/Trade Receivables normally) or `DAMAGED` (same revenue/GST/receivable reversal, but the cost writes off to Inventory Adjustments (4002) instead of back to stock, with no stock movement at all). `POST /purchase-returns` line input is `{ purchaseBillLineId, quantity }` — no condition; stock leaves via `returnStockToVendor()` (`lib/costing.ts`) at the original bill line's rate, preferring to deplete that exact bill's own stock lot before falling back to oldest-first FIFO. Voucher types `SR`/`PR`, movement types `SALES_RETURN_IN`/`PURCHASE_RETURN_OUT`. Requires `db/migration_008_sales_purchase_returns.sql`.

### Team / user management (`/org/users/*`, OWNER/ADMIN only)

| Endpoint | Notes |
|---|---|
| `GET /org/users` | Current members + pending invites. |
| `POST /org/users/invite` | `{ email\|phone, role, customRoleId? }` → creates an invite, returns `devInviteToken` (until a real email/SMS provider exists) to build the accept-invite link from. `role` is one of `ADMIN\|ACCOUNTANT\|VIEWER\|CUSTOM`; `CUSTOM` requires `customRoleId`. |
| `DELETE /org/users/invites/:id` | Cancel a pending invite. |
| `PATCH /org/users/:userId/role` | Change a teammate's role (`{ role, customRoleId? }`, same shape as invite). Can't touch the OWNER. |
| `DELETE /org/users/:userId` | Revoke access. Can't remove the OWNER or yourself. |
| `POST /auth/accept-invite` | `{ token, password }` → creates the login, joins the org, returns a session token + resolved `permissions`. |

Roles: **OWNER** (one per org, set at registration, full access) · **ADMIN** (same minus touching the OWNER) · **ACCOUNTANT** (post transactions, manage business partners) · **VIEWER** (read-only) · **CUSTOM** (org-defined, see below). Module-level write access is enforced server-side via `requirePermission()` in `middleware/auth.ts` — not just hidden UI. Team/role management and Access Control config stay on `requireRole("OWNER", "ADMIN")` specifically, never `requirePermission()` — see Custom Roles below for why.

### Custom Roles (`/org-roles`, OWNER/ADMIN only)

An org can define its own named roles on top of the four fixed ones, each a
subset of a fixed seven-permission catalogue (`lib/permissions.ts`):
`coa.manage`, `items.manage`, `businessPartners.manage`, `sales.post`,
`purchase.post`, `inventory.post`, `journal.post`. A member/invite holding a
custom role has `role = "CUSTOM"` plus `customRoleId` pointing at the role
row (`org_users`/`org_invites`, `migration_009_custom_roles.sql`).

Deliberately **not** in that catalogue: managing team members/roles and
configuring menu visibility. Either one, made grantable, would let a custom
role holder define a more powerful role (or edit their own role's
permissions) and assign it to themselves — defining/editing/deleting roles
and assigning them to people both stay hardcoded `requireRole("OWNER",
"ADMIN")`, never `requirePermission()`.

| Endpoint | Notes |
|---|---|
| `GET /org-roles` | This org's custom roles, plus the permission catalogue. |
| `POST /org-roles` | `{ name, permissions: [...] }` — name can't reuse a built-in role name. |
| `PATCH /org-roles/:id` | Rename and/or change permissions — takes effect on the holder's next request (permissions aren't cached in the JWT, just resolved per-request in `requirePermission()`). |
| `DELETE /org-roles/:id` | Refuses (409) if any member or pending invite still holds the role. |

`OWNER`/`ADMIN`/`ACCOUNTANT` keep their exact pre-existing permission sets
(re-expressed as fixed entries in `builtInPermissions()`, not stored in the
DB) — this was a re-expression of `requireRole()`'s old behavior across
every route, not a behavior change.

### Access control (`/access-control/*`) — which sidebar items a role sees

Ported from SmartAppt's web-menu-by-role screen (`menu-scope.ts`,
`system.routes.ts` `/menu-config`, `WebMenuPage.tsx`). This is a *visibility*
layer on top of the roles above, not a replacement for them — the actual
write permission on every mutation is still whatever `requireRole()` says on
that route regardless of what the sidebar shows. Item catalogue and default
per-role visibility live in `frontend/components/layout/navGroups.ts`
(`NavItem.roles`); only departures from that default are stored, in
`org_menu_config`.

| Endpoint | Notes |
|---|---|
| `GET /access-control/menu` | Any org member — full override map for their own org, all roles. AppShell filters the sidebar for the caller's own role from this. |
| `GET /access-control/menu/:organizationId` | OWNER/ADMIN (own org — the URL id is a hint, not an authority) or platform admin (any org). Returns the matrix plus `editableRoles`. |
| `PUT /access-control/menu/:organizationId` | `{ items: [{ itemId, role, enabled }] }` — replaces the caller's editable roles' overrides. |

**Who can edit which role's menu:** OWNER/ADMIN can configure every role
except OWNER (never restrictable) and except their own role (self-lock
protection — an ADMIN hiding a screen from ADMIN would lock themselves out
with no way back short of a platform admin). A platform admin can configure
all four org roles. See `editableRolesFor()` in `middleware/auth.ts`.

### Platform admin (`/admin/*`, platform-admin accounts only)

Not a member of any org — created via `npm run create-admin`, never through
the public signup. Logs in through the same `/auth/login`. Ported from
SmartAppt's `SUPER_USER` pattern (`middleware/rbac.ts`,
`entitlement.service.ts`, `associations.routes.ts`,
`subscriptions.routes.ts`): a platform admin isn't limited to a separate
read-only monitoring view — `isPlatformAdmin` bypasses every `requireRole()`
check and every subscription gate everywhere in the app
(`middleware/auth.ts`), and can act on any org's data directly.

| Endpoint | Notes |
|---|---|
| `GET /admin/organizations?q=` | Every org: domains, branch/user/module counts, status, subscription. |
| `GET /admin/organizations/:id` | Full detail — team, branches, domains, module standing — for the drill-in screen. |
| `PATCH /admin/organizations/:id` | `{ name }` — rename an org. |
| `PATCH /admin/organizations/:id/subscription` | `{ status: "ACTIVE" \| "SUSPENDED" }` — the org-wide kill switch; a suspended org's accounting endpoints (`/accounts`, `/business-partners`, `/journal/*`) start returning 402 for its own users until reactivated. Platform admins are always exempt. |
| `DELETE /admin/organizations/:id` | Permanently deletes the org and everything in it. Guarded like SmartAppt's `hardDelete`: must already be `SUSPENDED`, and must have zero posted journal entries. |
| `GET /admin/subscriptions?q=&filter=` | Per-module subscription console — one row per org, one column per module. `filter` is `ALL \| EXPIRING \| LAPSED \| TRIAL \| UNSUBSCRIBED`. |
| `POST /admin/subscriptions/:organizationId/:moduleCode` | Grant or renew one module for one org — `{ status, expiresOn, startsOn?, amount?, reference?, note? }`. `expiresOn: null` means perpetual; it must be passed explicitly. |
| `DELETE /admin/subscriptions/:organizationId/:moduleCode` | Cancel a module (soft — sets `CANCELLED`, keeps the billing record). |
| `GET /admin/audit-logs?organizationId=` | Platform-wide (or one org's) activity log — every account/business-partner/journal/user-management/module mutation writes here via `lib/audit.ts`. |

**Operating inside a specific org.** The ordinary `/accounts`,
`/business-partners`, `/journal/*`, and `/org/users/*` endpoints all resolve
their target org via `resolveOrgId()` (`middleware/auth.ts`): for a normal
user that's their own `organizationId` from the JWT; for a platform admin
it's whichever org they pass explicitly via `?organizationId=` (GET/DELETE)
or `organizationId` in the body (POST/PATCH) — the same shape as SmartAppt
passing `?association_id=` into a manager's own endpoints rather than
maintaining a separate parallel "admin view" of the data.

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
   psql "$DATABASE_URL" -f ../db/migration_003_users_admin.sql
   psql "$DATABASE_URL" -f ../db/migration_004_module_subscriptions.sql
   psql "$DATABASE_URL" -f ../db/migration_005_menu_config.sql
   psql "$DATABASE_URL" -f ../db/migration_006_sales_purchase_inventory.sql
psql "$DATABASE_URL" -f ../db/migration_007_user_name_and_bp_code.sql
psql "$DATABASE_URL" -f ../db/migration_008_sales_purchase_returns.sql
   npx prisma db seed
   npm run create-admin -- --email you@example.com --password "something long"
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
