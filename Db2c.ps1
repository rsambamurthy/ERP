$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Phase D-b part 2c: schema for transfers and numbering...' -ForegroundColor Cyan

function Edit-FileText($rel, $old, $new) {
  $p = Join-Path $repo $rel
  if (-not (Test-Path -LiteralPath $p)) { throw "Missing file: $rel" }
  $old = $old.Replace([string][char]13, '')
  $new = $new.Replace([string][char]13, '')
  $t = [IO.File]::ReadAllText($p).Replace([string][char]13, '')
  if ($t.Contains($new)) { Write-Host "  skip   $rel"; return }
  $i = $t.IndexOf($old)
  if ($i -lt 0) { throw "Anchor not found in $rel." }
  if ($t.IndexOf($old, $i + 1) -ge 0) { throw "Anchor is not unique in $rel." }
  $t = $t.Substring(0, $i) + $new + $t.Substring($i + $old.Length)
  [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
  Write-Host "  edit   $rel"
}
$o0 = @'
  depreciationMethodChanges DepreciationMethodChange[]
  depreciationPeriods DepreciationPeriod[]
  productionOrders ProductionOrder[]
  stockTransfers   StockTransfer[]
  stockAdjustments StockAdjustment[]
  salesReturns     SalesReturn[]
  purchaseReturns  PurchaseReturn[]
  stockMovements   StockMovement[]
'@
$n0 = @'
  depreciationMethodChanges DepreciationMethodChange[]
  depreciationPeriods DepreciationPeriod[]
  productionOrders ProductionOrder[]
  stockTransfers   StockTransfer[]
  documentNumberSeries DocumentNumberSeries[]
  stockAdjustments StockAdjustment[]
  salesReturns     SalesReturn[]
  purchaseReturns  PurchaseReturn[]
  stockMovements   StockMovement[]
'@
Edit-FileText 'backend/prisma/schema.prisma' $o0 $n0
$o1 = @'
  // gstin when set, independently editable. Compared against the
  // counterparty's stateCode at Sales/Purchase posting time to decide
  // CGST+SGST (same state) vs IGST (different state).
  stateCode      String?   @map("state_code") @db.VarChar(2)
  isHeadOffice   Boolean   @default(false) @map("is_head_office")
  status         String    @default("ACTIVE") @db.VarChar(20)
  createdAt      DateTime  @default(now()) @map("created_at")
  deletedAt      DateTime? @map("deleted_at")
'@
$n1 = @'
  // gstin when set, independently editable. Compared against the
  // counterparty's stateCode at Sales/Purchase posting time to decide
  // CGST+SGST (same state) vs IGST (different state).
  stateCode      String?   @map("state_code") @db.VarChar(2)
  // Whether this branch can claim FULL input tax credit on what it receives
  // — see migration_044. FULL (the default) is what makes the second proviso
  // to Rule 28 available, and therefore what makes valuing a branch transfer
  // at cost legal. RESTRICTED/PROPORTIONATE mean the ITC would need reversal
  // under s.17(2) or apportionment under Rule 42; a taxable transfer INTO
  // such a branch is refused rather than posted on an assumption that does
  // not hold for it.
  itcEligibility String   @default("FULL") @map("itc_eligibility") @db.VarChar(20)
  isHeadOffice   Boolean   @default(false) @map("is_head_office")
  status         String    @default("ACTIVE") @db.VarChar(20)
  createdAt      DateTime  @default(now()) @map("created_at")
  deletedAt      DateTime? @map("deleted_at")
'@
Edit-FileText 'backend/prisma/schema.prisma' $o1 $n1
$o2 = @'
  journalEntries JournalEntry[]
  productionOrders ProductionOrder[]
  transfersOut   StockTransfer[] @relation("TransferFrom")
  transfersIn    StockTransfer[] @relation("TransferTo")
  stockLots      StockLot[]
  stockMovements StockMovement[]
  salesInvoices  SalesInvoice[]
  purchaseBills  PurchaseBill[]
'@
$n2 = @'
  journalEntries JournalEntry[]
  productionOrders ProductionOrder[]
  transfersOut   StockTransfer[] @relation("TransferFrom")
  transfersIn    StockTransfer[] @relation("TransferTo")
  documentNumberSeries DocumentNumberSeries[]
  stockLots      StockLot[]
  stockMovements StockMovement[]
  salesInvoices  SalesInvoice[]
  purchaseBills  PurchaseBill[]
'@
Edit-FileText 'backend/prisma/schema.prisma' $o2 $n2
$o3 = @'
  receivedDate           DateTime? @map("received_date") @db.Date
  status                 String    @default("DISPATCHED") @db.VarChar(20)
  // Decided from the two branches' GSTINs at dispatch and then FROZEN. A
  // branch that re-registers later must not restate a transfer already made.
  // Only NONE is written today — see the header of routes/stockTransfers.ts
  // on why a taxable transfer is refused rather than posted untaxed.
  taxTreatment           String    @default("NONE") @map("tax_treatment") @db.VarChar(10)
  documentNumber         String?   @map("document_number") @db.VarChar(30)
  ewayBillNumber         String?   @map("eway_bill_number") @db.VarChar(20)
  // Two entries because a journal entry carries one branch: the dispatch
  // belongs to the sending branch and the receipt to the receiving one, and
  // 1304 Stock in Transit is what lets each balance on its own. On a
  // cancelled transfer the second entry is the RETURN to the sender.
  dispatchJournalEntryId String?   @map("dispatch_journal_entry_id") @db.Uuid
  receiptJournalEntryId  String?   @map("receipt_journal_entry_id") @db.Uuid
  createdBy              String?   @map("created_by") @db.Uuid
  createdAt              DateTime  @default(now()) @map("created_at")

  organization Organization        @relation(fields: [organizationId], references: [id])
'@
$n3 = @'
  receivedDate           DateTime? @map("received_date") @db.Date
  status                 String    @default("DISPATCHED") @db.VarChar(20)
  // Decided from the two branches' GSTINs at dispatch and then FROZEN. A
  // branch that re-registers later must not restate a transfer already made.
  taxTreatment           String    @default("NONE") @map("tax_treatment") @db.VarChar(10)
  // The receiving branch's itcEligibility, copied here at dispatch and then
  // frozen for the same reason taxTreatment is. The route reads THIS, never
  // the live branch row, once a transfer exists.
  toBranchItcEligibility String    @default("FULL") @map("to_branch_itc_eligibility") @db.VarChar(20)
  // Rule 55 delivery challan number on an untaxed transfer; the section 31 /
  // Rule 46 TAX INVOICE number on a taxable one, allocated from
  // DocumentNumberSeries for the sending branch.
  documentNumber         String?   @map("document_number") @db.VarChar(30)
  ewayBillNumber         String?   @map("eway_bill_number") @db.VarChar(20)
  // An untaxed transfer has TWO entries — dispatch at the sending branch and
  // receipt at the receiving one, each balancing through 1304 Stock in
  // Transit, because one legal person's books can carry both halves.
  //
  // A TAXABLE transfer has THREE. Its two branches are distinct persons
  // under s.25(4) with separate trial balances, so neither may touch an
  // account belonging to the other; the third entry converts the sender's
  // transit asset into a receivable when the goods land. See
  // migration_045's header for the full postings.
  //
  // On a cancelled transfer receiptJournalEntryId holds the RETURN to the
  // sender instead — the column means "the second entry of this transfer".
  dispatchJournalEntryId String?   @map("dispatch_journal_entry_id") @db.Uuid
  receiptJournalEntryId  String?   @map("receipt_journal_entry_id") @db.Uuid
  transitClearingJournalEntryId String? @map("transit_clearing_journal_entry_id") @db.Uuid
  createdBy              String?   @map("created_by") @db.Uuid
  createdAt              DateTime  @default(now()) @map("created_at")

  organization Organization        @relation(fields: [organizationId], references: [id])
'@
Edit-FileText 'backend/prisma/schema.prisma' $o3 $n3
$o4 = @'
  // entered — the receiving branch receives at the sending branch's cost,
  // and nothing is re-valued in transit.
  unitCost        Decimal  @map("unit_cost") @db.Decimal(14, 4)
  lineValue       Decimal  @map("line_value") @db.Decimal(14, 2)
  // Rule 28 value and the tax on it. Null while taxTreatment is NONE, which
  // is everything this phase writes.
  taxableValue    Decimal? @map("taxable_value") @db.Decimal(14, 2)
  gstRate         Decimal? @map("gst_rate") @db.Decimal(5, 2)
  cgst            Decimal? @db.Decimal(14, 2)
  sgst            Decimal? @db.Decimal(14, 2)
  igst            Decimal? @db.Decimal(14, 2)
'@
$n4 = @'
  // entered — the receiving branch receives at the sending branch's cost,
  // and nothing is re-valued in transit.
  unitCost        Decimal  @map("unit_cost") @db.Decimal(14, 4)
  lineValue       Decimal  @map("line_value") @db.Decimal(14, 2)
  // Rule 28 value and the tax on it. Null on an untaxed (same-GSTIN)
  // transfer, which is not a supply and carries no tax at all.
  //
  // taxableValue is a separate number from lineValue even though the two are
  // equal today: lineValue is what the STOCK is worth and moves inventory,
  // taxableValue is what the TAX is charged on. Under SECOND_PROVISO they
  // coincide by design (see lib/transferValuation.ts); under any other basis
  // in the Rule 28 hierarchy they do not.
  taxableValue    Decimal? @map("taxable_value") @db.Decimal(14, 2)
  // Which step of Rule 28 justifies taxableValue. Per line, because one
  // transfer can carry a bought-in item with a known market price alongside
  // a manufactured one that has none.
  valuationBasis  String   @default("SECOND_PROVISO") @map("valuation_basis") @db.VarChar(20)
  gstRate         Decimal? @map("gst_rate") @db.Decimal(5, 2)
  cgst            Decimal? @db.Decimal(14, 2)
  sgst            Decimal? @db.Decimal(14, 2)
  igst            Decimal? @db.Decimal(14, 2)
'@
Edit-FileText 'backend/prisma/schema.prisma' $o4 $n4
$o5 = @'

  @@unique([stockTransferId, itemId], map: "stock_transfer_lines_item_uq")
  @@index([stockTransferId])
  @@map("stock_transfer_lines")
}

