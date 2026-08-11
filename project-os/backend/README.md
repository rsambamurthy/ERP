# Project OS Backend

Node/Express/Prisma/PostgreSQL, deliberately mirroring SmartERP
backend's own conventions (see `../../backend/README.md` in this
workspace) — same `src/db.ts` Prisma-singleton pattern, same
`middleware/auth.ts` JWT-bearer shape, same `express-async-errors`
setup — but a fully separate app: separate database, separate
dependency tree, no imports across the boundary.

## Scope (R1 — Pilot)

See `../../prd-r1-pilot.docx`. Built so far:

- **Schema** — every R1 entity from the PRD's Section 8, plus the
  Synced* read-only mirror tables for Section 9.1 and the
  `smartErpExternalId`/`smartErpSyncStatus` tracking fields Section 9.2's
  shadow-PO decision needs.
- **Auth** — `POST /auth/register` (creates Organization + first User as
  SUPER_ADMIN + seeds the five default cost categories), `POST
  /auth/login`, JWT-bearer `authenticate` + `requireRole` middleware.
- **Projects** — real CRUD (`GET/POST /projects`, `GET/PATCH
  /projects/:id`), scoped to the caller's organisation, role-gated per
  the Section 10 roles matrix. The full lifecycle state machine
  (Appendix A of the blueprint) is not enforced yet — any status value
  is accepted; validating legal transitions is a natural next step.
  `POST/GET /projects/:projectId/sites` create/list Project Sites (no
  update/delete route in R1) — added alongside Inventory since a
  PROJECT_SITE stock location needs a `projectSiteId` to point at.
- **BOQ & Estimation** (Section 6.3) — versioned, append-only BOQ per
  project (`POST /boq/project/:projectId`); Excel import via the same
  template/preview/apply three-route shape SmartERP's own bulk-upload
  screens use (`GET/POST /boq/:boqId/import/...`), plus a single-line
  manual-add endpoint; approval (`POST /boq/:boqId/approve`) that
  supersedes whichever version was previously approved; per-line
  Estimate cost breakdown (`PUT /boq/lines/:lineId/estimate`).
  Item matching against `SyncedItem` degrades gracefully to "unmatched"
  since the sync job (#118) doesn't exist yet — nothing blocks on it.
- **Budget** (Section 6.3) — `POST /budget/project/:projectId/generate`
  aggregates an approved BOQ's line *Estimates* (material/labour/
  subcontract/overhead cost, not the line's billing amount — see the
  comment in `routes/budget.ts` for why that distinction matters) into
  versioned, DRAFT budget rows; `PATCH /budget/:budgetId/approve` is the
  separate Project-Manager approval step the PRD calls for.
- **Cost categories** — `GET /cost-categories` lists the five seeded at
  registration (no create/edit route in R1).
- **Procurement** (Section 6.4) — Material Request (create + PM
  approval), RFQ against a supplier panel, per-supplier Quotation entry
  and selection, Purchase Order creation (from a selected quotation or
  directly) with project-threshold auto-approve/PENDING_APPROVAL and a
  non-blocking "ordered qty exceeds BOQ requirement" warning, PM
  approval. Project OS owns the PO per the Section 9.2 decision — no
  SmartERP push yet, that's task #118.
