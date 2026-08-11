# SmartERP Roadmap

Tracks what's deliberately deferred, and why, so a scope decision made in
passing doesn't get silently forgotten. Not a backlog of nice-to-haves —
everything here was scoped out of something currently being built, with a
reason and (where relevant) the shape it'll take when it's picked up.

## Sales / Purchase / Inventory (built)

v1 scope, done: **Purchase Bill** (stock inward), **Sales Invoice** (stock
outward), **Stock Adjustment** (both directions — also how opening stock
gets entered). Each document posts a Journal Entry and a Stock Movement
together, in one transaction. Costing method (Weighted Average or FIFO) is
an org-level choice, made once via a one-time gate on first use, never
editable after. Items get a paired Business Partner row (`bpType = ITEM`)
so the existing Ledger report gives a per-item sub-ledger for free. New
reports: Stock Ledger (per-item running balance) and Item Valuation.
Requires `db/migration_006_sales_purchase_inventory.sql`, and moved Trade
Receivables/Payables from the Trading-only overlay to core (a Manufacturing
org needs them too).

Deferred out of that scope:

- **Sales Order / Purchase Order stage.** v1 is direct invoicing only — no
  quotation/order step in front of Sales Invoice or Purchase Bill, no
  partial-fulfillment tracking. When built, an Order generates a draft
  Invoice/Bill; today's direct-invoice flow keeps working unchanged. Roughly
  2-3x the build of v1 (more screens, more states, more edge cases), so it
  waits until direct invoicing is proven out. **Update: the Purchase Order
  half of this is now built — see "Purchase Order Workflow" below.** Direct
  Purchase Bill posting (no PO) still works completely unchanged; a PO is
  optional. Sales Order is still deferred — Sales Invoice remains
  direct-only.

- **Inter-branch Stock Transfer.** Moves quantity between branches without
  touching accounting the way a sale or purchase does (same org's
  inventory, no P&L impact) — its own document type, not a variant of
  Adjustment. Designed shape: no Journal Entry at all (first document type
  that's stock-only), a `TRANSFER_OUT`/`TRANSFER_IN` pair of
  `StockMovement`s, costed by calling `consumeStock()` at the source branch
  and `receiveStock()` at the destination with that exact same unit cost —
  reusing the two `lib/costing.ts` primitives Sales Invoice/Purchase
  Return already use, so a transfer can't manufacture or destroy value.
  Gated by the (now-existing) `inventory.post` permission. Blocked on
  needing a real second branch to transfer *to* — see Branch Master below,
  now built, so this is unblocked whenever it's picked up.

- **Manufacturing / Production (BOM explosion).** Confirmed model: **Model
  A — make-to-stock**. A Production step consumes raw materials via
  `BomLine` and produces real Finished Goods stock *before* any sale;
  Sales Invoice never inspects the BOM, it always moves exactly the item(s)
  on the invoice. This keeps Sales Invoice simple now and makes Production
  a self-contained module later — building it doesn't require touching
  Sales Invoice at all. (Rejected alternative: Model B, assemble-on-sale,
  where a Finished Good has no stock of its own and selling it explodes the
  BOM into raw-material movements on the spot. Would have required BOM
  logic inside Sales Invoice from day one.)

## Basic User Management (built)

The original registration wizard never asked for the OWNER's name (fixed
earlier — see git history — but flagged again as evidence "user management"
was thin overall), and beyond invite/role-change/remove there was no
self-service profile editing, no password reset, no use of the
already-existing `org_users.branch_id` column, and no way to suspend a
member short of fully removing them. Filled in:

- **My Profile** (`/me`, any authenticated user) — view/edit your own
  name/email/phone, change your own password.
- **Forgot/reset password** (`/auth/forgot-password` + `/auth/reset-password`)
  — logged-out OTP flow, same shape as signup's OTP verification. Generic
  response either way so it can't be used to enumerate accounts.
- **Branch assignment** (`PATCH /org/users/:userId/branch`) — the Team
  screen can now actually set the branch a member belongs to. Informational
  only for now — nothing else in the app scopes reads/writes by it yet, so
  assigning someone to a branch doesn't currently restrict what they see.
- **Member suspension** (`PATCH /org/users/:userId/status`) — distinct from
  removal: a suspended member keeps their `org_users` row (role, branch,
  audit trail) but is refused at login, and an already-issued token is
  re-checked on every request via `requireActiveSubscription()` so
  suspension takes effect immediately, not just on next login.

Requires `db/migration_010_user_management.sql`.

Still not here: branch assignment doesn't yet restrict anything (an
org-wide role still sees org-wide data regardless of its `branchId`) — that
would need every module route to filter by the caller's branch, a bigger
change than this pass. If per-branch data scoping is wanted, that's the
next layer on top of this.

**Update — employee details (interim).** Discussed as a possible separate
Employee master (designation, date of joining, statutory IDs, distinct from
the login account) but deferred; what actually got built instead is
narrower and lives directly on `org_users`: an **Edit** button per team
member (Team screen) opens an OWNER/ADMIN-only form for Address, PAN, and
Aadhar. PAN/Aadhar are format-validated (10-char PAN, 12-digit Aadhar) but
**not encrypted at rest** — Aadhar is masked in every API response
("XXXX XXXX 1234", never the full number once stored) as a stopgap against
accidental exposure through the API surface, but that is not the same as
real encryption/tokenization and does not on its own satisfy UIDAI storage
requirements. Treat this as good enough for internal MVP use, not for
production Aadhar capture, until proper encryption is built. Requires
`db/migration_012_employee_details.sql`. The full separate Employee master
(if ever needed — designation/DOJ/independent-of-login-access employees)
is still an open, unbuilt idea, not this.

## Branch Master (built)

Branches existed in the schema from day one (auto-created head office at
signup, referenced by every transactional document) but had no real CRUD —
just an unauthenticated `POST /branches` nothing actually called, and a
`GET /branches` added later purely to feed the Team page's branch-assignment
dropdown. Filled in: full `GET/POST /branches`, `PATCH /branches/:id`,
`PATCH /branches/:id/toggle` (Active/Inactive), `DELETE /branches/:id`
(only if unused — no team member assigned, no journal entry, no stock
movement at that branch; deactivate otherwise), all behind a new
`branches.manage` permission (grantable to a custom role, same tier as
`coa.manage`/`items.manage` — not hardcoded OWNER/ADMIN-only, since
managing branches isn't the same self-escalation risk as team/role
management). New Branches screen under Settings.

Fields: code (unique per org), name, GSTIN (validated against the standard
15-character format), phone, email, address (kept as an unstructured
blob — same convention Business Partner already uses — rather than
structured line1/city/state/pincode, since nothing in the app needs to
query by state yet; revisit if/when GST returns gets built), and Head
Office (exactly one per org, freely reassignable — toggling it on for one
branch automatically un-flags whichever branch had it before). Requires
`db/migration_013_branch_crud.sql`.

## Discount + GST Split (built)

