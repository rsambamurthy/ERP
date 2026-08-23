$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Production orders: models and wiring...' -ForegroundColor Cyan

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

function Set-FileText($rel, $text) {
  $p = Join-Path $repo $rel
  $dir = Split-Path $p -Parent
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [IO.File]::WriteAllText($p, $text.Replace([string][char]13, ''), (New-Object Text.UTF8Encoding $false))
  Write-Host "  wrote  $rel"
}

Edit-FileText 'backend/prisma/schema.prisma' '  assetClasses     AssetClass[]
  fixedAssets      FixedAsset[]
  depreciationMethodChanges DepreciationMethodChange[]
  depreciationPeriods DepreciationPeriod[]
  stockAdjustments StockAdjustment[]
  salesReturns     SalesReturn[]
  purchaseReturns  PurchaseReturn[]
  stockMovements   StockMovement[]
' '  assetClasses     AssetClass[]
  fixedAssets      FixedAsset[]
  depreciationMethodChanges DepreciationMethodChange[]
  depreciationPeriods DepreciationPeriod[]
  productionOrders ProductionOrder[]
  stockAdjustments StockAdjustment[]
  salesReturns     SalesReturn[]
  purchaseReturns  PurchaseReturn[]
  stockMovements   StockMovement[]
'

Edit-FileText 'backend/prisma/schema.prisma' '  organization   Organization   @relation(fields: [organizationId], references: [id])
  orgUsers       OrgUser[]
  itemStocks     ItemStock[]
  journalEntries JournalEntry[]
  stockLots      StockLot[]
  stockMovements StockMovement[]
  salesInvoices  SalesInvoice[]
  purchaseBills  PurchaseBill[]
' '  organization   Organization   @relation(fields: [organizationId], references: [id])
  orgUsers       OrgUser[]
  itemStocks     ItemStock[]
  journalEntries JournalEntry[]
  productionOrders ProductionOrder[]
  stockLots      StockLot[]
  stockMovements StockMovement[]
  salesInvoices  SalesInvoice[]
  purchaseBills  PurchaseBill[]
'

Edit-FileText 'backend/prisma/schema.prisma' '  assetClassesExpense  AssetClass[] @relation("AssetClassExpense")
  fixedAssetsCost      FixedAsset[] @relation("FixedAssetCost")
  fixedAssetsAccumDep  FixedAsset[] @relation("FixedAssetAccumDep")
  fixedAssetsExpense   FixedAsset[] @relation("FixedAssetExpense")

  @@unique([organizationId, accountCode])
  @@map("accounts")
}
' '  assetClassesExpense  AssetClass[] @relation("AssetClassExpense")
  fixedAssetsCost      FixedAsset[] @relation("FixedAssetCost")
  fixedAssetsAccumDep  FixedAsset[] @relation("FixedAssetAccumDep")
  fixedAssetsExpense   FixedAsset[] @relation("FixedAssetExpense")
  productionEntryLines ProductionEntryLine[] @relation("ProductionLineAccount")

  @@unique([organizationId, accountCode])
  @@map("accounts")
}
'

Edit-FileText 'backend/prisma/schema.prisma' '  businessPartner       BusinessPartner @relation(fields: [businessPartnerId], references: [id])
  itemStocks           ItemStock[]
  bomLinesAsFinished   BomLine[]       @relation("FinishedItem")
  bomLinesAsComponent  BomLine[]       @relation("ComponentItem")
  stockLots            StockLot[]
  stockMovements       StockMovement[]
  salesInvoiceLines    SalesInvoiceLine[]
  purchaseBillLines    PurchaseBillLine[]
' '  businessPartner       BusinessPartner @relation(fields: [businessPartnerId], references: [id])
  itemStocks           ItemStock[]
  bomLinesAsFinished   BomLine[]       @relation("FinishedItem")
  bomLinesAsComponent  BomLine[]       @relation("ComponentItem")
  productionOrders     ProductionOrder[]     @relation("ProducedItem")
  productionEntryLines ProductionEntryLine[] @relation("ProductionLineItem")
  stockLots            StockLot[]
  stockMovements       StockMovement[]
  salesInvoiceLines    SalesInvoiceLine[]
  purchaseBillLines    PurchaseBillLine[]
