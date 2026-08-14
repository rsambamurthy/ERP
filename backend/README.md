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
psql "$DATABASE_URL" -f ../db/migration_010_user_management.sql
psql "$DATABASE_URL" -f ../db/migration_011_custom_role_access_control.sql
psql "$DATABASE_URL" -f ../db/migration_012_employee_details.sql
psql "$DATABASE_URL" -f ../db/migration_013_branch_crud.sql
psql "$DATABASE_URL" -f ../db/migration_014_discount_gst.sql
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
| `POST /auth/login` | Returning users: email/phone + password → JWT. Rejects (403) a `SUSPENDED` member — see Team / user management below. |
| `POST /auth/forgot-password` | `{ email\|phone }` → generates a reset OTP if the account exists, returns the same generic message either way (no account enumeration). Returns `devOtp` until a real provider exists. |
| `POST /auth/reset-password` | `{ email\|phone, otp, newPassword }` → verifies the OTP and sets a new password. Logged-out flow — distinct from `POST /me/change-password` below. |
| `GET /auth/mpin/status?identifier=` | `{ hasMpin }` — lets the login screen jump straight to the M-PIN box for a returning user. |
| `POST /auth/mpin/request-otp` | `{ identifier }` → 404 if no account matches, else sends an OTP (reuses `reset_otp_code`/`reset_otp_expires_at` — same pair `/forgot-password` uses). Returns `devOtp` until a real provider exists. |
| `POST /auth/mpin/verify` | `{ identifier, mpin }` → JWT, same response shape as `/auth/login`. The normal returning-user login once an M-PIN is set. |
| `POST /auth/mpin/set` | `{ identifier, otp, mpin }` → verifies the OTP, hashes and stores the M-PIN (`users.mpin_hash`), logs straight in. Covers both first-time setup and "forgot M-PIN" — see `routes/auth.ts`'s note on why that's one endpoint instead of two. |
| `GET /domain-types` | Reads from the `domain_types` seed. |
| `POST /onboarding/domain` | Upserts `org_domains` (one or more). Rejects with 409 once `domain_locked_at` is set. |
| `POST /onboarding/provision` | Seeds `accounts` from core + selected domains' `coa_templates` (flagged `is_system`), enables modules, creates the head-office `branches` row. |
| `GET /onboarding/status` | Returns `onboarding_state.step`. |
All routes below require `Authorization: Bearer <token>` from login/verify-otp.

