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
  waits until direct invoicing is proven out.

- **Inter-branch Stock Transfer.** Moves quantity between branches without
  touching accounting the way a sale or purchase does (same org's
  inventory, no P&L impact) — its own document type, not a variant of
  Adjustment.

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

- **Voucher attachments.** Attach a scanned bill/receipt image or PDF to a
  Journal Entry / Sales Invoice / Purchase Bill.

- **Real email/SMS provider.** OTP (`/auth/register`) and team invites
  (`/org/users/invite`) currently expose the code/link directly in the API
  response (`devOtp`, `devInviteToken`, gated by `EXPOSE_DEV_OTP`) because
  no provider is wired up. Needs a real provider (e.g. SendGrid/Twilio)
  before anyone but the founding team uses this in production.

- **GST returns / compliance.** GSTIN is already captured (Business
  Partners, Branches, domain onboarding), but nothing computes GSTR-1 or
  GSTR-3B from posted transactions yet.

## Already resolved (kept for context)

- **Platform admin / superuser** — was a monitoring-only screen (org list,
  binary subscription toggle); rebuilt to match SmartAppt's `SUPER_USER`
  pattern (full RBAC + entitlement bypass, drill into any org's data,
  hard-delete with guardrails, per-module subscription console). Done.
- **Access control configuration** — per-role sidebar visibility, editable
  per org (OWNER/ADMIN, minus their own role) and by a platform admin (all
  four roles). Done.