'

Edit-FileText 'backend/prisma/schema.prisma' '  @@index([organizationId, finishedItemId])
  @@map("bom_lines")
}

model BusinessPartner {
  id                 String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId     String    @map("organization_id") @db.Uuid
  bpType             String    @map("bp_type") @db.VarChar(20)
' '  @@index([organizationId, finishedItemId])
  @@map("bom_lines")
}

model ProductionOrder {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId  String   @map("organization_id") @db.Uuid
  // Where the job runs. Components are consumed and output received here,
  // and the journal entries carry this branch.
  branchId        String   @map("branch_id") @db.Uuid
  orderNumber     String   @map("order_number") @db.VarChar(30)
  orderDate       DateTime @map("order_date") @db.Date
  finishedItemId  String   @map("finished_item_id") @db.Uuid
  plannedQuantity Decimal  @map("planned_quantity") @db.Decimal(14, 4)
  status          String   @default("OPEN") @db.VarChar(20)
  notes           String?  @db.VarChar(255)
  createdBy       String?  @map("created_by") @db.Uuid
  createdAt       DateTime @default(now()) @map("created_at")

  organization Organization      @relation(fields: [organizationId], references: [id])
  branch       Branch            @relation(fields: [branchId], references: [id])
  finishedItem Item              @relation("ProducedItem", fields: [finishedItemId], references: [id])
  entries      ProductionEntry[]

  // The WIP balance and the quantity received are NOT columns. Both are
  // summed from the entries, for the same reason accumulated depreciation is
  // summed from the runs: a stored total is a second version of the truth
  // that can drift from the ledger with nothing to notice.
  @@unique([organizationId, orderNumber], map: "prod_orders_number_uq")
  @@index([organizationId, status, orderDate])
  @@map("production_orders")
}

model ProductionEntry {
  id                String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  productionOrderId String   @map("production_order_id") @db.Uuid
  // ISSUE, COST, RECEIPT or WRITEOFF — see migration_042.
  entryType         String   @map("entry_type") @db.VarChar(10)
  entryDate         DateTime @map("entry_date") @db.Date
  totalValue        Decimal  @default(0) @map("total_value") @db.Decimal(14, 2)
  // A scalar rather than a relation, the same convention the depreciation
  // runs use: nothing navigates from a JournalEntry back to a production
  // entry, and modelling it would put an unused field on JournalEntry.
  journalEntryId    String   @unique @map("journal_entry_id") @db.Uuid
  narration         String?  @db.VarChar(255)
  createdBy         String?  @map("created_by") @db.Uuid
  createdAt         DateTime @default(now()) @map("created_at")

  productionOrder ProductionOrder       @relation(fields: [productionOrderId], references: [id])
  lines           ProductionEntryLine[]

  @@index([productionOrderId, entryDate])
  @@map("production_entries")
}

model ProductionEntryLine {
  id                String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  productionEntryId String   @map("production_entry_id") @db.Uuid
  // Exactly one of these two, enforced by prod_lines_target_ck. An ISSUE or
  // RECEIPT names an item and carries a quantity; a COST names the expense
  // account being absorbed and carries none.
  itemId            String?  @map("item_id") @db.Uuid
  accountId         String?  @map("account_id") @db.Uuid
  quantity          Decimal? @db.Decimal(14, 4)
  // Derived, never entered: returned by consumeStock on an issue, computed
  // by absorption on a receipt.
  unitCost          Decimal? @map("unit_cost") @db.Decimal(14, 4)
  lineValue         Decimal  @map("line_value") @db.Decimal(14, 2)

  productionEntry ProductionEntry @relation(fields: [productionEntryId], references: [id])
  item            Item?           @relation("ProductionLineItem", fields: [itemId], references: [id])
  account         Account?        @relation("ProductionLineAccount", fields: [accountId], references: [id])

  @@index([productionEntryId])
  @@map("production_entry_lines")
}

