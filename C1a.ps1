$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Stock transfers: models and wiring...' -ForegroundColor Cyan

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

Edit-FileText 'backend/prisma/schema.prisma' '  fixedAssets      FixedAsset[]
  depreciationMethodChanges DepreciationMethodChange[]
  depreciationPeriods DepreciationPeriod[]
  productionOrders ProductionOrder[]
  stockAdjustments StockAdjustment[]
  salesReturns     SalesReturn[]
  purchaseReturns  PurchaseReturn[]
  stockMovements   StockMovement[]
' '  fixedAssets      FixedAsset[]
  depreciationMethodChanges DepreciationMethodChange[]
  depreciationPeriods DepreciationPeriod[]
  productionOrders ProductionOrder[]
  stockTransfers   StockTransfer[]
  stockAdjustments StockAdjustment[]
  salesReturns     SalesReturn[]
  purchaseReturns  PurchaseReturn[]
  stockMovements   StockMovement[]
'

Edit-FileText 'backend/prisma/schema.prisma' '  orgUsers       OrgUser[]
  itemStocks     ItemStock[]
  journalEntries JournalEntry[]
  productionOrders ProductionOrder[]
  stockLots      StockLot[]
  stockMovements StockMovement[]
  salesInvoices  SalesInvoice[]
  purchaseBills  PurchaseBill[]
' '  orgUsers       OrgUser[]
  itemStocks     ItemStock[]
  journalEntries JournalEntry[]
  productionOrders ProductionOrder[]
  transfersOut   StockTransfer[] @relation("TransferFrom")
  transfersIn    StockTransfer[] @relation("TransferTo")
  stockLots      StockLot[]
  stockMovements StockMovement[]
  salesInvoices  SalesInvoice[]
  purchaseBills  PurchaseBill[]
'

Edit-FileText 'backend/prisma/schema.prisma' '  bomLinesAsFinished   BomLine[]       @relation("FinishedItem")
  bomLinesAsComponent  BomLine[]       @relation("ComponentItem")
  productionOrders     ProductionOrder[]     @relation("ProducedItem")
  productionEntryLines ProductionEntryLine[] @relation("ProductionLineItem")
  stockLots            StockLot[]
  stockMovements       StockMovement[]
  salesInvoiceLines    SalesInvoiceLine[]
  purchaseBillLines    PurchaseBillLine[]
' '  bomLinesAsFinished   BomLine[]       @relation("FinishedItem")
  bomLinesAsComponent  BomLine[]       @relation("ComponentItem")
  productionOrders     ProductionOrder[]     @relation("ProducedItem")
  productionEntryLines ProductionEntryLine[] @relation("ProductionLineItem")
  stockTransferLines   StockTransferLine[]
  stockLots            StockLot[]
  stockMovements       StockMovement[]
  salesInvoiceLines    SalesInvoiceLine[]
  purchaseBillLines    PurchaseBillLine[]
'

Edit-FileText 'backend/prisma/schema.prisma' '  @@index([productionEntryId])
  @@map("production_entry_lines")
}

model BusinessPartner {
  id                 String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId     String    @map("organization_id") @db.Uuid
  bpType             String    @map("bp_type") @db.VarChar(20)
' '  @@index([productionEntryId])
  @@map("production_entry_lines")
}

model StockTransfer {
  id                     String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId         String    @map("organization_id") @db.Uuid
  transferNumber         String    @map("transfer_number") @db.VarChar(30)
  fromBranchId           String    @map("from_branch_id") @db.Uuid
  toBranchId             String    @map("to_branch_id") @db.Uuid
  // Dispatch date. The receipt carries its own, which may be later and — by
  // stock_transfers_dates_ck — may not be earlier.
  transferDate           DateTime  @map("transfer_date") @db.Date
  receivedDate           DateTime? @map("received_date") @db.Date
  status                 String    @default("DISPATCHED") @db.VarChar(20)
  // Decided from the two branches'' GSTINs at dispatch and then FROZEN. A
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
  fromBranch   Branch              @relation("TransferFrom", fields: [fromBranchId], references: [id])
  toBranch     Branch              @relation("TransferTo", fields: [toBranchId], references: [id])
  lines        StockTransferLine[]

  @@unique([organizationId, transferNumber], map: "stock_transfers_number_uq")
  @@index([organizationId, status, transferDate])
  @@map("stock_transfers")
}

model StockTransferLine {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  stockTransferId String   @map("stock_transfer_id") @db.Uuid
  itemId          String   @map("item_id") @db.Uuid
  quantity        Decimal  @db.Decimal(14, 4)
  // What consumeStock actually took out at the sending branch. Never
  // entered — the receiving branch receives at the sending branch''s cost,
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

  stockTransfer StockTransfer @relation(fields: [stockTransferId], references: [id])
  item          Item          @relation(fields: [itemId], references: [id])

  @@unique([stockTransferId, itemId], map: "stock_transfer_lines_item_uq")
  @@index([stockTransferId])
  @@map("stock_transfer_lines")
}

model BusinessPartner {
  id                 String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId     String    @map("organization_id") @db.Uuid
  bpType             String    @map("bp_type") @db.VarChar(20)
'

Edit-FileText 'backend/src/index.ts' 'import assetClassesRoutes from "./routes/assetClasses";
import depreciationPolicyRoutes from "./routes/depreciationPolicy";
import fixedAssetsRoutes from "./routes/fixedAssets";
import productionOrdersRoutes from "./routes/productionOrders";
import depreciationRunsRoutes from "./routes/depreciationRuns";
import integrationConnectionsRoutes from "./routes/integrationConnections";
import integrationApiRoutes from "./routes/integrationApi";
import chatbotRoutes from "./routes/chatbot";
' 'import assetClassesRoutes from "./routes/assetClasses";
import depreciationPolicyRoutes from "./routes/depreciationPolicy";
import fixedAssetsRoutes from "./routes/fixedAssets";
import productionOrdersRoutes from "./routes/productionOrders";
import stockTransfersRoutes from "./routes/stockTransfers";
import depreciationRunsRoutes from "./routes/depreciationRuns";
import integrationConnectionsRoutes from "./routes/integrationConnections";
import integrationApiRoutes from "./routes/integrationApi";
import chatbotRoutes from "./routes/chatbot";
'

Edit-FileText 'backend/src/index.ts' 'app.use("/depreciation-policy", depreciationPolicyRoutes);
app.use("/fixed-assets", fixedAssetsRoutes);
app.use("/depreciation-runs", depreciationRunsRoutes);
app.use("/production-orders", productionOrdersRoutes);
app.use("/chatbot", chatbotRoutes);
// Mounted at two different paths, most-specific first — both routers
// apply their auth middleware via a path-less `router.use(...)`, so if
// the broader /integration prefix were checked first, its router would
' 'app.use("/depreciation-policy", depreciationPolicyRoutes);
app.use("/fixed-assets", fixedAssetsRoutes);
app.use("/depreciation-runs", depreciationRunsRoutes);
app.use("/production-orders", productionOrdersRoutes);
app.use("/stock-transfers", stockTransfersRoutes);
app.use("/chatbot", chatbotRoutes);
// Mounted at two different paths, most-specific first — both routers
// apply their auth middleware via a path-less `router.use(...)`, so if
// the broader /integration prefix were checked first, its router would
'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green