- **Manual master-data fallback** (`/integration/synced-suppliers`,
  `/integration/synced-items`) — Procurement can't function without at
  least one Supplier and one Item, and the real sync job (#118) doesn't
  exist yet. These let a SUPER_ADMIN create placeholder records locally
  (`externalId` is a freshly generated UUID, not a real SmartERP one) so
  the flow is testable now. Meant to be superseded by #118, not to
  coexist with it long-term.
- **Inventory / GRN** (Section 6.5) — Stock Locations (`POST/GET
  /inventory/locations`, WAREHOUSE or PROJECT_SITE); Goods Receipt
  (`POST /inventory/receipts`) — mirrors SmartERP's own
  `goodsReceiptNotes.ts` validation shape: requires the PO be APPROVED or
  PARTIALLY_RECEIVED, combines same-line quantities on one receipt before
  checking against what's actually still outstanding, creates a RECEIPT
  `StockLedgerEntry` per line, increments
  `PurchaseOrderLine.receivedQuantity`, and recomputes the PO's status
  (`PARTIALLY_RECEIVED` vs `CLOSED`) from all its lines, not just this
  receipt's — all inside one transaction. Stock on hand (`GET
  /inventory/stock`, filterable by `locationId`/`itemId`) is the signed
  sum of ledger entries (RECEIPT/TRANSFER_IN/RETURN = +,
  TRANSFER_OUT/ISSUE = −), computed on read rather than a maintained
  running balance. Transfer (`POST /inventory/transfers`) writes a paired
  TRANSFER_OUT/TRANSFER_IN with a shared `referenceId`, checked against
  available stock first. Issue (`POST /inventory/issues`) checks
  available stock and, when given an `activityId`, also writes a
  `MaterialConsumption` row in the same call — one action updating both
  stock and site consumption, per the blueprint's "one entry, many
  outcomes" principle. Return (`POST /inventory/returns`) is a plain +
  entry with no prior-issue check (see the code comment — a known R1
  simplification, not an oversight).

- **Activity create/list** (`POST/GET /execution/activities/project/:projectId`)
  — pulled forward out of Site Execution scope because Inventory's issue
  endpoint can link to an `activityId`; there was no way to create one
  otherwise. Progress entry and material-consumption reporting remain
  unbuilt (Section 6.6).
- **SmartERP integration** (Section 9) — `POST/GET /integration/connection`
  stores the org's SmartERP API key (generated on the SmartERP side via
  `POST /integration/connections` — new routes in `../../backend/src/routes/`:
  `integrationConnections.ts` for key management, `integrationApi.ts` for
  the master-pull/shadow-push surface itself, `../../backend/src/middleware/serviceAuth.ts`
  for the API-key auth those use instead of a user JWT);
  `POST /integration/sync` pulls Business Partners, Items, and Branches
  and upserts them into `SyncedBusinessPartner`/`SyncedItem`/`SyncedBranch`
  by `externalId` (full-table sync every time, not incremental — see the
  code comment on why). `lib/smartErpPush.ts` pushes an APPROVED Purchase
  Order to SmartERP as a pre-approved shadow PO (Section 9.2's "Project OS
  owns the PO" decision) — fired automatically right after approval, both
  the auto-approve-below-threshold path in `POST /procurement/purchase-orders`
  and `PATCH /procurement/purchase-orders/:id/approve` — and pushes a
  Receipt as a shadow GRN the same way, fired from
  `POST /inventory/receipts`. Both pushes are best-effort and
  non-blocking: a SmartERP outage never rolls back or blocks the local
  approval/receipt, it just leaves `smartErpSyncStatus` as `FAILED` or
  `SKIPPED` (with `smartErpSyncError` explaining why) on the
  PurchaseOrder/Receipt row, retryable via
  `POST /procurement/purchase-orders/:id/push-to-smarterp` and
  `POST /inventory/receipts/:id/push-to-smarterp`.

Everything else — progress records, cost visibility — is mounted as a
stub router (`501 Not Implemented`, pointing at the relevant PRD section)
so the route surface is discoverable rather than silently missing.

**Known gap in the sync**: a `SyncedBusinessPartner`/`SyncedItem` created
through the manual fallback (`POST /synced-suppliers`, `/synced-items`,
still available for orgs with no SmartERP connection) carries a
locally-generated `externalId` with no relationship to SmartERP's real
one. Running `POST /integration/sync` after using the fallback creates
*new* rows alongside those rather than reconciling them — the "local,
unlinked" scenario flagged in the earlier Business-Partner-creation-flow
diagram as needing a reconciliation UI. Not built; don't mix the two
paths for the same org in the pilot.

## Not built yet (tracked, not silently missing)

- SmartERP master-data sync job (Section 9.1)
- SmartERP shadow-PO / GRN push (Section 9.2) — also requires new
  SmartERP-side API surface, see the PRD's Section 9.2 and Section 14
  Risks. Inventory's `Receipt`/`StockLedgerEntry` rows carry
  `smartErpExternalId`/`smartErpSyncStatus` fields ready for this, but
  nothing writes to them yet.
- Site progress records (`ProgressRecord`) — route file (`execution.ts`)
  exists and is mounted, returns a placeholder. `MaterialConsumption` is
  written (from Inventory's issue endpoint when given an `activityId`)
  but there's no route to read progress back yet.
- Stock ledger balance is computed on every read (sum the row set), not
  maintained as a running total — fine at pilot volume, would need
  revisiting before scale.
- Frontend
- Project lifecycle state-machine validation on `PATCH /projects/:id`
- BOQ's "Validated" status is currently unreachable — Draft -> Imported
  -> Approved is the real path; a distinct manual validation step
  wasn't built
- Estimate has no separate approval step yet (the schema's
  `approvalStatus` field exists but nothing sets it beyond `DRAFT`)
- Material Request's `PARTIALLY_ORDERED`/`FULFILLED`/`CLOSED` states are
  unreachable — nothing updates MR status once an RFQ is raised against
  it, so it sits at `APPROVED` indefinitely. Same for RFQ's `CLOSED`.
- The "PO rate exceeds estimate" risk control (Section 6.4.1) isn't
  built — only "PO quantity exceeds BOQ requirement" is, and only as a
  non-blocking warning, not an override-with-reason workflow

## JWT payload change

Tokens issued before this session's Procurement work don't carry
`orgUserId` (added so `approvedByOrgUserId`/`requestedByOrgUserId` audit
fields reference the right table). Old tokens still authenticate fine —
`orgUserId` just comes back `undefined`, so those fields silently stay
unset rather than erroring. Log in again to get a token with it
populated.

## Verified

`npm install`, `npx prisma migrate dev --name init` and `npm run dev`
have been run against a real local Postgres (Docker). Exercised live end
to end: `POST /auth/register`, `POST /auth/login`, `GET /projects`,
`POST /boq/project/:id`, `POST /boq/:id/lines`, `POST /boq/:id/approve`,
`POST /budget/project/:id/generate`, `GET /cost-categories`, the full
Procurement chain (MR → RFQ → Quotation → PO → Approval), and the full
Inventory chain: `POST /projects/:id/sites`, `POST /inventory/locations`
(both WAREHOUSE and PROJECT_SITE), `POST /inventory/receipts` (partial
receipt, PO correctly moved to `PARTIALLY_RECEIVED`), the over-receipt
guard (409 with remaining-quantity message), `GET /inventory/stock`,
`POST /inventory/transfers`, the over-issue guard, `POST
/execution/activities`, `POST /inventory/issues` with an `activityId`
link, and `POST /inventory/returns` — with running stock balances
verified by hand against the full ledger at each step.

Three real bugs were caught this way and fixed, not just theoretical
review comments: (1) lines could be added to an already-`APPROVED` BOQ,
silently breaking the "approved version is a locked baseline" guarantee
— now blocked with a 409; (2) budget generation originally summed
`BoqLine.amount` (quantity × rate — the line's billing value) instead of
`Estimate` cost components, which would have made Budget mean "expected
revenue" instead of "expected cost" — exactly backwards for comparing
against Procurement spend later; (3) the Inventory transfer route
initially referenced the ambient `crypto.randomUUID()` global, which
isn't declared under this project's `tsconfig.json` `lib` setting —
fixed to import `randomUUID` from Node's `crypto` module before it was
ever run, the same class of issue caught earlier in
`routes/integration.ts`. All three fixed; see the code comments in
`routes/boq.ts`, `routes/budget.ts`, and `routes/inventory.ts`.

Estimate PUT, full BOQ/Budget error paths (invalid file, missing
category, re-approval attempts), and Procurement's error paths have not
been exercised live yet.

## Local setup

```
# .env — see .env.example for the full list; at minimum:
# DATABASE_URL=postgresql://<user>:<password>@localhost:<port>/project_os
# JWT_SECRET=<anything for local dev>
# PORT=4100
npm install
npx prisma migrate dev --name init
npm run dev
```