| Endpoint | Notes |
|---|---|
| `GET/POST /accounts`, `PATCH /accounts/:id`, `PATCH /accounts/:id/toggle`, `DELETE /accounts/:id` | Chart of Accounts. System (templated) accounts keep code/type/hierarchy fixed; everything else is editable. |
| `GET/POST /business-partners`, `PATCH /business-partners/:id`, `PATCH /business-partners/:id/toggle`, `DELETE /business-partners/:id` | Customer/vendor master — the sub-ledger behind control accounts. `?bpType=CUSTOMER\|VENDOR` filters the list. |
| `GET/POST /journal` | List (most recent 200) / post a balanced double-entry voucher. Control-account lines require a `businessPartnerId`. Posting locks the org's domain selection (DB trigger). A manual post gets a sequential `voucherNumber` (`JV-0001`/`BV-0001`/`CV-0001`, scoped per org per voucher type, no FY logic); auto-posted entries (Sales Invoice, Purchase Bill, Returns, Stock Adjustment) leave it null. |
| `GET /journal/:id` | Single entry with lines + the sibling document's number (`salesInvoice.invoiceNumber` etc.) for auto-posted entries. |
| `PATCH /journal/:id` | Edit a MANUAL entry in place (date/narration/lines) — 409s on anything auto-posted (`referenceType` set). `voucherType` is frozen once created. |
| `POST/GET/DELETE /journal/:id/attachment` | One supporting document per entry (any entry, manual or auto-posted), stored as `bytea` in Postgres — no cloud storage exists in this app, so this is a deliberate simplification, not best practice for high volume. 5MB cap via the existing upload middleware. |
| `GET /journal/ledger?accountId=&businessPartnerId=&from=&to=` | Running balance for one account, or one partner's cut of a control account. |
| `GET /journal/trial-balance?asOf=&branchId=` | Net debit/credit per account as of a date. |
| `GET /journal/pnl?from=&to=` | Income vs expense for a period. |
| `GET /journal/balance-sheet?asOf=` | Assets vs liabilities+equity as of a date, with current earnings folded into equity. |
| `GET /journal/schedule-iii-balance-sheet?asOf=&branchId=` | Same underlying figures, grouped into the Companies Act Schedule III hierarchy (Shareholders' Funds / Non-Current/Current Liabilities / Non-Current/Current Assets) via `Account.scheduleIiiHead` — see `lib/scheduleIII.ts`. Anything unclassified surfaces in its own bucket rather than being dropped. |
| `GET /journal/cash-book?from=&to=` | Combined Cash+Bank running balance. |
| `GET /journal/receipts-payments?from=&to=` | Same Cash+Bank movement, split by direction. |
| `GET /journal/day-book?from=&to=` | Every posted voucher, chronological. |

### GST Statutory Reports (`/gst`)

Built entirely from data the Discount + GST Split and Sales/Purchase Return
features already capture — no new migration. MSME-first-pass subset, not a
full compliance engine (see ROADMAP.md's "GST Statutory Reports" section for
exactly what's simplified — place of supply, B2C summarization, no cess/
reverse-charge, GSTR-3B's net-payable not modeling actual ITC set-off order).
Same read access as the other accounting reports (Trial Balance/P&L/Balance
Sheet) — no `requirePermission` gate.

| Route | Notes |
| --- | --- |
| `GET /gst/gstr1?from=&to=&branchId=` | Outward supplies for a period — B2B (invoice-wise), B2C (summarized by state+rate), Exports (Table 6A), HSN summary, and credit notes (Sales Returns). |
| `GET /gst/gstr1/export?from=&to=&branchId=` | Same data as an `.xlsx`, one sheet per table. |

Table 6A (`report.exports`) is a foreign-currency Sales Invoice's own table
— routed there instead of B2B/B2C regardless of whether the customer
happens to have a GSTIN on file, since an export is never a domestic
supply. One row per (invoice, tax rate) combination, same convention as
B2B. `exportType` is `"WPAY"` (with payment of IGST) or `"WOPAY"` (LUT/
Bond — zero-rated); an invoice somehow missing `exportType` is treated as
WOPAY. `shippingBillNumber`/`shippingBillDate`/`portCode` come through as
whatever's on the invoice at read time — often `null` until filled in via
`PATCH /sales-invoices/:id` (see the Shipping Bill / Bill of Entry section
above). `exportsTotal` is a separate subtotal from `totals` — the domestic
B2B+B2C taxable value/tax figures never include exports, matching how the
real return keeps Table 6A distinct from the main taxable-value summary.
Still included in the HSN summary, same as the real return does.

Known related gap, not fixed in this pass: GSTR-3B's outward-supplies
figure (3.1(a)) still lumps every Sales Invoice together, including
exports — the real return has a separate 3.1(b) row for zero-rated
supplies. `computeGstr3b` doesn't split that out yet.
| `GET /gst/gstr3b?from=&to=&branchId=` | Outward tax liability vs. ITC available (from Purchase Bills) vs. indicative net payable, both net of the period's Sales/Purchase Returns. |
| `GET /gst/gstr3b/export?from=&to=&branchId=` | Same data as an `.xlsx`. |

### Company Master (`/company-master`)

Identity/compliance data (CIN, PAN, company type, incorporation date,
registered office, Directors, Auditors) that AOC-4 and other statutory
filings need but nothing in the app posts against — purely descriptive,
never touched by accounting logic. `GET /` has the normal any-member read
access; every write (`PATCH /`, and all Director/Auditor CRUD) requires the
`company.manage` permission (grantable to custom roles, defaults to
OWNER/ADMIN).

| Route | Notes |
| --- | --- |
| `GET /company-master` | Org's identity fields plus its `directors`/`auditors` lists. |
| `PATCH /company-master` | Updates `cin`, `companyPan`, `companyType`, `incorporationDate`, `registeredOfficeAddress` — all optional, no validation beyond basic format (this app doesn't verify CIN/PAN checksums against MCA/IT department data). |
| `POST/PATCH/DELETE /company-master/directors(/:id)` | DIN, name, designation, appointment/cessation dates. |
| `POST/PATCH/DELETE /company-master/auditors(/:id)` | Firm name, membership/FRN number, appointment period. |

### Currency Master (`/currency-rates`)

Effective-dated FX rates. The currency code/symbol/name list itself is
still the small hardcoded array in `lib/currencies.ts` (display metadata
only — unchanged); what's new is a real per-org table of "1 unit of this
currency = X INR, effective from this date" rows, any number per currency
code. Nothing here is a foreign-key target — a posted Sales Invoice/
Purchase Bill still snapshots its own `exchangeRate` number directly at
posting time (unchanged), so this table exists purely to *pre-fill* that
field, never to enforce or retroactively affect anything already posted.
Read access is any org member; every write requires the new
`currency.manage` permission (grantable to custom roles, defaults to
OWNER/ADMIN — same tier as `coa.manage`/`items.manage`/`company.manage`,
not given to ACCOUNTANT by default).

| Route | Notes |
| --- | --- |
| `GET /currency-rates` | Full list for the org, newest effective date first within each currency code. |
| `GET /currency-rates/lookup?currencyCode=&date=` | The applicable rate as of a given transaction date — most recent row with `effectiveFrom <= date`. Returns `{ data: null }` (not an error) when nothing's been entered yet. Called by the Sales Invoice / Purchase Bill create forms to pre-fill Exchange Rate the moment a foreign currency + date are picked — the field stays freely editable either way. |
| `POST /currency-rates` | `{ currencyCode, effectiveFrom, rate }` — `currencyCode` must be a supported non-INR code (INR is always 1 by definition, never a row here); `(organizationId, currencyCode, effectiveFrom)` is unique, so a duplicate 400s asking you to edit the existing row instead. `currency.manage`. |
| `PATCH /currency-rates/:id` | `{ rate }` only — `currencyCode`/`effectiveFrom` are structural (the row's own key and what the lookup query keys off), same "locked after creation" convention as `Item.sku`. Delete and recreate to change either. `currency.manage`. |
| `DELETE /currency-rates/:id` | Hard delete (not soft) — unlike Item/BusinessPartner, nothing references a rate row by foreign key, so there's no history to preserve. `currency.manage`. |
| `GET /currency-rates/bulk-upload/template`, `POST .../preview`, `POST .../apply` | Same three-step flow as Accounts/Items/Business Partners below — matches an uploaded row to an existing rate by the `(Currency Code, Effective From)` natural key. |

Requires `db/migration_026_currency_master.sql`. No new GL accounts, no
`prisma db seed` step, no new dependencies.

### Journal Entry Bulk Upload (`/journal/bulk-upload/...`)

Extends the template/preview/apply bulk-upload pattern to Journal Entries
— the one entity here that isn't flat, one-row-per-record master data.
Full design rationale in ROADMAP.md's "Journal Entry Bulk Upload" section;
short version:

| Route | Notes |
| --- | --- |
| `GET /journal/bulk-upload/template` | One row per **line**, not per entry — rows sharing a "Voucher Ref" column (any string, unique only within the file) are grouped into a single entry. `journal.post`. |
| `POST /journal/bulk-upload/preview` | Resolves Account/Business Partner/Branch codes, groups rows by Voucher Ref, and validates each group as a whole (balance, control-account partner requirement, consistent header fields across its lines). Any problem in a group fails **every line in that group** together — never just the offending line — so Apply can never receive half a voucher. `journal.post`. |
| `POST /journal/bulk-upload/apply` | Re-resolves every code and re-checks balance fresh rather than trusting preview (this posts straight to the ledger); a group that fails this second check is skipped rather than aborting the batch. Voucher numbers use the same sequential per-type counter `POST /journal` already uses. Always returns `updated: 0` — a Journal Entry has no update case, every valid group creates a new posted entry. `journal.post`. |

No schema/migration changes — reuses `JournalEntry`/`JournalLine` and the
existing `journal.post` permission.

### Branches (`/branches`)

Full CRUD, not just the read-only list + unauthenticated onboarding create it
used to be. Reads are open to any org member (same as Chart of Accounts);
writes need `branches.manage` — a grantable custom-role permission, same
tier as `coa.manage`/`items.manage` (not hardcoded OWNER/ADMIN-only like
Team/Access Control — see Custom Roles below for why those two are
different).

| Endpoint | Notes |
|---|---|
| `GET /branches` | This org's branches (or, for a platform admin, `?organizationId=`). |
| `POST /branches` | `{ code, name, gstin?, stateCode?, phone?, email?, address?, isHeadOffice? }`. `gstin` is validated against the standard 15-character format if provided. `stateCode` (2-digit GST state code) is auto-derived from `gstin`'s first 2 characters when `gstin` is given and `stateCode` isn't — see Discount + GST Split below for what it feeds. Setting `isHeadOffice: true` un-flags whichever branch had it before — at most one head office per org, always reassignable. |
| `PATCH /branches/:id` | Same fields, all optional — only what's sent changes. |
| `PATCH /branches/:id/toggle` | Active/Inactive. Refuses on the head office branch (reassign head office first). |
| `DELETE /branches/:id` | Soft-delete (`deleted_at`) — refuses (409) if the branch is the head office, has any team member assigned (`org_users.branch_id`), or has any `journal_entries`/`stock_movements` — every transactional document already pairs those two per branch, so checking them covers Sales/Purchase/Adjustments/Returns without checking each document type individually. Deactivate instead if it's ever been used. |

Requires `db/migration_013_branch_crud.sql` (adds `phone`/`email`; `code`,
`name`, `gstin`, `address`, `is_head_office`, `status` already existed but
had no real CRUD around them).

### Sales / Purchase / Inventory (`/items`, `/sales-invoices`, `/purchase-bills`, `/stock-adjustments`, `/inventory/*`)

v1: direct invoicing only (no Sales/Purchase Order stage — see ROADMAP.md), Purchase Bill and Sales Invoice and Stock Adjustment each create-and-post atomically, same UX as `/journal`. Every org picks a stock costing method exactly once (`GET/POST /items/costing-method`) before any item can be created — `WEIGHTED_AVG` or `FIFO`, enforced immutable at the route level. Costing math lives in `lib/costing.ts` (`receiveStock`/`consumeStock`), shared by all three document routes.

| Endpoint | Notes |
|---|---|
| `GET/POST /items/costing-method` | Read, or set-once, the org's stock valuation method. |
| `GET /items/stock-accounts` | The org's item control accounts (Inventory / Raw Materials / Finished Goods), for the item-create form. |
| `GET/POST /items`, `PATCH /items/:id`, `DELETE /items/:id` | Item master. Create also creates the paired `bpType = ITEM` Business Partner (never exposed separately) and, if `openingQuantity` is set, the opening stock movement. Delete only if it's never had a stock movement. |
| `GET/POST /purchase-bills`, `GET /purchase-bills/:id` | Stock inward. Posts: Dr each line's item stock account (tagged that item's BP) + Dr CGST/SGST/IGST Input (split — see Discount + GST Split below), Cr Trade Payables (tagged the vendor). |
| `GET/POST /sales-invoices`, `GET /sales-invoices/:id` | Stock outward — rejected if a branch's on-hand can't cover a line. Posts: Dr Trade Receivables (tagged the customer), Cr Sales Revenue (gross, pre-discount) + Dr Discount Allowed + Cr CGST/SGST/IGST Output (split), Dr Cost of Goods Sold, Cr each line's item stock account (tagged that item's BP). See Discount + GST Split below for the full line-level math. |
| `GET/POST /stock-adjustments` | Both directions in one document — IN (found stock/opening, needs an explicit `unitCost`) and OUT (write-off/shrinkage, costed automatically). Posts to Inventory Adjustments either direction. |
| `GET /inventory/stock-ledger?itemId=&branchId=&from=&to=` | Running quantity balance for one item — the Stock Movement equivalent of `/journal/ledger`. |
| `GET /inventory/valuation?branchId=` | Every item currently on hand and its value — reads `ItemStock.averageCost` for weighted-avg orgs, sums remaining `StockLot`s for FIFO orgs. |

### Discount + GST Split (Sales Invoice, Purchase Bill)

Sales Invoice lines carry a discount (item's `defaultDiscountPct` seeds it,
freely overridden — `{ discountType: "PERCENT" | "FLAT", discountValue }`
per line), and the invoice itself can carry one more discount on top
(`{ discountType, discountValue }` in the request body) — prorated across
lines by their post-line-discount value (`lib/discountGst.ts`
`computeDiscountedLines()`), with the last line absorbing any rounding
remainder so the stored per-line figures always sum exactly to the
invoice-level total. GST is computed on what's left after both discounts —
never on the gross rate. Purchase Bill has no discount concept (out of
scope for this pass — see ROADMAP.md).

Both documents split GST into CGST+SGST (same state) or IGST (different
state) by comparing the posting branch's `stateCode` against the customer's/
vendor's `stateCode` (`lib/discountGst.ts` `isInterState()`) — falls back to
CGST+SGST if either side's `stateCode` is unset, rather than blocking
posting. New GL accounts: `1102/1103/1104` CGST/SGST/IGST Input Credit,
`2102/2103/2104` CGST/SGST/IGST Output Payable, `4003` Discount Allowed
(contra-revenue, modeled as EXPENSE since the schema has no separate
contra-income type — same convention `4002` Inventory Adjustments already
uses). The old single-account `1101`/`2101` GST Input/Output stay in the
COA for historical postings but no longer receive new ones.

Requires `db/migration_014_discount_gst.sql`, then `npx prisma db seed`
(new `coa_templates` rows) — existing orgs then pull the new accounts in via
Chart of Accounts → **Sync from Templates**.

Known gap: Sales Return still reads `rate`/`taxRate` straight off the
original invoice line and has no discount awareness, so returning a
discounted line refunds it at the pre-discount rate. Not fixed in this pass
— flagged for whenever Returns gets revisited.

### Foreign Currency (Sales Invoice, Purchase Bill)

Export invoices and import bills — `lib/currencies.ts` has the fixed
supported-currency list (INR + USD/EUR/GBP/AED/SGD/JPY/AUD/CAD/CHF/CNY).
Exchange rate is always manual entry (no live FX API) — the user types the
rate they looked up (e.g. CBIC's notified rate) into `exchangeRate` on the
request body. When `currency` isn't `"INR"`, every line must send `rateFc`
(the unit rate in that currency) instead of `rate` — the server overwrites
`rate` server-side as `round2(rateFc * exchangeRate)` before anything else
runs, so every existing computation (discount proration, GST split, item
costing, journal posting) executes completely unchanged, entirely in INR.
INR remains the sole figure GST/accounting/reports ever read — a foreign
invoice posts, and appears in GSTR-1/GSTR-3B/ledgers/Balance Sheet, exactly
like a domestic one. `grandTotalFc` (header) and `lineTotalFc` (line) are
display-only `round2(amount / exchangeRate)` derivatives shown alongside
the INR figures — not independently computed, so they're indicative, not a
second authoritative ledger.

The tax rate itself is never assumed by the server — it posts whatever
`taxRate` each line sends, in INR, same as a domestic invoice. The Sales
Invoice frontend defaults a foreign-currency line's tax rate to 0% (rather
than the item's usual domestic rate) when an item is picked or the
currency is switched to non-INR, since exports are zero-rated under GST
(LUT/bond — the common case). That's a UI default only, not a backend
rule — a line can still be given a positive `taxRate` for the pay-IGST-
and-claim-refund route.

Known gaps, deliberately out of scope for this pass: no realized/unrealized
forex gain-or-loss postings (this app has no invoice-to-payment settlement/
allocation feature at all yet, in any currency, so there's nothing to
anchor a realized-gain calculation to); no LUT/bond vs. IGST-paid export
classification, shipping bill/bill of entry fields, or GSTR-1 Table 6A
(exports) — those are the separate "Export/Import invoices" scope, not yet
built (see ROADMAP.md). A `FLAT`-type invoice-level discount on a foreign
invoice is still entered/interpreted in INR, not the invoice's currency.

Requires `db/migration_018_foreign_currency.sql`, then `npx prisma generate`.

### LUT/Bond Export Classification (Sales Invoice)

Every foreign-currency Sales Invoice must declare `exportType` — `"LUT"`
(Letter of Undertaking), `"BOND"`, or `"WPAY"` (with payment of IGST,
claimed back as a refund). Not applicable to a domestic (INR) invoice —
`exportType` stays `null` there, and the field is ignored if sent.

LUT and BOND exports are zero-rated by law: the server requires
`lutBondNumber` + `lutBondDate` (the ARN and date) and **rejects the whole
invoice (400)** if any line carries a nonzero `taxRate` — this is enforced
server-side, not just defaulted in the UI, since charging tax on a
declared zero-rated export is a compliance error, not a preference. WPAY
doesn't need an ARN/date and may carry tax normally.

Fixed a related bug while building this: `isInterState()` compares the
branch's and customer's `stateCode`, and falls back to `false` (same-state,
CGST+SGST) when either is unset — correct for a domestic customer with no
GSTIN on file yet, wrong for a foreign customer, who will essentially never
have an Indian state code. An export is always inter-state (IGST-only)
supply under GST law regardless of the customer's on-file state code, so
`POST /sales-invoices` now forces `interState = true` whenever the invoice
is foreign-currency, before computing the CGST/SGST/IGST split. This only
mattered for WPAY (LUT/BOND already zero-rates the line, so the split was
`{0,0,0}` either way) but was a real latent bug for that path — a WPAY
export would previously have been split into CGST+SGST like a domestic
sale instead of posting to IGST Output.

Requires `db/migration_019_lut_bond.sql`.

### Shipping Bill / Bill of Entry (Sales Invoice, Purchase Bill)

`shippingBillNumber`/`shippingBillDate`/`portCode` on Sales Invoice
(exports) and `billOfEntryNumber`/`billOfEntryDate`/`portCode` on Purchase
Bill (imports) — the customs paperwork GSTR-1 Table 6A eventually needs.
All nullable and accepted optionally on `POST`, but realistically these
documents don't exist yet at the moment of posting (goods ship, or clear
customs, after the invoice/bill is raised) — the normal way they get
filled in is the new narrow `PATCH`:

| Route | Notes |
| --- | --- |
| `PATCH /sales-invoices/:id` | Whitelisted to `shippingBillNumber`, `shippingBillDate`, `portCode`, `lutBondNumber`, `lutBondDate` only — 400s if the invoice is domestic (INR). Nothing here touches an amount, a GST figure, or the journal entry, so there's no re-posting to do — unlike a real invoice edit, which this app still doesn't support (see `PATCH /journal/:id` for the one document type that does, and why that's safe: manual entries only, no stock/COGS involved). |
| `GET /sales-invoices/:id/pdf` | Streams the invoice as a formal GST "Tax Invoice" PDF (`application/pdf`, `Content-Disposition: attachment`) — unlike the PO/SO PDFs, a legal document, so it includes the CGST/SGST/IGST split (columns switch based on inter-/intra-state), HSN, taxable value, discount, and (for a foreign-currency export) the LUT/Bond/shipping-bill declaration. Read/export action, no extra permission. See PDF export below. |
| `PATCH /purchase-bills/:id` | Same idea — whitelisted to `billOfEntryNumber`, `billOfEntryDate`, `portCode`. |

Also fixed the same latent CGST+SGST-vs-IGST bug on the Purchase Bill side
that LUT/Bond caught on Sales Invoice: `POST /purchase-bills` now forces
`interState = true` whenever the bill is foreign-currency, for the same
reason (an import is always inter-state/IGST under GST law, and a foreign
vendor essentially never has an Indian state code to fall back on
correctly).

Requires `db/migration_020_shipping_bill.sql`.

### Customs Duty / Import IGST as ITC (Purchase Bill)

Import side of the Foreign Currency feature. A foreign-currency Purchase
Bill line takes an optional `customsDutyRate` (% of that line's INR goods
value, i.e. `lineSubtotal`) — 0/null on a domestic bill, and 0 by default
on a foreign bill too (duty isn't always applicable).

`customsDutyAmount = round2(lineSubtotal * customsDutyRate / 100)`, always
0 on a domestic bill. Two things change once it's nonzero:

- **Landed cost.** `receiveStock`'s `unitCost` becomes
  `round2((lineSubtotal + customsDutyAmount) / quantity)` instead of just
  `rate` — duty is non-creditable, so it has to live in inventory cost, not
  a GST account. Falls back to the exact old `unitCost` (`= rate`) whenever
  `customsDutyAmount` is 0, so a domestic bill's costing is byte-for-byte
  unchanged.
- **IGST base.** `taxAmount` is now computed on
  `lineSubtotal + customsDutyAmount`, not `lineSubtotal` alone — import
  IGST is legally charged on (goods value + duty). Collapses to the old
  formula when duty is 0.

Neither duty nor import IGST is owed to the foreign vendor — both are owed
to customs, typically via a clearing agent — so a foreign bill's journal
entry splits the credit side: **Trade Payables** (tagged the vendor) gets
only `subtotal` (goods value across all lines), and a new **Customs Duty
Payable** account (`2105`) gets `customsDutyTotal + taxTotal`. The debit
side balances: each item's stock account debits `lineSubtotal +
customsDutyAmount` per line (was `lineSubtotal` alone), so Dr = Cr exactly
as before. `PurchaseBill.customsDutyTotal` and per-line
`customsDutyAmount`/`customsDutyRate` are persisted for the audit trail
and for the Purchase Bill detail view. `grandTotal` is redefined as
`subtotal + taxTotal + customsDutyTotal` (was `subtotal + taxTotal`).

A domestic bill (`customsDutyTotal` always 0) never enters the split
branch — Trade Payables still gets the full `grandTotal` in a single
credit line, exactly as before this feature.

GSTR-3B's ITC figure reads `PurchaseBill.igstTotal` directly and needed no
code change — it's simply more accurate now, since `igstTotal` is computed
on the corrected (goods + duty) base.

Requires `db/migration_021_customs_duty.sql`, then `npx prisma db seed` to
register account `2105` as a template, then **Chart of Accounts → Sync
from Templates** for every already-provisioned org (`POST
/accounts/sync-templates`) — same convention as the CGST/SGST/IGST split
accounts in `migration_014`. `POST /purchase-bills` 500s with a clear
message if a foreign bill needs the account and it isn't there yet.

### Purchase Orders (`/purchase-orders`)

A `PurchaseOrder` is a pre-commitment/approval document — it never posts a
journal entry or touches stock. Only once `status === "APPROVED"` can it
be linked into a Purchase Bill (see below). Full state machine on the
`PurchaseOrder` model's schema comment; routes:

| Route | Notes |
| --- | --- |
| `GET /purchase-orders` | List, org-scoped. Optional `?status=` / `?businessPartnerId=` filters. Includes full lines (with item) so the frontend can compute "has open lines" client-side without a second request. |
| `GET /purchase-orders/:id` | Detail — includes `businessPartner`, `branch`, `lines`, and every `purchaseBills` raised against it (billing history trail). |
| `POST /purchase-orders` | Creates as `DRAFT`. `purchase.post`. |
| `PATCH /purchase-orders/:id` | Full edit — 400s unless `status === "DRAFT"`. Replaces every line wholesale (delete + recreate), same "no per-line diffing" convention as the rest of this app. `purchase.post`. |
| `POST /purchase-orders/:id/submit` | `DRAFT` only. Looks up `Organization.poApprovalThreshold`; if set and `grandTotal` is strictly below it, goes straight to `APPROVED` (`autoApproved: true`); otherwise `PENDING_APPROVAL`. `purchase.post`. |
| `POST /purchase-orders/:id/approve` | `PENDING_APPROVAL` only → `APPROVED`. New `purchase.approve` permission (see below). |
| `POST /purchase-orders/:id/reject` | `PENDING_APPROVAL` only → `REJECTED`. Body `{ reason }`, required (400 without it). `purchase.approve`. |
| `POST /purchase-orders/:id/reopen` | `REJECTED` only → `DRAFT`, editable and resubmittable. Rejection reason/who/when stays on the record as history, not cleared. `purchase.post`. |
| `POST /purchase-orders/:id/cancel` | `DRAFT`/`PENDING_APPROVAL`/`APPROVED` (only if nothing's been received or billed against any line yet) → `CANCELLED`. `purchase.post`. |
| `GET /purchase-orders/:id/pdf` | Streams a formal PDF of the order (`application/pdf`, `Content-Disposition: attachment`). Read/export action — no permission gate beyond org membership, available at any status. See PDF export below. |

**Approval permission.** New `purchase.approve` in `lib/permissions.ts`,
deliberately excluded from `ACCOUNTANT`'s built-in permission set —
separation of duties, so the same role that creates/posts orders and bills
doesn't also approve by default. Owner/Admin get it automatically (their
built-in sets spread the whole `PERMISSIONS` array); grant it to a custom
role via Access Control for anyone else who should approve.

**Approval threshold.** `Organization.poApprovalThreshold` (nullable
`Decimal`), set via `PATCH /company-master` (reused `company.manage`
permission — same endpoint the CIN/PAN/directors fields already live on).
Null (the default) means every PO needs manual approval regardless of
amount; once set, `POST /:id/submit` auto-approves anything strictly below
it.

**Foreign currency.** `currency`/`exchangeRate` on the order, `rateFc` per
line — same INR-is-authoritative pattern as Purchase Bill (`rate` is
always server-recomputed from `rateFc * exchangeRate`), so GRN needed zero
changes. A PO-linked Purchase Bill has its currency *locked* to the PO's
but keeps its own independent `exchangeRate`. Full writeup in
ROADMAP.md's "Purchase/Sales Order Foreign Currency" section.

**Billing a Purchase Order — now a 3-way match (PO → GRN → Bill).**
`POST /purchase-bills` takes an optional `purchaseOrderId`. When present:
the PO must belong to the org and be `APPROVED` (else 400);
`businessPartnerId` is *derived* from the PO rather than taken from the
request body (a mismatched `businessPartnerId` in the body 400s); and
**every line is now required to carry a `goodsReceiptNoteLineId`**
(not a `purchaseOrderLineId` directly — see Goods Receipt Notes below).
The `purchaseOrderLineId` each line fulfills is derived server-side from
its referenced GRN line. Before posting, cumulative billed quantity on
that specific GRN line (its own `billedQuantity` + this bill's quantity
for it, lines on *this* bill referencing the same GRN line summed
together first) is checked against that GRN line's `quantityReceived` —
exceeding it 400s with the exact received/billed/remaining figures. On
successful post, in the same transaction: `PurchaseOrderLine.billedQuantity`
and `GoodsReceiptNoteLine.billedQuantity` both increment, then every PO
line is re-checked and the PO flips to `CLOSED` the moment all of them
are fully billed (unchanged trigger — billed ≤ received ≤ ordered
transitively, so this still means fully received too). **A PO-linked
bill's lines never call `receiveStock`** — the GRN(s) they reference
already moved that stock in; calling it again would double-count. A bill
not linked to a PO behaves exactly as before this feature — it still
calls `receiveStock` itself, same as always, and
`purchaseOrderId`/`goodsReceiptNoteLineId` are both nullable and unused.

**Bug fixed in passing:** per-line validation in `POST /purchase-bills`
(bad quantity, invalid item, and now the new PO-quantity check) used to
`throw` outside the route's only `try/catch` — express-async-errors would
forward it to `index.ts`'s catch-all, which always returns a generic 500,
discarding the actual validation message. Now wrapped properly and returns
the intended 400.

Requires `db/migration_022_purchase_orders.sql`. No new GL accounts and no
`prisma db seed` step — a Purchase Order never posts to the journal.

**PDF export.** `lib/purchaseOrderPdf.ts` builds the document with `pdfkit`
(pure JS — no headless-browser/Chromium dependency, so it's reliable in a
plain Node container; chosen over `puppeteer` for that reason). Includes
company header (name, registered office address, CIN, branch GSTIN), PO
number/date/expected-delivery/status, side-by-side Vendor/Deliver-To
boxes, a paginated line-items table, totals, narration as notes, and a
signature block. No logo/letterhead — `Organization` has no logo field
yet; deliberately out of scope for this pass. Adds `pdfkit` and
`@types/pdfkit` as new dependencies (`package.json`) — the next deploy
needs `npm install` before `npm run build` succeeds, unlike prior features
in this app's history which only touched already-installed packages.

### Goods Receipt Notes (`/goods-receipt-notes`)

Records physical receipt of goods against an `APPROVED` Purchase Order —
this, not the Purchase Bill, is what actually calls `receiveStock`
(`lib/costing.ts`) and moves `ItemStock`/`StockLot`/`StockMovement`. Only
meaningful in the PO-linked path; an ad-hoc Purchase Bill with no
`purchaseOrderId` is completely unaffected and keeps moving its own stock
exactly as it always has (see the branch on `linkedPo` in
`routes/purchaseBills.ts`).

| Route | Notes |
| --- | --- |
| `GET /goods-receipt-notes` | List, org-scoped. Optional `?purchaseOrderId=` filter. |
| `GET /goods-receipt-notes/:id` | Detail — includes `businessPartner`, `branch`, `purchaseOrder`, and `lines` (with `item` and the referenced `purchaseOrderLine`). |
| `POST /goods-receipt-notes` | Creates and posts in one step — no draft/approval state of its own (the approval gate already happened at the PO stage). `purchase.receive`. |

**Vendor and branch are both derived from the PO**, never taken from the
request — `businessPartnerId` = the PO's vendor, `branchId` = the PO's
delivery branch (falling back to the org's Head Office if the PO didn't
specify one; 400 if neither exists). Each line references a
`purchaseOrderLineId`; `itemId` and `unitCost` both come from that PO
line too, not the request — a GRN doesn't introduce a new item or price,
it confirms quantity physically arrived at the PO's agreed rate. Before
posting, cumulative received quantity (existing
`PurchaseOrderLine.receivedQuantity` + this GRN's quantity for that line,
lines on *this* GRN referencing the same PO line summed together first)
is checked against the line's ordered `quantity` — exceeding it 400s
with the exact ordered/received/remaining figures. On successful post,
in the same transaction: `receiveStock` runs once per line (movement
type `PURCHASE`, `referenceType: "goods_receipt_note"`), then each
referenced `PurchaseOrderLine.receivedQuantity` increments.

**New permission `purchase.receive`**, deliberately separate from
`purchase.post` — it's the "goods physically arrived, someone checked
them in" action, operational rather than a segregation-of-duties
boundary (unlike `purchase.approve`). `ACCOUNTANT` gets it by default in
`lib/permissions.ts`'s built-in set, same as `purchase.post`/
`inventory.post` which it already had.

**Two parallel running totals on `PurchaseOrderLine`:**
`receivedQuantity` (new, incremented here) is the real stock-in signal;
`billedQuantity` (existing, incremented by `routes/purchaseBills.ts`) is
the separate financial side and still what triggers the PO's automatic
`CLOSED` transition. `GoodsReceiptNoteLine.billedQuantity` (new,
line-scoped) is the actual 3-way-match enforcement point on the Purchase
Bill side — see the updated Purchase Bill note above.

Requires `db/migration_023_goods_receipt_notes.sql`. No new GL accounts
and no `prisma db seed` step — a GRN posts stock movements, never a
journal entry. No new dependencies either.

### 3-Way Match & Purchase Bill Approval (`/purchase-bills/:id/approve`, `/:id/reject`)

Adds the price half of the 3-way match (quantity was already a hard
GRN-vs-billed check, above) and a real approval gate on top of it. A
PO-linked bill line whose rate differs from its PO line's rate by more
than `Organization.priceVarianceTolerancePct` holds the *whole* bill —
not just that line — at `PurchaseBill.status = "PENDING_APPROVAL"`
instead of posting immediately.

| Route | Notes |
| --- | --- |
| `POST /purchase-bills/:id/approve` | `PENDING_APPROVAL` only. Re-validates GRN quantity limits (another bill may have consumed the headroom since this one was created — this is the one thing approval can't override), then does the deferred posting: journal entry, `PurchaseOrderLine`/`GoodsReceiptNoteLine` `billedQuantity` increments, PO auto-close check. `purchase.approve`. |
| `POST /purchase-bills/:id/reject` | `PENDING_APPROVAL` only → `REJECTED`. Body `{ reason }`, required. Terminal — no reopen (this app has no bill-edit capability at all; raise a corrected bill instead). Nothing to undo, since a pending bill never posted anything. `purchase.approve`. |

**`purchase.approve` is reused, not duplicated** — the same permission
that already gates Purchase Order approval now also gates this, since
both are "sign off on a financial commitment" checkpoints. Label
broadened in `lib/permissions.ts` accordingly; no change to which roles
have it by default.

**Tolerance.** `Organization.priceVarianceTolerancePct` (nullable
`Decimal(5,2)`, 0–100), set via `PATCH /company-master` alongside
`poApprovalThreshold`. Null means 0% — any variance at all requires
approval, same "null = most cautious" convention as the PO threshold.

**Posting is fully deferred, not just gated.** `PurchaseBill.journalEntryId`
is now nullable — a `PENDING_APPROVAL` bill has no journal entry, no
stock movement (it's always PO-linked, so `receiveStock` was never going
to run for it anyway), and no `billedQuantity` impact on either the
`PurchaseOrderLine` or `GoodsReceiptNoteLine` it references. All of that
happens for the first time at `POST /:id/approve`, which reconstructs the
exact journal entry `POST /purchase-bills` would have posted immediately
had it matched — from the bill/line data already stored in
`PurchaseBillLine`, never recomputed from the original request. Both
paths share one `buildBillJournalLineRows()` helper so there's a single
place that knows this journal's shape (Dr each item's stock account, Dr
GST Input split, Cr Customs Duty Payable on imports, Cr Trade Payables).

**`PurchaseBill.varianceNote`** — server-generated (never user-entered),
lists which line(s) exceeded tolerance and by how much
(`"Exceeds 2% price tolerance — SKU001: PO ₹100.00 vs bill ₹115.00 (15.00%)"`),
shown on the Pending Approval detail screen so the approver doesn't have
to cross-reference the PO by hand.

**Two bugs found and fixed while wiring this in**, both about code that
assumed every row in `purchase_bills` had actually posted:
- `POST /purchase-returns` and `GET /purchase-returns/bill/:billId/lines`
  had no status check — a return could have been raised against a bill
  that never moved stock or touched Trade Payables. Both now require
  `status === "POSTED"` (400 otherwise).
- `computeGstr3b` (`lib/gstReports.ts`) aggregated Purchase Bill GST
  totals with no status filter, which would have overstated ITC in
  GSTR-3B for any bill still sitting at `PENDING_APPROVAL`. Now scoped to
  `status: "POSTED"`.

Requires `db/migration_024_bill_approval.sql`. No new GL accounts, no
`prisma db seed` step, no new dependencies.

### Sales Orders (`/sales-orders`), Delivery Notes (`/delivery-notes`)

The sales-side mirror of Purchase Order + Goods Receipt Note, built the
same way in one pass. `SalesOrder` never touches the journal or stock — a
pre-commitment/approval document only, same status state machine as
`PurchaseOrder`: `DRAFT` → submit → `APPROVED` (auto, when
`Organization.soApprovalThreshold` is set and this SO's `grandTotal` is
strictly below it) or `PENDING_APPROVAL` → approve/reject → `APPROVED`/
`REJECTED`. `REJECTED` → reopen → `DRAFT` (history kept). Cancel blocks if
anything's been delivered or billed. Auto-`CLOSED` once every line is
fully invoiced.

| Route | Notes |
| --- | --- |
| `GET /sales-orders` | List, org-scoped. Optional `?status=`/`?businessPartnerId=` filters. |
| `GET /sales-orders/:id` | Detail — includes `businessPartner`, `branch`, `lines` (with `item`), `salesInvoices` and `deliveryNotes` raised against it. |
| `POST /sales-orders` | Always creates as `DRAFT`. `sales.post`. |
| `PATCH /sales-orders/:id` | Full edit, `DRAFT` only — replaces every line. `sales.post`. |
| `POST /sales-orders/:id/submit` | `DRAFT` only. Auto-approves under `soApprovalThreshold`, else → `PENDING_APPROVAL`. `sales.post`. |
| `POST /sales-orders/:id/approve` | `PENDING_APPROVAL` only. `sales.approve`. |
| `POST /sales-orders/:id/reject` | `PENDING_APPROVAL` only → `REJECTED`. Body `{ reason }`, required. `sales.approve`. |
| `POST /sales-orders/:id/reopen` | `REJECTED` only → `DRAFT`. `sales.post`. |
| `POST /sales-orders/:id/cancel` | `DRAFT`/`PENDING_APPROVAL`/`APPROVED` only, and only if nothing's been delivered or billed against any line. `sales.post`. |
| `GET /sales-orders/:id/pdf` | Streams a formal PDF of the order (`application/pdf`, `Content-Disposition: attachment`) — layout mirror of `GET /purchase-orders/:id/pdf`. Read/export action, no extra permission, available at any status. See PDF export below. |

**New permission `sales.approve`**, deliberately excluded from
`ACCOUNTANT`'s built-in set — same separation-of-duties reasoning as
`purchase.approve`. `OWNER`/`ADMIN` get it automatically.

**Foreign currency.** `currency`/`exchangeRate` on the order, `rateFc` per
line — exact mirror of Purchase Order's own foreign-currency support
above, including the currency-locked-but-exchange-rate-independent
linkage into an SO-linked Sales Invoice. Full writeup in ROADMAP.md's
"Purchase/Sales Order Foreign Currency" section.

**Delivery Note is the real stock-out event — the exact mirror of Goods
Receipt Note, but calling `consumeStock` instead of `receiveStock`.** Only
meaningful against an `APPROVED` Sales Order; customer and branch are both
derived from the SO, never the request. Posts immediately on creation, no
workflow of its own. An ad-hoc Sales Invoice with no `salesOrderId` is
completely unaffected and keeps moving its own stock exactly as it always
has (see the branch on `linkedSo` in `routes/salesInvoices.ts`).

| Route | Notes |
| --- | --- |
| `GET /delivery-notes` | List, org-scoped. Optional `?salesOrderId=` filter. |
| `GET /delivery-notes/:id` | Detail — includes `businessPartner`, `branch`, `salesOrder`, and `lines` (with `item` and the referenced `salesOrderLine`). |
| `POST /delivery-notes` | Creates and posts in one step — no draft/approval state of its own. `sales.deliver`. |

**New permission `sales.deliver`**, deliberately separate from
`sales.post` — operational rather than a segregation-of-duties boundary
(unlike `sales.approve`). `ACCOUNTANT` gets it by default, same as
`purchase.receive`.

**`DeliveryNoteLine` carries both a `rate` and a `unitCost` — not
redundant, they mean different things.** `rate` is descriptive only,
carried in from the SO line's own selling price (a Delivery Note doesn't
set a new price, same as `GoodsReceiptNoteLine.unitCost` being carried
from the PO line's rate). `unitCost` is the actual blended cost
`consumeStock` *returns* (FIFO/weighted-average, whatever the org's
costing method says) — captured so an eventual SO-linked Sales Invoice
line can reuse the exact same figure for its COGS journal debit instead of
calling `consumeStock` a second time, which would double-consume the same
units. Before posting, cumulative delivered quantity is checked against
each line's ordered `quantity`, same over-delivery guard as the GRN's
over-receipt check.

**`SalesInvoice.salesOrderId` (optional) and the SO-linked 3-way match on
`SalesInvoiceLine`** work exactly like `PurchaseBill.purchaseOrderId` and
the GRN-linked match on `PurchaseBillLine`: an SO-linked invoice line
carries a `deliveryNoteLineId` (not a `salesOrderLineId` — that's derived
server-side from the DN line), and can't invoice more than that DN line's
`quantityDelivered − billedQuantity` — a hard, unconditional 400.
`consumeStock` is skipped for these lines; the journal's COGS/stock-account
lines use the DN line's captured `unitCost` instead. Discounts, GST split,
and foreign-currency/export handling are all unaffected by SO-linkage —
only currency is disabled when SO-linked (Sales Orders don't carry a
currency concept yet, mirroring why a PO-linked Purchase Bill can't be
foreign either).

**No price-variance/approval workflow on the Sales Invoice side (yet)** —
scope decision, deliberate. That's a second feature layered onto the
purchase side in a later pass (see 3-Way Match & Purchase Bill Approval,
above); the sales-side equivalent wasn't asked for here. An SO-linked
invoice line's `rate` is freely entered/overridable with no check against
the SO's own rate.

Requires `db/migration_025_sales_orders.sql`. No new GL accounts and no
`prisma db seed` step — a Sales Order never posts to the journal, a
Delivery Note posts stock movements only. No new dependencies.

### Bulk upload (`/accounts`, `/items`, `/business-partners`, `/currency-rates` — `/bulk-upload/*`)

Same three-step flow on all four, ported from SmartAppt Gold's vendor/bank upload pattern (`lib/xlsxTemplate.ts` + `lib/upload.ts` are the shared pieces): `GET .../bulk-upload/template` downloads a styled `.xlsx` (header row, inline hints, dropdown validation on enum columns); `POST .../bulk-upload/preview` (multipart, field name `file`) parses it server-side and returns every row tagged `create` / `update` / `error` — nothing is written yet; `POST .../bulk-upload/apply` takes back only the rows the user confirmed (body `{ rows: [...] }`) and commits them. Matching an uploaded row to an existing record: Chart of Accounts by Account Code, Items by SKU, Business Partners by the optional `code` field (blank code always creates new — see `migration_007`), Currency Rates by the `(Currency Code, Effective From)` pair. Requires `db/migration_007_user_name_and_bp_code.sql`.

### Sales / Purchase Returns (`/sales-returns`, `/purchase-returns`)

Always tied to an existing Sales Invoice / Purchase Bill — `GET .../invoice/:id/lines` (sales) or `GET .../bill/:id/lines` (purchase) returns each original line annotated with `alreadyReturned`/`remaining`, so the create form can cap quantities client-side (the server re-validates the cap regardless). `POST /sales-returns` line input is `{ salesInvoiceLineId, quantity, condition }` where condition is `GOOD` (re-enters sellable stock at the original line's cost, reverses Sales Revenue/CGST+SGST or IGST Output/COGS/Trade Receivables normally) or `DAMAGED` (same revenue/GST/receivable reversal, but the cost writes off to Inventory Adjustments (4002) instead of back to stock, with no stock movement at all). `POST /purchase-returns` line input is `{ purchaseBillLineId, quantity }` — no condition; stock leaves via `returnStockToVendor()` (`lib/costing.ts`) at the original bill line's rate, preferring to deplete that exact bill's own stock lot before falling back to oldest-first FIFO; GST reverses into CGST+SGST or IGST Input the same way. Both routes recompute the inter/intra-state split fresh (branch vs customer/vendor state — see Discount + GST Split above) rather than reading it off the original document, since neither document stores that flag. Voucher types `SR`/`PR`, movement types `SALES_RETURN_IN`/`PURCHASE_RETURN_OUT`. Requires `db/migration_008_sales_purchase_returns.sql`.

### Team / user management (`/org/users/*`, OWNER/ADMIN only)

| Endpoint | Notes |
|---|---|
| `GET /org/users` | Current members + pending invites. |
| `POST /org/users/invite` | `{ email\|phone, role, customRoleId? }` → creates an invite, returns `devInviteToken` (until a real email/SMS provider exists) to build the accept-invite link from. `role` is one of `ADMIN\|ACCOUNTANT\|VIEWER\|CUSTOM`; `CUSTOM` requires `customRoleId`. |
| `DELETE /org/users/invites/:id` | Cancel a pending invite. |
| `PATCH /org/users/:userId/role` | Change a teammate's role (`{ role, customRoleId? }`, same shape as invite). Can't touch the OWNER. |
| `PATCH /org/users/:userId/branch` | `{ branchId }` (or `null` to clear) — which branch a member belongs to. Informational only today; nothing else in the app scopes reads/writes by it yet. |
| `PATCH /org/users/:userId/employee-details` | `{ address?, pan?, aadhar? }` — interim employee fields, editable for any member including the OWNER (not a security control, so none of the role/status self-lock protections apply). PAN is validated against the standard 10-character format; Aadhar against 12 digits. `GET /org/users` and this endpoint's response both return `aadharMasked` ("XXXX XXXX 1234") only — the full Aadhar number is never echoed back by any endpoint once stored. See migration_012's note: this is plaintext-at-rest, not a substitute for real encryption if Aadhar capture becomes a genuine compliance requirement. |
| `PATCH /org/users/:userId/status` | `{ status: "ACTIVE" \| "SUSPENDED" }` — suspend/reactivate without removing membership. Can't touch the OWNER or yourself. A suspended member is refused at `/auth/login`, and `requireActiveSubscription()` re-checks it on every request against an already-issued token (a token issued before suspension is otherwise valid for 30 days). |
| `DELETE /org/users/:userId` | Revoke access — removes the `org_users` row entirely (distinct from suspend, which keeps it). Can't remove the OWNER or yourself. |
| `POST /auth/accept-invite` | `{ token, password }` → creates the login, joins the org, returns a session token + resolved `permissions`. |

Roles: **OWNER** (one per org, set at registration, full access) · **ADMIN** (same minus touching the OWNER) · **ACCOUNTANT** (post transactions, manage business partners) · **VIEWER** (read-only) · **CUSTOM** (org-defined, see below). Module-level write access is enforced server-side via `requirePermission()` in `middleware/auth.ts` — not just hidden UI. Team/role management and Access Control config stay on `requireRole("OWNER", "ADMIN")` specifically, never `requirePermission()` — see Custom Roles below for why.

### My Profile (`/me`, any authenticated user)

| Endpoint | Notes |
|---|---|
| `GET /me` | Your own `id/name/email/phone/isPlatformAdmin/createdAt`. |
| `PATCH /me` | `{ name?, email?, phone? }` — checked against the row the update would produce (not written first, then checked): email/phone uniqueness, and refuses to leave an account with neither email nor phone. |
| `POST /me/change-password` | `{ currentPassword, newPassword }` — logged-in password change. Distinct from `/auth/forgot-password` + `/auth/reset-password` above (the logged-out OTP flow). |

### Custom Roles (`/org-roles`, OWNER/ADMIN only)

An org can define its own named roles on top of the four fixed ones, each a
subset of a fixed permission catalogue (`lib/permissions.ts`): `coa.manage`,
`items.manage`, `businessPartners.manage`, `branches.manage`, `sales.post`,
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
| `GET /access-control/menu` | Any org member — full override map for their own org, every role (fixed and custom) included. AppShell filters the sidebar for the caller's own role/custom role from this. |
| `GET /access-control/menu/:organizationId` | OWNER/ADMIN (own org — the URL id is a hint, not an authority) or platform admin (any org). Returns the matrix plus `editableRoles` (`{ value, label, permissions }[]`). |
| `PUT /access-control/menu/:organizationId` | `{ items: [{ itemId, role, enabled }] }` — replaces the caller's editable roles' overrides. `role` is a plain string, not just the four fixed names. |

**Who can edit which role's menu:** OWNER/ADMIN can configure every fixed
role except OWNER (never restrictable) and except their own role (self-lock
protection — an ADMIN hiding a screen from ADMIN would lock themselves out
with no way back short of a platform admin), plus **every custom role** the
org has defined (no self-lock concern there — OWNER/ADMIN are never
themselves a custom role). A platform admin can configure all four fixed
roles too. See `editableRolesFor()` in `middleware/auth.ts` (fixed roles)
and `editableRoleOptions()` in `accessControl.ts` (adds custom roles).

**Custom roles in this matrix.** A custom role's `org_menu_config` rows are
keyed `"custom:<org_roles.id>"` — an ID rather than the role's name so a
rename doesn't orphan its overrides (`role` widened to `VARCHAR(50)` in
`migration_011_custom_role_access_control.sql` to fit `"custom:" + uuid`).
Its *default* visibility (before any override) isn't a fixed `roles` list
like the four built-in roles have — it's computed from whether the role
holds the item's `permission` (`navGroups.ts`'s `NavItem.permission`; items
with no `permission` are universal, visible to every custom role). Both
`AccessControlMatrix.tsx` (the admin's editing screen) and `AppShell.tsx`
(the actual sidebar a custom-role user sees) compute this same default
independently, so what an admin sees as "on by default" in the matrix
always matches what that role's members actually see.

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
4a. Add an `ANTHROPIC_API_KEY` env var to enable AI invoice extraction
   (`POST /purchase-bills/extract-invoice` — see Endpoints below). Optional:
   without it, that one endpoint returns a 502 with a clear message, and
   everything else on Purchase Bills still works — the "Extract data"
   button in the frontend just won't succeed.
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
   psql "$DATABASE_URL" -f ../db/migration_009_custom_roles.sql
   psql "$DATABASE_URL" -f ../db/migration_010_user_management.sql
   psql "$DATABASE_URL" -f ../db/migration_011_custom_role_access_control.sql
   psql "$DATABASE_URL" -f ../db/migration_012_employee_details.sql
   psql "$DATABASE_URL" -f ../db/migration_013_branch_crud.sql
   psql "$DATABASE_URL" -f ../db/migration_014_discount_gst.sql
   npx prisma db seed
   npm run create-admin -- --email you@example.com --password "something long"
   ```
6. Copy the service's public URL into the frontend's `NEXT_PUBLIC_API_URL`
   on Vercel.

## Known gaps (MVP)

- `POST /purchase-bills/extract-invoice` reads an uploaded vendor invoice
  (PDF/image, `multer` memoryStorage — never written to disk) via Claude's
  Messages API (`lib/invoiceExtraction.ts`) and returns structured JSON
  (vendor, date, currency, grand total, line items). Read-only — it never
  creates or modifies a bill. The frontend either auto-fills header fields
  (manual-entry bills) or shows a read-only comparison against GRN-derived
  lines (PO-linked bills, to catch a vendor invoicing for quantity that was
  actually returned). Requires `ANTHROPIC_API_KEY`; line-item matching is
  best-effort text matching, not exact.
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