model BusinessPartner {
  id                 String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId     String    @map("organization_id") @db.Uuid
  bpType             String    @map("bp_type") @db.VarChar(20)
'

Edit-FileText 'backend/src/lib/costing.ts' '  itemId: string;
  quantity: number;
  unitCost: number;
  costingMethod: string; // "WEIGHTED_AVG" | "FIFO"
  movementType: "PURCHASE" | "ADJUSTMENT_IN" | "SALES_RETURN_IN";
  referenceType: string;
  referenceId: string;
  movementDate: Date;
  narration?: string | null;
' '  itemId: string;
  quantity: number;
  unitCost: number;
  costingMethod: string; // "WEIGHTED_AVG" | "FIFO"
  movementType: "PURCHASE" | "ADJUSTMENT_IN" | "SALES_RETURN_IN" | "PRODUCTION_IN" | "TRANSFER_IN";
  referenceType: string;
  referenceId: string;
  movementDate: Date;
  narration?: string | null;
'

Edit-FileText 'backend/src/lib/costing.ts' '  branchId: string;
  itemId: string;
  quantity: number;
  costingMethod: string;
  movementType: "SALE" | "ADJUSTMENT_OUT";
  referenceType: string;
  referenceId: string;
  movementDate: Date;
  narration?: string | null;
' '  branchId: string;
  itemId: string;
  quantity: number;
  costingMethod: string;
  movementType: "SALE" | "ADJUSTMENT_OUT" | "PRODUCTION_OUT" | "TRANSFER_OUT";
  referenceType: string;
  referenceId: string;
  movementDate: Date;
  narration?: string | null;
'

Edit-FileText 'backend/src/index.ts' 'import prepaidSchedulesRoutes from "./routes/prepaidSchedules";
import assetClassesRoutes from "./routes/assetClasses";
import depreciationPolicyRoutes from "./routes/depreciationPolicy";
import fixedAssetsRoutes from "./routes/fixedAssets";
import depreciationRunsRoutes from "./routes/depreciationRuns";
import integrationConnectionsRoutes from "./routes/integrationConnections";
import integrationApiRoutes from "./routes/integrationApi";
import chatbotRoutes from "./routes/chatbot";
' 'import prepaidSchedulesRoutes from "./routes/prepaidSchedules";
import assetClassesRoutes from "./routes/assetClasses";
import depreciationPolicyRoutes from "./routes/depreciationPolicy";
import fixedAssetsRoutes from "./routes/fixedAssets";
import productionOrdersRoutes from "./routes/productionOrders";
import depreciationRunsRoutes from "./routes/depreciationRuns";
import integrationConnectionsRoutes from "./routes/integrationConnections";
import integrationApiRoutes from "./routes/integrationApi";
import chatbotRoutes from "./routes/chatbot";
'

Edit-FileText 'backend/src/index.ts' 'app.use("/asset-classes", assetClassesRoutes);
app.use("/depreciation-policy", depreciationPolicyRoutes);
app.use("/fixed-assets", fixedAssetsRoutes);
app.use("/depreciation-runs", depreciationRunsRoutes);
app.use("/chatbot", chatbotRoutes);
// Mounted at two different paths, most-specific first — both routers
// apply their auth middleware via a path-less `router.use(...)`, so if
// the broader /integration prefix were checked first, its router would
' 'app.use("/asset-classes", assetClassesRoutes);
app.use("/depreciation-policy", depreciationPolicyRoutes);
app.use("/fixed-assets", fixedAssetsRoutes);
app.use("/depreciation-runs", depreciationRunsRoutes);
app.use("/production-orders", productionOrdersRoutes);
app.use("/chatbot", chatbotRoutes);
// Mounted at two different paths, most-specific first — both routers
// apply their auth middleware via a path-less `router.use(...)`, so if
// the broader /integration prefix were checked first, its router would
'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green