model BusinessPartner {
  id                 String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
'@
$n5 = @'

  @@unique([stockTransferId, itemId], map: "stock_transfer_lines_item_uq")
  @@index([stockTransferId])
  @@map("stock_transfer_lines")
}

// Consecutive document numbering, per branch per financial year.
//
// A tax invoice needs a serial number that is consecutive and unique within
// a financial year (Rule 46(b)), and two branches of one company are
// DISTINCT PERSONS under s.25(4) — so the series belongs to a branch, not to
// the organisation. Keyed by financial year as well, because the numbering
// conventionally restarts every April: a new year is a new row starting at
// 1, rather than a reset job somebody has to remember to run.
//
// prefix is set deliberately, once, per branch (GST/IBT/TN) rather than
// invented by code — it is the part a company's auditors recognise, and
// nothing should generate it for them.
//
// seriesType names only STOCK_TRANSFER today. Sales Invoice numbering is
// still a plain row count in routes/salesInvoices.ts; this table is where it
// would move without a second one being built.
model DocumentNumberSeries {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId String   @map("organization_id") @db.Uuid
  branchId       String   @map("branch_id") @db.Uuid
  seriesType     String   @map("series_type") @db.VarChar(20)
  // "2026-27" — the label, not a date.
  financialYear  String   @map("financial_year") @db.VarChar(9)
  prefix         String   @db.VarChar(20)
  // The number the NEXT document will take. Allocated by incrementing this
  // row inside the posting transaction, so two dispatches racing each other
  // cannot be handed the same number.
  nextNumber     Int      @default(1) @map("next_number")
  createdAt      DateTime @default(now()) @map("created_at")

  organization Organization @relation(fields: [organizationId], references: [id])
  branch       Branch       @relation(fields: [branchId], references: [id])

  @@unique([organizationId, branchId, seriesType, financialYear], map: "document_number_series_uq")
  @@map("document_number_series")
}