Sales Invoice had a single flat tax rate per line and no discount concept
at all; Purchase Bill had the same flat tax rate with no CGST/SGST/IGST
split even though `Branch.gstin`/`BusinessPartner.gstin` both already
existed. Filled in:

- **Discount, three layers deep.** An item's `defaultDiscountPct` seeds a
  Sales Invoice line's discount when picked, freely overridden per line
  (percent or flat amount, admin's choice) — and the invoice itself can
  carry one more discount on top, prorated across lines by their
  post-line-discount value (last line absorbs any rounding remainder so the
  stored figures always sum exactly). GST is computed on what's left after
  both discounts, never on the gross rate. Posts **gross**: Sales Revenue
  books the full pre-discount value, a new contra `4003 Discount Allowed`
  account absorbs everything taken off (line + invoice level combined) —
  so the P&L shows revenue and total discount given as separate figures,
  not netted invisibly into a smaller revenue number. Scoped to Sales
  Invoice only (not Purchase Bill) — matches how the feature was asked for;
  nothing stops a vendor-side discount being added the same way later if
  wanted.
- **CGST/SGST/IGST split**, Sales Invoice and Purchase Bill both. Branch
  and Business Partner each got a `stateCode` (2-digit GST state code) —
  auto-parsed from a GSTIN's first 2 characters when one's entered, but
  independently settable, since an unregistered branch or a B2C customer
  still has a state without having a GSTIN. At posting time, the selling/
  buying branch's `stateCode` is compared against the customer's/vendor's:
  same state → CGST + SGST (half the rate each); different state → IGST at
  the full rate. If either side's `stateCode` is unset, both documents fall
  back to CGST+SGST rather than blocking posting — a documented assumption,
  not a validation gate. New GL accounts: `1102/1103/1104` CGST/SGST/IGST
  Input Credit, `2102/2103/2104` CGST/SGST/IGST Output Payable. The old
  single-account `1101`/`2101` GST Input/Output stay in the COA (historical
  postings keep pointing at them) but no longer receive new transactions.

Requires `db/migration_014_discount_gst.sql`, then `npx prisma db seed` to
add the new accounts to `coa_templates` — existing orgs pull them in via
Chart of Accounts → Sync from Templates (same mechanism `POST /accounts/
sync-templates` already provided for the original GST/COGS/Sales Revenue
rollout).

**Update — Returns now post to the split accounts too.** Sales Return and
Purchase Return originally kept reversing into the old single `2101`/`1101`
accounts even after Sales Invoice/Purchase Bill moved to the CGST/SGST/IGST
split — meaning any return against a post-split document would have
permanently overstated the split accounts (never reduced) while the old
accounts went the wrong direction. Fixed: both routes now recompute the
same branch-vs-customer/vendor state comparison the original document used
and reverse into whichever of `2102-2104`/`1102-1104` that split lands on.

Deliberately not covered by this pass:

- **Sales Return doesn't know about discount.** It still reads `rate`/
  `taxRate` straight off the original invoice line and refunds at that
  figure — a returned line on a discounted invoice gets credited at the
  pre-discount rate. Worth fixing whenever Returns is revisited; not fixed
  here since Returns wasn't part of what was asked.
- **Purchase Bill discount.** Only the GST split applies to Purchase Bill;
  no vendor-side discount concept was requested, so none was built.
- **GSTR-1 / GSTR-3B.** The CGST/SGST/IGST split is exactly the shape a
  real GST return needs, but nothing computes one yet — still listed under
  "From the earlier what's next review" below.

## Custom Roles (built)

Layered on top of the fixed OWNER/ADMIN/ACCOUNTANT/VIEWER four, which stay
hardcoded exactly as before (OWNER un-demotable, ADMIN self-lock protection
on menu config unchanged). An org can additionally define its own named
roles, each a subset of a fixed seven-permission catalogue — Manage Chart of
Accounts, Manage Items, Manage Business Partners, Post Sales, Post Purchase,
Post Inventory Adjustments, Post Journal Entries. `requireRole()` (hardcoded
role-name checks) was replaced with `requirePermission()` (checks a
resolved permission set — fixed for the four built-in roles, looked up from
the role's DB row for a custom one) on every module route it used to gate;
the built-in roles' actual access didn't change, this only made the
authorization model support more than four roles.

Deliberately excluded from the grantable catalogue: team/role management
and menu-visibility config. Both stay `requireRole("OWNER", "ADMIN")` —
handing either one to a custom role would let that role holder define a
more powerful role and assign it to themselves, the standard
self-escalation hole in any permissions-that-can-grant-permissions model.
Requires `db/migration_009_custom_roles.sql`.

**Update:** custom roles are now also configurable in Access Control
(`/settings/access-control`), not just permissions — every custom role an
org defines shows up there as an extra tab an OWNER/ADMIN can toggle
per-item visibility for, the same way the four fixed roles always could. A
custom role's *default* visibility (before any override) is computed from
its granted permissions rather than a fixed `roles` list (see `NavItem.
permission` in `navGroups.ts`); `AccessControlMatrix.tsx` (the editing
screen) and `AppShell.tsx` (the actual sidebar) compute that default with
the same formula so they never disagree. Its `org_menu_config` rows are
keyed `"custom:<org_roles.id>"` rather than by name, so renaming a custom
role doesn't orphan its menu overrides. Requires
`db/migration_011_custom_role_access_control.sql`.

## Sales Return / Purchase Return (built)

Always tied to the original Sales Invoice / Purchase Bill — never freeform
— so a line can never return more than (originally invoiced/billed qty -
already returned across prior returns). Each posts a Journal Entry and, for
Sales Return, a Stock Movement, in one transaction (same pattern as
Sales/Purchase/Inventory v1).

Sales Return lines carry a **GOOD / DAMAGED condition**: GOOD re-enters
sellable stock at the original invoice line's cost (a new FIFO lot, or
folded into the weighted average) and reverses Sales Revenue/GST
Output/COGS/Trade Receivables normally; DAMAGED still credits the customer
and reverses revenue/GST the same way, but the cost writes off to Inventory
Adjustments (4002) instead of back to stock, and creates no stock movement
at all — it never re-enters sellable on-hand, so it doesn't appear in the
Stock Ledger either. Purchase Return has no condition split (stock is
leaving to the vendor regardless of its state) and costs the returned
quantity at the original bill line's rate, preferring to deplete the exact
stock lot that bill created (falls back to oldest-first FIFO for any
shortfall) — see `returnStockToVendor()` in `lib/costing.ts`. Requires
`db/migration_008_sales_purchase_returns.sql`.

## Journal Entries UX (built)

Rebuilt to match SmartAppt Gold's Journal Entries screen: a master-detail
layout (fixed list on the left, detail/form on the right) instead of the
old inline expanding form + flat table.

- **Voucher-class abstraction.** Posting starts from a Bank / Cash /
  Journal class picker instead of a raw BV/CV/JV dropdown. For Bank/Cash,
  a Receipt/Payment direction picker follows, and the "money" line (the
  org's Cash-in-Hand/Bank Account, codes `1001`/`1002`) is never typed in
  — it's auto-computed as the total of whatever contra line(s) the user
  enters. The class + direction only collapse into a stored `voucherType`
  (`BV`/`CV`/`JV`) at save time.
- **Sequential voucher numbering.** Manual entries get a `JV-0001` /
  `BV-0001` / `CV-0001` style `voucherNumber`, scoped per organization per
  voucher type — no fiscal-year logic, matching the plain-sequential
  convention `SalesInvoice.invoiceNumber` etc. already use. Auto-posted
  entries (Sales Invoice, Purchase Bill, Sales/Purchase Return, Stock
  Adjustment) leave this null and show their own document's number
  instead.
- **Editing.** `PATCH /journal/:id` lets a MANUAL entry (`referenceType`
  null) be corrected in place — date, narration, lines. Auto-posted
  entries stay read-only here; correcting one means posting through its
  own module. `voucherType` itself is frozen once created.
- **Attachments.** One supporting document per entry (replaces on
  re-upload), on any entry — manual or auto-posted. Stored directly in
  Postgres as `bytea` (no cloud storage exists anywhere in this app yet);
  fine for occasional scanned bills, not meant for high volume. 5MB cap
  enforced by the existing upload middleware.

Requires `db/migration_015_journal_ux.sql`.

## GST Statutory Reports (built)

New "Statutory Reports" menu — GSTR-1 and GSTR-3B, both on-screen and as an
Excel download matching a close approximation of the official column
layout. Deliberately an MSME-first-pass subset, not a full compliance
engine:

- **Place of supply** is always the customer/vendor's own state (bill-to)
  — this app has no separate ship-to address concept anywhere, so there's
  nothing else to use.
- **B2C** is one summarized table by state + rate, not the official
  invoice-wise "B2CL" table for invoices over ₹2.5L — this app doesn't flag
  large B2C invoices separately.
- **No cess** (not modeled anywhere), no exempt/nil-rated/zero-rated
  distinction, no reverse-charge flag — every taxable line is treated as a
  normal taxable supply.
- **GSTR-3B's Net Payable** is liability minus ITC per tax head, clamped at
  zero — it does not model the government's actual cross-utilization
  set-off order (IGST credit first against IGST, then CGST, then SGST) or
  carry-forward of unused credit. Flagged in the UI itself as indicative,
  not filing-ready.
- Sales Return / Purchase Return don't store their own CGST/SGST/IGST
  split (only a combined `taxAmount`) — GSTR-1's credit-note table and
  GSTR-3B's net-of-returns figures recompute it the same way the posting
  routes do (`lib/gstReports.ts`). Sales Return's known discount-blindness
  (see above) carries through to these numbers too.

Backend: `lib/gstReports.ts` (`computeGstr1`/`computeGstr3b`) +
`routes/gst.ts` (`GET /gst/gstr1`, `/gst/gstr1/export`, `/gst/gstr3b`,
`/gst/gstr3b/export`). No new migration — built entirely from data already
captured by the Discount + GST Split and Sales/Purchase Return features.

## M-PIN Login (built)

`/login` now matches SmartAppt Gold's actual flow instead of a single
email/phone + password form: enter an email or phone, then either enter a
4-digit M-PIN (returning users) or verify an OTP and set one (first time,
or "forgot M-PIN" — same operation, one endpoint). The "Register
Association" link SmartAppt Gold shows here is "Register Company" in
SmartERP, pointing at the existing `/register` wizard (unchanged).

Fully additive, not a replacement: `POST /auth/login` (email/phone +
password) still works exactly as before for any account that hasn't set an
M-PIN — the login screen just doesn't surface that path anymore, matching
the reference screen. Practical effect: every existing account (including
a freshly created platform admin) needs to go through the OTP → set-M-PIN
step once before they can log in at all through this screen, since none of
them have `mpin_hash` set yet. The OTP shows directly on screen either way
(`devOtp`, same "no real provider" convention as registration/forgot-
password) until a real SMS/email provider is wired up.

Backend: `users.mpin_hash` (migration_016), reusing the same
`reset_otp_code`/`reset_otp_expires_at` pair `/forgot-password` already
uses rather than new OTP columns. New routes: `GET /auth/mpin/status`,
`POST /auth/mpin/request-otp`, `POST /auth/mpin/verify`, `POST
/auth/mpin/set`. `POST /auth/login`'s platform-admin/isVerified/suspended
checks were extracted into a shared `buildLoginResponse()` so all three
login paths (`/login`, `/mpin/verify`, `/mpin/set`) share one implementation
instead of three copies.

## Company Master + Schedule III Balance Sheet (built)

Two pieces scoped together after asking "do we have what AOC-4 needs" —
these are the two that were actually buildable as software features; XBRL
export and the Board's/Auditor's narrative reports were scoped but
deliberately not built (see that conversation — XBRL needs a taxonomy-
compliant generator best left to dedicated tools/a CA, and the narrative
reports are legal documents someone still has to write, not data).

**Company Master.** New Settings screen — CIN, company PAN, company type,
incorporation date, registered office address on the org itself, plus
Directors and Auditors as their own small history-kept lists (isActive
rather than delete, since a filing cares who held office/audited during
the period, not just who currently does). None of this feeds any posting
anywhere — it's purely for statutory filings. OWNER/ADMIN only, gated by a
new `company.manage` permission (also grantable to a custom role, same as
every other module permission).

**Schedule III Balance Sheet.** A new `Account.scheduleIiiHead` field
(Share Capital, Reserves and Surplus, Long/Short-Term Borrowings, Trade
Payables, Fixed Assets, Inventories, Trade Receivables, Cash and Cash
Equivalents, etc. — the full Division I catalogue, see
`lib/scheduleIII.ts`) and a new report that groups the existing Balance
Sheet figures into the real Schedule III hierarchy (Shareholders' Funds /
Non-Current Liabilities / Current Liabilities / Non-Current Assets /
Current Assets) instead of a flat Assets/Liabilities/Equity list. Every
shipped COA template got a sensible default classification (Cash → Cash
and Cash Equivalents, Trade Receivables/Payables → their own heads,
Inventory/Raw Materials/WIP/Finished Goods → Inventories, GST accounts →
Other Current Assets/Liabilities), backfilled onto every already-
provisioned org's accounts too (migration_017). Anything without a head —
including every EQUITY account, since **no Share Capital/Reserves template
exists at all today**, equity accounts are always manually created — shows
up under an explicit "Unclassified" bucket in the report rather than being
silently dropped, and Chart of Accounts now has an actual Edit capability
(it only had create + activate/deactivate before) so existing accounts can
be classified after the fact.

Statement of Profit and Loss in Schedule III format (Part II) isn't built
— this pass covers the Balance Sheet only.

Requires `db/migration_017_company_master.sql`.

## Foreign Currency Support (built)

First slice of the "Export/Import invoices" gap flagged after Company
Master — scoped down to just foreign-currency support on Sales Invoices
and Purchase Bills, with export/import-specific compliance fields (LUT/
bond vs. IGST-paid classification, shipping bill/bill of entry, GSTR-1
Table 6A) left for a later pass. Two decisions made upfront: exchange rate
is always manual entry (no live FX API/subscription dependency), and only
Sales Invoices + Purchase Bills get currency support for now — Journal
Entries and bank accounts stay INR-only (no foreign-currency bank/EEFC
accounts yet).

A fixed currency list (`lib/currencies.ts`, mirrored by hand in
`frontend/lib/types.ts` — same duplication convention as
`SCHEDULE_III_HEADS`): INR + USD/EUR/GBP/AED/SGD/JPY/AUD/CAD/CHF/CNY.
`currency` + `exchangeRate` on the invoice/bill header, `rateFc` (the unit
rate as entered, in that currency) on each line. The key design decision:
`rateFc * exchangeRate` gets computed into `rate` (INR) server-side
*before* any existing discount/tax/costing/journal-posting logic runs — so
none of that logic changed at all, and a foreign invoice/bill posts
exactly like a domestic one internally (correct in GSTR-1/GSTR-3B/ledgers/
Balance Sheet without any changes to those reports). `grandTotalFc` /
`lineTotalFc` are separate display-only fields (`round2(amount /
exchangeRate)`) shown alongside the INR figures on the create form, detail
view, and list — never read by anything else. Every domestic (INR)
invoice/bill is untouched — `currency` defaults to `"INR"`, `exchangeRate`
defaults to `1`, and the old `rate`-only code path runs exactly as before.

Known gaps, deliberately deferred: no forex gain/loss postings (there's no
invoice-to-payment settlement/allocation feature in this app at all yet, in
any currency, to anchor a realized-gain calculation to); no shipping bill/
bill of entry fields, customs duty, or GSTR-1 Table 6A yet — see LUT/Bond
Classification below for the piece of "Export/Import invoices" that is now
built; a `FLAT` invoice-level discount on a foreign Sales Invoice is still
entered in INR, not the invoice's currency.

Requires `db/migration_018_foreign_currency.sql`.

## LUT/Bond Export Classification (built)

Second slice of the "Export/Import invoices" gap — every foreign-currency
Sales Invoice now declares its export route: LUT (Letter of Undertaking),
Bond, or WPAY (With Payment of IGST, claimed back as a refund). LUT/BOND
are zero-rated by law, so the server rejects the invoice outright if any
line still carries a tax rate — a real compliance rule enforced server-
side, not just a UI default (the earlier UI default that resets tax to 0%
on a foreign line is still there and still the common case, but isn't what
actually prevents a bad post). LUT/BOND additionally require an ARN
(`lutBondNumber`) and date on the invoice.

Also fixed a real latent bug found while building this: the CGST+SGST vs.
IGST split (`isInterState()`) falls back to same-state (CGST+SGST) when
either side's GST state code is missing — reasonable for a domestic
partner with no GSTIN yet, wrong for a foreign customer, who essentially
never has one. Exports are always inter-state under GST law, so a
foreign-currency invoice now always forces the IGST split regardless of
what's on the customer record. Previously invisible because LUT/BOND
already zero-rates the line either way — only the WPAY path was actually
affected (would have posted a taxed export to CGST/SGST like a domestic
sale instead of IGST Output).

At the time this was built: shipping bill/port fields, GSTR-1 Table 6A
(exports) reporting, and the whole import side (bill of entry, customs
duty on Purchase Bills) were still open — all since built, see below.

Requires `db/migration_019_lut_bond.sql`.

## Shipping Bill / Bill of Entry (built)

Third slice of "Export/Import invoices" — the customs reference fields
GSTR-1 Table 6A will eventually need: shipping bill number/date/port code
on Sales Invoice, Bill of Entry number/date/port code on Purchase Bill.

The interesting decision here wasn't the fields themselves, it was *when*
they're captured. These documents essentially never exist yet at the
moment of posting — an export invoice gets raised before goods actually
ship, an import bill gets posted before customs clearance is done — so
requiring them at `POST` time would just block normal invoicing. They're
accepted optionally at creation (in case an org happens to have them
upfront) but the real mechanism is a new narrow `PATCH` endpoint on each
document, restricted to only these reference fields (plus LUT/Bond, on the
Sales Invoice side, in case that needs correcting later too). Deliberately
not a general invoice/bill edit capability — no amount, GST figure, or
journal entry is touched, so unlike a real edit there's nothing to
re-post or reverse. Sales Invoice and Purchase Bill still have no way to
edit anything else after posting.

Also fixed the same latent bug found while building LUT/Bond, this time on
the import side: `POST /purchase-bills` was still splitting foreign-vendor
tax into CGST+SGST instead of IGST when the vendor had no Indian state
code on file. Now forces `interState = true` for any foreign-currency
bill, matching the Sales Invoice fix.

At the time this was built: GSTR-1 Table 6A (exports) reporting itself —
these fields existed but nothing read them into a report yet — and the
rest of the import side (customs duty, IGST-on-import as ITC). Both since
built, see below.

Requires `db/migration_020_shipping_bill.sql`.

## GSTR-1 Table 6A — Exports (built)

The last piece the shipping bill fields were captured for: a foreign-
currency Sales Invoice now flows into its own Table 6A (Exports) table in
`computeGstr1`, instead of B2B/B2C. That reclassification mattered on its
own — before this, an export invoice fell into B2B or B2C purely based on
whether the foreign customer happened to have a GSTIN on file, which is
never actually correct; exports are a distinct category regardless.

One row per (invoice, tax rate), same convention B2B already uses.
`exportType` reports as WPAY (with payment of IGST) or WOPAY (LUT/Bond —
zero-rated), and the shipping bill number/date/port code come straight off
the invoice — showing "not added yet" in the UI table for any export that
hasn't had them filled in via the PATCH edit yet. Table 6A gets its own
subtotal (`exportsTotal`) entirely separate from the main B2B+B2C taxable-
value/tax totals, matching how the real return keeps them apart.

Also flagged, not fixed: GSTR-3B still doesn't split zero-rated exports
into their own 3.1(b) row — `computeGstr3b`'s outward-supplies figure
still lumps every Sales Invoice together regardless of currency.

No new migration for this piece — it only reads fields already added by
`db/migration_020_shipping_bill.sql`.

## Customs Duty / Import IGST as ITC (built)

The import side of the original "Export/Import invoices" scope. A foreign-
currency Purchase Bill line now takes an optional `customsDutyRate` (%
of that line's INR goods value). Basic Customs Duty is non-creditable —
it's never a GST account, it folds straight into landed inventory cost
(`unitCost` fed to `receiveStock` becomes goods value + duty per unit, so
FIFO/weighted-average costing carries the real landed cost forward). A
domestic bill, or a foreign bill with 0% duty entered, keeps the exact
same `unitCost` as before this feature — no behavioral change.

Import IGST was previously computed on goods value alone, which
understates it — under GST law it's charged on (goods value + duty).
`taxAmount` per line is now computed on that corrected base
(`lineSubtotal + customsDutyAmount`); for a domestic bill this collapses
back to `lineSubtotal` alone since duty is always 0 there.

Neither customs duty nor import IGST is actually owed to the foreign
vendor — both go to customs/government, typically via a clearing agent —
so a foreign bill's journal entry now splits the credit side instead of
crediting Trade Payables for the full `grandTotal`: **Trade Payables**
gets only `subtotal` (goods value), and a new **Customs Duty Payable**
account (`2105`) gets `customsDutyTotal + taxTotal`. The debit side
balances the same way — each item's stock account is debited
`lineSubtotal + customsDutyAmount` (the landed cost) instead of just
`lineSubtotal`. A domestic bill is entirely unaffected: `customsDutyTotal`
is always 0, so the split branch never fires and Trade Payables still
gets the full `grandTotal` in one line, exactly as before.

`PurchaseBill.grandTotal` is now `subtotal + taxTotal + customsDutyTotal`
(was `subtotal + taxTotal`) — again a no-op for domestic bills.
`grandTotalFc` (display-only) back-converts this new, larger figure.

GSTR-3B's ITC figure is unaffected in a way that actually matters here:
it reads `PurchaseBill.igstTotal` directly, which is now computed on the
correct (goods + duty) base — so the feature makes that number *more*
accurate, not less, without any change needed on the GSTR-3B side itself.

Requires `db/migration_021_customs_duty.sql`, then `npx prisma db seed` +
"Sync from Templates" (Chart of Accounts) for every already-provisioned
org, so the new 2105 Customs Duty Payable account exists before anyone
posts a foreign Purchase Bill with a nonzero duty or tax.

Still not built from the original "Export/Import invoices" scope: nothing
— both the export side (foreign currency, LUT/Bond, shipping bill,
Table 6A) and the import side (customs duty, IGST-as-ITC) are now covered.
Broader gaps that remain (not specific to exports/imports): GSTR-3B's
un-split 3.1(b) zero-rated row, no invoice-to-payment matching (so no
realized forex gain/loss), no "country" field on export invoices.

## Purchase Order Workflow (built)

The Purchase Order half of the "Sales Order / Purchase Order stage" gap
flagged at the top of this doc. A `PurchaseOrder` is a pre-commitment
document with its own approval state machine, entirely separate from
posting — it never touches the journal or stock. Only once it's
**Approved** can it be turned into one or more Purchase Bills, which still
does every bit of the real accounting/stock work exactly as it always has.
Direct Purchase Bill creation (no PO) is completely unaffected — a PO is
opt-in, not a new required step.

State machine: `DRAFT` (freely editable — the first true draft/edit-before-
commit document this app has; every other document type here is either
post-once-immutable or has only a narrow reference-field PATCH) → *submit* →
either `APPROVED` automatically or `PENDING_APPROVAL`, depending on the
org's approval threshold → *approve*/*reject* → `APPROVED`/`REJECTED`.
`REJECTED` → *reopen* → back to `DRAFT`, editable and resubmittable — the
rejection reason stays on the record as history rather than being cleared.
`DRAFT`/`PENDING_APPROVAL`/`APPROVED` (only if nothing's been billed yet)
→ *cancel* → `CANCELLED`. `APPROVED` → (every line fully billed) →
`CLOSED`, automatically, the moment a Purchase Bill posting satisfies the
last open line.

**Approval authority is amount-based**, chosen over a flat "anyone with a
permission can approve" or a full multi-level approval chain, to actually
resemble real purchasing controls without building infrastructure this app
has no other use for. `Organization.poApprovalThreshold` (set on the
Company Master screen) is null by default — meaning *every* submitted PO
requires manual approval regardless of amount, the safe default until an
org configures otherwise. Once set, a PO whose `grandTotal` is strictly
below the threshold auto-approves on submission (recorded with
`autoApproved: true` for the audit trail); at or above it, a human with the
new `purchase.approve` permission has to decide. `purchase.approve` is
deliberately **not** in ACCOUNTANT's default permission set — separation
of duties: the same role that creates and posts Purchase Orders/Bills
shouldn't also approve them by default. Owner/Admin get it out of the box;
an org that wants a non-Owner approver grants `purchase.approve` to a
custom role instead (Settings → Access Control).

**Billing with quantity tracking.** `POST /purchase-bills` takes an
optional `purchaseOrderId` — when present, the vendor is *derived* from
the (approved) PO rather than taken from the request, so a bill can never
post against a different vendor than the one the PO was approved for. Each
bill line can separately carry a `purchaseOrderLineId` to say which
ordered line it fulfills; the server rejects (400) any attempt to bill more
than what's still open on that line (`ordered − already billed` across
every prior bill against the same PO line), so a PO can be split across
several partial deliveries/bills without ever over-billing. Every line's
`billedQuantity` rolls forward in the same transaction as the bill post,
and the PO auto-closes the moment every line is fully billed. The Purchase
Bill create form's "From Purchase Order" picker (INR bills only — see
below) pre-fills the vendor and every still-open line, quantity capped to
what's remaining, so raising a bill against an order is a couple of clicks
rather than re-keying it.

**Scope decisions, deliberate:**
- **PO is INR-only.** No currency/exchange-rate concept on `PurchaseOrder`
  yet, unlike Purchase Bill's foreign-currency support — an import PO would
  need that carried through to the eventual bill, which is real scope this
  pass didn't take on. The "From Purchase Order" picker on Purchase Bill is
  hidden once the bill's currency is switched to foreign, and linking a PO
  forces the bill back to INR.
- **No GST account split (CGST/SGST/IGST) on PurchaseOrder** — since a PO
  never posts to the journal, only an aggregate `taxTotal`/`grandTotal` is
  computed; the real CGST/SGST/IGST split happens the normal way once it
  becomes a Purchase Bill.
- **Line replacement, not diffing, on edit.** `PATCH /purchase-orders/:id`
  (Draft only) replaces every line wholesale rather than diffing — same
  "nothing in this app diffs individual lines on edit" convention as
  everywhere else that's ever had partial edit capability.

Also fixed in passing, found while wiring the PO-linked billing path: a
pre-existing bug in `POST /purchase-bills` where per-line validation
failures (bad quantity, invalid item, etc.) threw outside the route's only
try/catch, so they fell through to the generic 500 handler in `index.ts`
instead of the intended 400 with the actual validation message. Now
properly caught and returns the real error.

Requires `db/migration_022_purchase_orders.sql`. No new GL accounts, no
`prisma db seed` step needed — a Purchase Order never posts.

**PDF export.** `GET /purchase-orders/:id/pdf` renders the PO as a formal,
downloadable document (`lib/purchaseOrderPdf.ts`), built with `pdfkit`
(pure JS, no headless-browser dependency, so it runs in any Node
container — chosen over `puppeteer` for reliability on Railway) rather
than an HTML→PDF renderer. Layout: company header (name, registered
office address, CIN, branch GSTIN), PO number/date/expected-delivery/
status, side-by-side Vendor/Deliver-To boxes, a paginated line-items
table (Item, HSN, Qty, UOM, Rate, Tax%, Amount), totals, the narration as
notes, and a signature block. Deliberately plain and single-column — no
logo or letterhead template, since `Organization` has no logo field;
good enough to send to a vendor, a branded template is future scope. The
"Download PDF" button lives on the PO detail screen's header
(`app/purchase/orders/page.tsx`), next to Close, for every status (a
vendor may want the document at any stage, not just once Approved).
Adds `pdfkit`/`@types/pdfkit` as new dependencies — the next Railway
deploy needs a fresh `npm install` before `npm run build` will succeed.

## Goods Receipt Note (built)

A real 3-way match: PO -> GRN -> Bill. Before this, `POST /purchase-bills`
was the only thing that ever moved stock in the PO-linked path — a bill
was simultaneously "the vendor invoiced us" and "the goods arrived,"
which don't actually happen at the same time in a real warehouse.
`GoodsReceiptNote` now owns physical receipt: it's the thing that calls
`receiveStock` (`lib/costing.ts`) — quantityOnHand/StockLot update the
moment goods are checked in, independent of when the vendor's invoice
shows up. A Purchase Bill linked to a PO no longer moves stock itself;
it bills against what a GRN already received.

**Scope decision, deliberate: this only applies to the PO-linked
path.** An ad-hoc Purchase Bill with no `purchaseOrderId` — still the
majority of purchases in this app, since a PO was always opt-in — is
completely unaffected and keeps moving its own stock exactly as it did
before this feature existed. Requiring a GRN for every purchase would
have been a real regression for anyone not using the PO workflow. The
branch is explicit in `routes/purchaseBills.ts`: `if (!linkedPo) { ...
receiveStock ... }` vs. a PO-linked bill, which never calls it.

**GRN posts immediately, no workflow of its own.** Create-and-post in
one step, the same UX as a Purchase Bill — there's no draft/approval
state machine on `GoodsReceiptNote` itself, because the real approval
gate already happened at the PO stage (only an `APPROVED` PO can receive
against). `purchase.receive` (new permission) is deliberately separate
from `purchase.post` — it's the "goods physically arrived, someone at
the dock checked them in" action, conceptually closer to
`inventory.post` than to billing. ACCOUNTANT gets it by default (unlike
`purchase.approve`, which stays a financial control point) since it's
operational, not a segregation-of-duties boundary.

**Two parallel running totals, tracked separately.**
`PurchaseOrderLine.receivedQuantity` (new) is the real stock-in signal,
incremented by `routes/goodsReceiptNotes.ts`, never exceeding the
ordered `quantity`. `PurchaseOrderLine.billedQuantity` (existing) is the
financial side, still incremented by `routes/purchaseBills.ts`, and
still what triggers the PO's automatic `CLOSED` transition once every
line is fully billed — unchanged trigger, since billed ≤ received ≤
ordered transitively, so "fully billed" still implies "fully received."
`GoodsReceiptNoteLine.billedQuantity` (new, line-scoped) is the actual
3-way-match enforcement point: a Purchase Bill line referencing a
`goodsReceiptNoteLineId` can't bill more than that specific GRN line's
`quantityReceived − billedQuantity`, not just the PO line's aggregate
figures — important once a PO line has been split across multiple
partial GRNs, where the PO-line rollup alone can't tell you which
receipt still has room.

**Purchase Bill's PO-linkage changed shape.** A bill line used to
reference a `purchaseOrderLineId` directly; it now references a
`goodsReceiptNoteLineId`, and the `purchaseOrderLineId` it fulfills is
derived server-side from that GRN line, never taken from the request.
Every line on a PO-linked bill is now required to carry one — raise a
GRN first. The Purchase Bill create form's "From Purchase Order" picker
(`app/purchase/bills/page.tsx`) reflects this: linking a PO now fetches
that PO's Goods Receipt Notes and pre-fills one bill line per open GRN
line (received, not yet billed), rather than one line per open PO line.

**Cost basis, deliberate:** a GRN line's `unitCost` is carried straight
from the PO line's own `rate` — a GRN doesn't introduce a new price, it
just confirms quantity physically arrived. Any real price variance
discovered when the invoice actually comes in is a Purchase Bill/vendor
concern, out of scope here (this app doesn't have a price-variance
account or workflow at all yet).

**PO cancellation** now also blocks if anything's been received (not
just billed) — a PO with a GRN against it has real stock movement
behind it and can't be cancelled out from under it, same reasoning as
the existing billed-quantity guard.

Requires `db/migration_023_goods_receipt_notes.sql`. No new GL accounts
and no `prisma db seed` step — a GRN posts stock movements
(`StockMovement`/`ItemStock`/`StockLot`), never a journal entry. No new
dependencies either (unlike the PDF feature above).

## 3-Way Match & Purchase Bill Approval (built)

Completes the PO -> GRN -> Bill chain with the piece that actually makes
it a *match*, not just a chain of references: a Purchase Bill line's rate
is checked against its Purchase Order line's rate, and a real approval
gate sits in front of posting when they disagree.

**Quantity was already a hard match (from the GRN feature above) — this
adds price, and makes it soft.** A bill can never bill more than a GRN
line actually received; that's an unconditional 400, no override. Price
is different: a vendor's invoice legitimately might not match the PO to
the last paisa (a small negotiated adjustment, a rounding difference), so
rather than hard-blocking it, a rate that varies from the PO by more than
`Organization.priceVarianceTolerancePct` holds the *whole* bill at
`PENDING_APPROVAL` instead of posting it — nothing partially posts.
Someone with `purchase.approve` (the same permission that already
approves Purchase Orders — reused rather than adding a second one, since
both are "sign off on a financial commitment" gates) then approves it
through or rejects it. Tolerance null means 0%: any variance at all needs
approval, the same "null = most cautious" default used everywhere else in
this app (`poApprovalThreshold`, GRN's own PO-required scoping). An org
that wants routine rounding differences to pass silently sets a tolerance
on the Company Master screen.

**Posting is fully deferred, not just gated.** A `PENDING_APPROVAL` bill
has no journal entry (`journalEntryId` is now nullable), no stock
movement (it was always PO-linked, so it never called `receiveStock`
anyway), and no `billedQuantity` impact on either the `PurchaseOrderLine`
or the `GoodsReceiptNoteLine` it references — none of that happens until
`POST /purchase-bills/:id/approve`. This means a pending bill is
completely invisible to every financial report (Trial Balance, Ledger,
P&L, Balance Sheet, GSTR-1/3B) exactly the way an unposted document
should be, since those all derive from `journal_entries`/`journal_lines`,
which a pending bill hasn't touched. Approving reconstructs the exact
same journal entry `POST /purchase-bills` would have created immediately
had it matched — from the bill/line data already stored, not recomputed
from a request body that's long gone — via a shared `buildBillJournalLineRows`
helper used by both the immediate-post and deferred-approve paths, so
there's exactly one place that knows this journal's shape.

**Rejecting is terminal.** This app has no bill-edit capability at all
(unlike Purchase Order, which is explicitly a draft-editable document) —
a rejected bill just sits as a record with a reason; the fix is to raise
a corrected bill, not to reopen this one. Nothing needs undoing either,
since a pending bill never posted anything in the first place.

**Approval re-validates the GRN quantity limit, not the price.** Between
a bill being created and later approved, another bill against the same
GRN line could have been approved first, eating into the headroom this
one assumed. `POST /:id/approve` re-checks `billedQuantity` vs.
`quantityReceived` on every referenced GRN line and 400s if it would now
be exceeded — the approver has to reject and let a corrected bill be
raised instead. The price variance itself is never re-checked at approval
time, since approving *is* the override for that.

**Two bugs found and fixed while wiring this in**, both about a bill that
exists in the `purchase_bills` table but was never actually posted:
- `POST /purchase-returns` and `GET /purchase-returns/bill/:billId/lines`
  didn't check bill status at all — a Pending Approval or Rejected bill
  (no stock movement, no Trade Payables impact) could have had a return
  raised against it, reversing money and stock that never existed. Both
  now require `status === "POSTED"`.
- `computeGstr3b`'s Purchase Bill aggregate had no status filter either —
  a Pending Approval bill's `cgstTotal`/`sgstTotal`/`igstTotal` would have
  inflated the ITC claimed in GSTR-3B before the bill ever actually
  posted. Now scoped to `status: "POSTED"` only.

Requires `db/migration_024_bill_approval.sql`. No new GL accounts, no
`prisma db seed` step, no new dependencies.

## Sales Order Workflow + Delivery Note (built)

The sales-side mirror of Purchase Order -> Goods Receipt Note -> Purchase
Bill, built the same way in one pass: `SalesOrder` (a pre-commitment/
approval document, never touching the journal or stock) -> `DeliveryNote`
(the real stock-out event, calls `consumeStock`) -> `SalesInvoice`
(optionally SO-linked, with a 3-way quantity match against the Delivery
Note). Every design decision here is a deliberate, one-for-one mirror of
the already-shipped purchase-side feature — see the "Purchase Order
Workflow", "Goods Receipt Note", and "3-Way Match & Purchase Bill
Approval" sections above for the reasoning; this section only calls out
where the sales side needed its own choice.

**Sales Order status state machine, identical to Purchase Order's:**
`DRAFT` -> submit -> `APPROVED` (auto, when `Organization.soApprovalThreshold`
is set and this SO's `grandTotal` is strictly below it) or
`PENDING_APPROVAL` -> approve/reject (`sales.approve`, new permission,
deliberately excluded from ACCOUNTANT's default set — same
separation-of-duties reasoning as `purchase.approve`) -> `APPROVED`/
`REJECTED`. `REJECTED` -> reopen -> `DRAFT` (history kept). Cancel blocks
if anything's been delivered or billed. Auto-`CLOSED` once every line is
fully invoiced. `soApprovalThreshold` follows the same "null = always
require manual approval" convention as `poApprovalThreshold`.

**Delivery Note moves stock, not the journal — same split as GRN, but
calling the other half of `lib/costing.ts`.** A GRN calls `receiveStock`;
a Delivery Note calls `consumeStock`. Only meaningful against an
`APPROVED` Sales Order (customer/branch both derived from the SO, never
the request); posts immediately on creation, no workflow of its own,
since the real approval gate already happened at the SO stage. New
permission `sales.deliver` mirrors `purchase.receive` exactly —
operational, not a control point, so ACCOUNTANT gets it by default.
`SalesOrderLine.deliveredQuantity` (new) is the real stock-out signal,
capped at ordered qty; `SalesOrderLine.billedQuantity` (existing pattern)
is the separate financial rollup that still drives SO auto-close;
`DeliveryNoteLine.billedQuantity` (new, line-scoped) is the actual 3-way
match enforcement point on the eventual invoice.

**One genuine asymmetry with GRN, and it's why `DeliveryNoteLine` carries
both a `rate` and a `unitCost`.** A GRN's `unitCost` is an *input* to
`receiveStock` (the price at which stock is valued coming in — carried
straight from the PO line's rate). A Delivery Note's stock movement runs
the other direction: `consumeStock` *computes* the cost of what's leaving
(FIFO/weighted-average, whatever the org's costing method says) and
returns it — there's nothing to input. `DeliveryNoteLine.unitCost` stores
that returned figure so the eventual SO-linked Sales Invoice line can
reuse the exact same cost for its COGS journal debit instead of calling
`consumeStock` a second time, which would double-consume the same units of
stock. `DeliveryNoteLine.rate`, separately, is descriptive only — carried
in from the SO line's own selling price, purely so the Delivery Note (and
the invoice-line pre-fill) has a sensible number to show; it's never what
the invoice is forced to bill at.

**Sales Invoice's SO-linkage mirrors Purchase Bill's PO-linkage exactly,
one line at a time.** A line on an SO-linked invoice carries a
`deliveryNoteLineId` (not a `salesOrderLineId` — that's derived
server-side from the DN line, same as `purchaseOrderLineId` is derived
from `goodsReceiptNoteLineId` on a Purchase Bill line), and can't invoice
more than that DN line's `quantityDelivered − billedQuantity` — the hard,
unconditional 3-way quantity match. `consumeStock` is never called for
these lines (the Delivery Note already moved that stock); the journal
entry's Dr Cost of Goods Sold / Cr stock-account lines use the DN line's
captured `unitCost` instead. Everything else about a Sales Invoice — GST
split, discounts, foreign currency/LUT-Bond/export classification — is
completely unaffected by SO-linkage, same as customs duty/Bill-of-Entry
fields are unaffected by PO-linkage on the purchase side.

**Scope decision, deliberate: no price-variance/approval workflow on the
Sales Invoice side in this pass.** The purchase side got a second feature
(3-Way Match & Purchase Bill Approval, above) layered on top of GRN in a
later request; the sales-side equivalent — checking an SO-linked invoice
line's rate against the SO's own rate and holding the invoice for approval
on a mismatch — was not asked for here and hasn't been built. An SO-linked
invoice line's `rate` is freely entered (or pre-filled from the SO/DN's
rate, freely overridable), with no variance check against it at all. A
natural follow-up if/when needed, mirroring the purchase-side design
exactly.

**Scope decision, deliberate, matching Purchase Order's own simplification:**
`SalesOrder`/`SalesOrderLine` stay INR-only with an aggregate tax rate per
line — no discount concept, no foreign-currency/export classification, no
GST CGST/SGST/IGST split stored on the order itself. A Sales Invoice
raised against an SO can still carry its own discount (an invoice-time
pricing decision, independent of the order) and computes its own full GST
split as always; only currency is disabled when SO-linked (Sales Orders
don't carry a currency/exchange-rate concept yet, mirroring why a Purchase
Order can't be linked to a foreign Purchase Bill).

Requires `db/migration_025_sales_orders.sql`. No new GL accounts and no
`prisma db seed` step — a Sales Order never posts to the journal, and a
Delivery Note posts stock movements only, never a journal entry. No new
dependencies.

**PDF export — Sales Order and Sales Invoice (built).** The sales-side
mirror of the Purchase Order PDF above, same `pdfkit` approach (no new
dependency — already added for the PO PDF), one route each: `GET
/sales-orders/:id/pdf` (`lib/salesOrderPdf.ts`) and `GET
/sales-invoices/:id/pdf` (`lib/salesInvoicePdf.ts`). No extra permission
beyond viewing the document — a read/export action, not a workflow
transition.

The Sales Order PDF is a byte-for-byte layout mirror of the Purchase Order
one — CUSTOMER replaces VENDOR, the second box is the org's own issuing
branch (labelled "FROM BRANCH", since nothing is "delivered to" from the
seller's side), title reads "SALES ORDER".

The Sales Invoice PDF is a different document in kind, not just naming —
a Purchase Order/Sales Order is a pre-commitment record, but a posted
Sales Invoice is a legal GST "Tax Invoice," so `salesInvoicePdf.ts` surfaces
what the other two don't: a Supply Type line (Inter-State/IGST vs.
Intra-State/CGST+SGST, decided the same way the invoice detail screen
already does — an export is always inter-state, otherwise by whether any
IGST actually posted), a line-item table whose tax columns switch between
one IGST column or two CGST/SGST columns depending on that supply type
(never both, matching GST law), a Taxable Value column (post-discount,
what GST is actually computed on), a Discount line in the totals block,
and — only for a foreign-currency export invoice — an export-declaration
block (LUT/Bond/With-Payment-of-IGST classification, LUT/Bond number and
date, shipping bill and port code once filled in) plus a foreign-currency
equivalent grand total. When the invoice is SO-linked, the PDF also shows
"Against Sales Order: SO-00xx".

Both "Download PDF" buttons live on their respective detail screen's
header (`app/sales/orders/page.tsx`, `app/sales/invoices/page.tsx`), next
to Close, same placement/pattern as the Purchase Order one.

## Currency Master (built)

Effective-dated FX rates, real per-org master data with its own bulk
upload — layered on top of the existing fixed currency code/symbol/name
list in `lib/currencies.ts`, which stays exactly as it was (display
metadata only, not something worth making DB-backed). What's new is
`CurrencyRate`: `(organizationId, currencyCode, effectiveFrom)` unique, so
the same currency code can carry any number of rows, one per date it
takes effect from — the same "history of independent point-in-time
facts" shape as an opening balance, not a single mutable "current rate"
field. `rate` keeps the exact meaning `SalesInvoice.exchangeRate` /
`PurchaseBill.exchangeRate` already use ("1 unit of currencyCode = rate
INR").

**Deliberately not a foreign-key target anywhere.** A posted Sales
Invoice/Purchase Bill still snapshots its own `exchangeRate` number
directly at posting time, exactly as it did before this feature existed
— nothing points back at a `CurrencyRate` row. This table exists purely
so the create-invoice/bill form doesn't have to be typed by hand every
time: `GET /currency-rates/lookup?currencyCode=&date=` returns the most
recent rate with `effectiveFrom <= date` (or `null` if nothing's been
entered yet, which never blocks the form — the field is still a plain,
freely-editable number either way). Both `app/sales/invoices/page.tsx`
and `app/purchase/bills/page.tsx` call this lookup in a `useEffect` keyed
on `[currency, invoiceDate/billDate]` and pre-fill Exchange Rate the
moment a foreign currency + date are both selected — a genuine
convenience, not a new validation rule.

**CRUD + bulk upload, same shape as every other master entity in this
app.** New `currency.manage` permission (OWNER/ADMIN by default, same
tier as `coa.manage`/`items.manage`/`company.manage` — not given to
ACCOUNTANT). `routes/currencyRates.ts` follows the exact
list/create/patch/delete pattern `routes/items.ts` established, plus the
same three-route bulk-upload shape (`GET .../bulk-upload/template`,
`POST .../preview`, `POST .../apply`) built on the shared
`lib/xlsxTemplate.ts`/`useBulkUpload` hook — matching an uploaded row to
an existing rate by the `(Currency Code, Effective From)` natural key,
same idea as Items matching by SKU. `DELETE` is a genuine hard delete
(not the soft-delete-via-`deletedAt` convention Item/BusinessPartner
use) — safe here specifically because nothing references a rate row by
foreign key, so there's no history that would be lost.

New `app/settings/currency-master/page.tsx` (Configuration nav group,
next to Company Master): create form, an inline-editable list (rate only
— currency/date are locked after creation, edit by deleting and
recreating), and the shared bulk-upload buttons/panel.

Requires `db/migration_026_currency_master.sql`. No new GL accounts, no
`prisma db seed` step, no new dependencies.

## From the earlier "what's next" review

Flagged as gaps before Sales/Purchase/Inventory was chosen as the next
priority; still open.

- **Invoice-level payment/receipt matching.** Today a customer/vendor
  payment is just a plain Journal Entry (`BV`/`CV`, posted via `POST
  /journal`) whose only link to the customer/vendor is the shared
  `businessPartnerId` tag on the Trade Receivables/Payables line — it nets
  against that party's overall running balance in the Ledger report, with no
  allocation to a specific Sales Invoice or Purchase Bill. So there's no
  per-invoice paid/partial/outstanding status and no invoice-level aging
  report, only an overall customer/vendor balance. When built: a dedicated
  Receipt/Payment document tied to one or more specific Sales
  Invoices/Purchase Bills, each allocation capped at what's still owed on
  that document — structurally similar to how Sales Return/Purchase Return
  are tied to and capped against their original documents.

- **FY Closure.** Year-end closing entries — carry forward account
  balances into the new financial year, lock the prior year against further
  posting. SmartAppt has this as a dedicated flow (`fy_closure` in its
  mobile/web menu catalogue); SmartERP doesn't have an equivalent yet.

- **Real email/SMS provider.** OTP (`/auth/register`) and team invites
  (`/org/users/invite`) currently expose the code/link directly in the API
  response (`devOtp`, `devInviteToken`, gated by `EXPOSE_DEV_OTP`) because
  no provider is wired up. Needs a real provider (e.g. SendGrid/Twilio)
  before anyone but the founding team uses this in production.

## Already resolved (kept for context)

- **Platform admin / superuser** — was a monitoring-only screen (org list,
  binary subscription toggle); rebuilt to match SmartAppt's `SUPER_USER`
  pattern (full RBAC + entitlement bypass, drill into any org's data,
  hard-delete with guardrails, per-module subscription console). Done.
- **Access control configuration** — per-role sidebar visibility, editable
  per org (OWNER/ADMIN, minus their own role) and by a platform admin (all
  four roles). Done.