model BusinessPartner {
  id                 String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
'@
Edit-FileText 'backend/prisma/schema.prisma' $o5 $n5
$o6 = @'
--    different states' books — there is no single entity in which they
--    could net at all until consolidation. They are designed to sum to
--    zero across the organisation, not within one branch's trial balance.
--
--    Once Phase D posts, the reconciliation identity at any date is:
--
--        1305 (Receivable) + 1304 (Stock in Transit) - 2106 (Payable) = 0
--
--    1304 is in the sum because dispatch and receipt land in different
--    states' books on different dates — see migration_043's header on why
--    the account exists at all. A break in this identity is a real
--    posting error, not a timing difference; migration_043's plain
--    1304-only check only holds for the untaxed, same-GSTIN case this
--    migration does not touch.
--
--    Same population as 1305: wherever 1305 already exists is where a
--    taxable transfer can eventually be posted, so that is where its
--    payable counterpart belongs too.
'@
$n6 = @'
--    different states' books — there is no single entity in which they
--    could net at all until consolidation. They are designed to sum to
--    zero across the organisation, not within one branch's trial balance.
--
--    Once Phase D posts, taking 2106 as a positive credit balance:
--
--        1305 + 1304 - 2106 = invoice value of transfers dispatched
--                             but NOT YET RECEIVED
--
--    so it is ZERO whenever nothing is on a lorry, and otherwise equals
--    exactly what is on one — checkable against the transfers table. The
--    two halves arrive at different moments because the tax is incurred at
--    dispatch (section 12, on issue of the invoice) while the goods are
--    still the sender's: 1305 carries the tax alone and 1304 the cost,
--    until receipt moves the cost half across.
--
--    1304 is in the sum because dispatch and receipt land in different
--    states' books on different dates — see migration_043's header on why
--    the account exists at all. Anything left after subtracting the
--    genuinely-in-transit transfers is a posting error.
--
--    Same population as 1305: wherever 1305 already exists is where a
--    taxable transfer can eventually be posted, so that is where its
--    payable counterpart belongs too.
'@
Edit-FileText 'db/migration_044_transfer_valuation.sql' $o6 $n6
$o7 = @'
-- 1304 on its books forever, or the receiving branch has to credit 1304 —
-- an account belonging to the other registration's balance sheet, which is
-- exactly the thing distinct-person treatment forbids.
--
-- With all three posted, at any date:
--
--     1305 (Receivable) + 1304 (Stock in Transit) - 2106 (Payable) = 0
--
-- In transit:  1305 = tax,        1304 = cost, 2106 = 0          -> 0
-- Received:    1305 = cost + tax, 1304 = 0,    2106 = cost + tax -> 0
--
-- THE UNTAXED CASE IS NOT CHANGED
--
-- A same-GSTIN transfer is one legal person with one balance sheet, and
'@
$n7 = @'
-- 1304 on its books forever, or the receiving branch has to credit 1304 —
-- an account belonging to the other registration's balance sheet, which is
-- exactly the thing distinct-person treatment forbids.
--
-- With all three posted, taking 2106 as a positive credit balance:
--
--     1305 + 1304 - 2106 = invoice value of transfers dispatched
--                          but NOT YET RECEIVED
--
-- In transit:  1305 = tax,        1304 = cost, 2106 = 0          -> cost + tax
-- Received:    1305 = cost + tax, 1304 = 0,    2106 = cost + tax -> 0
--
-- Zero whenever nothing is on a lorry, and otherwise exactly what is on one.
--
-- THE UNTAXED CASE IS NOT CHANGED
--
-- A same-GSTIN transfer is one legal person with one balance sheet, and
'@
Edit-FileText 'db/migration_045_transfer_transit_clearing.sql' $o7 $n7
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green