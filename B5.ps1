$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Item to asset class: backend...' -ForegroundColor Cyan

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

Edit-FileText 'backend/prisma/schema.prisma' '  // debits. Deliberately not renamed: it would touch every existing row and
  // query for no functional gain.
  stockAccountId String    @map("stock_account_id") @db.Uuid
  // The paired sub-ledger row (business_partners.bp_type = ''ITEM'') that
  // tags every journal line against stockAccountId for this item — same
  // pattern Trade Receivables/Payables already use for customers/vendors.' '  // debits. Deliberately not renamed: it would touch every existing row and
  // query for no functional gain.
  stockAccountId String    @map("stock_account_id") @db.Uuid
  // An item that is capital by nature — a conference table, a laptop — says
  // so here, once, instead of on every Purchase Bill line. A line for such
  // an item arrives capitalised against this class and can still be unticked
  // deliberately; what it can no longer be is unticked by omission, which is
  // the failure that puts an asset''s cost in the P&L with no register entry.
  //
  // Only a SERVICE item may carry one: a STOCK item''s purchase already moves
  // inventory. migration_037''s CHECK enforces that from the database.
  defaultAssetClassId String? @map("default_asset_class_id") @db.Uuid
  // The paired sub-ledger row (business_partners.bp_type = ''ITEM'') that
  // tags every journal line against stockAccountId for this item — same
  // pattern Trade Receivables/Payables already use for customers/vendors.'

Edit-FileText 'backend/prisma/schema.prisma' '
  organization        Organization    @relation(fields: [organizationId], references: [id])
  stockAccount         Account         @relation(fields: [stockAccountId], references: [id])
  businessPartner       BusinessPartner @relation(fields: [businessPartnerId], references: [id])
  itemStocks           ItemStock[]
  bomLinesAsFinished   BomLine[]       @relation("FinishedItem")' '
  organization        Organization    @relation(fields: [organizationId], references: [id])
  stockAccount         Account         @relation(fields: [stockAccountId], references: [id])
  defaultAssetClass AssetClass? @relation(fields: [defaultAssetClassId], references: [id])
  businessPartner       BusinessPartner @relation(fields: [businessPartnerId], references: [id])
  itemStocks           ItemStock[]
  bomLinesAsFinished   BomLine[]       @relation("FinishedItem")'

Edit-FileText 'backend/prisma/schema.prisma' '  accumDepAccount Account      @relation("AssetClassAccumDep", fields: [accumDepAccountId], references: [id])
  depExpenseAccount Account    @relation("AssetClassExpense", fields: [depExpenseAccountId], references: [id])
  assets          FixedAsset[]

  @@unique([organizationId, name])
  @@map("asset_classes")' '  accumDepAccount Account      @relation("AssetClassAccumDep", fields: [accumDepAccountId], references: [id])
  depExpenseAccount Account    @relation("AssetClassExpense", fields: [depExpenseAccountId], references: [id])
  assets          FixedAsset[]
  items           Item[]

  @@unique([organizationId, name])
  @@map("asset_classes")'

Edit-FileText 'backend/src/routes/items.ts' '  if (!organizationId) return;
  const items = await prisma.item.findMany({
    where: { organizationId, deletedAt: null },
    include: { stockAccount: { select: { id: true, accountCode: true, accountName: true } }, itemStocks: true },
    orderBy: { name: "asc" },
  });
  res.json({' '  if (!organizationId) return;
  const items = await prisma.item.findMany({
    where: { organizationId, deletedAt: null },
    include: {
      stockAccount: { select: { id: true, accountCode: true, accountName: true } },
      defaultAssetClass: { select: { id: true, name: true } },
      itemStocks: true,
    },
    orderBy: { name: "asc" },
  });
  res.json({'

Edit-FileText 'backend/src/routes/items.ts' '      itemKind: i.itemKind,
      isFinishedGood: i.isFinishedGood, isActive: i.isActive,
      stockAccount: i.stockAccount,
      salesRate: i.salesRate, purchaseRate: i.purchaseRate, taxRate: i.taxRate,
      defaultDiscountPct: i.defaultDiscountPct,
      totalQuantityOnHand: i.itemStocks.reduce((s, st) => s + Number(st.quantityOnHand), 0),' '      itemKind: i.itemKind,
      isFinishedGood: i.isFinishedGood, isActive: i.isActive,
      stockAccount: i.stockAccount,
      // Present means this item always becomes a fixed asset — the Purchase
      // Bill line arrives capitalised against this class.
      defaultAssetClass: i.defaultAssetClass,
      salesRate: i.salesRate, purchaseRate: i.purchaseRate, taxRate: i.taxRate,
      defaultDiscountPct: i.defaultDiscountPct,
      totalQuantityOnHand: i.itemStocks.reduce((s, st) => s + Number(st.quantityOnHand), 0),'

Edit-FileText 'backend/src/routes/items.ts' '// POST /items — create an item, its paired ITEM business partner, and (if
// an opening balance was given) the opening stock movement. All three or
// none — one transaction.
router.post("/", canManageItems, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;' '// POST /items — create an item, its paired ITEM business partner, and (if
// an opening balance was given) the opening stock movement. All three or
// none — one transaction.
// Returns the class id to store (or null), or `false` when it has already
// answered the request with a 400. Shared by POST and PATCH so the two can
// never disagree about what a capital item is.
async function resolveAssetClass(
  organizationId: string,
  kind: string,
  value: unknown,
  res: import("express").Response,
): Promise<string | null | false> {
  if (value === undefined || value === null || value === "") return null;
  if (kind !== "SERVICE") {
    res.status(400).json({ message: "Only a non-stock item can be a capital asset — a stock item''s purchase already moves inventory." });
    return false;
  }
  const cls = await prisma.assetClass.findFirst({
    where: { id: String(value), organizationId, isActive: true },
    select: { id: true },
  });
  if (!cls) {
    res.status(400).json({ message: "That asset class doesn''t belong to this organization, or is no longer active." });
    return false;
  }
  return cls.id;
}

router.post("/", canManageItems, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;'

Edit-FileText 'backend/src/routes/items.ts' '    sku, name, description, uom, hsnCode, isFinishedGood, itemKind,
    stockAccountId, salesRate, purchaseRate, taxRate, defaultDiscountPct,
    openingQuantity, openingCost, openingBranchId, openingDate,
  } = req.body ?? {};

  const kind = itemKind === "SERVICE" ? "SERVICE" : "STOCK";' '    sku, name, description, uom, hsnCode, isFinishedGood, itemKind,
    stockAccountId, salesRate, purchaseRate, taxRate, defaultDiscountPct,
    openingQuantity, openingCost, openingBranchId, openingDate,
    defaultAssetClassId,
  } = req.body ?? {};

  const kind = itemKind === "SERVICE" ? "SERVICE" : "STOCK";'

Edit-FileText 'backend/src/routes/items.ts' '        : "stockAccountId must be one of this org''s item control accounts.",
    });
  }

  const existing = await prisma.item.findUnique({ where: { organizationId_sku: { organizationId, sku } } });
  if (existing) return res.status(409).json({ message: `Item code ${sku} already exists.` });' '        : "stockAccountId must be one of this org''s item control accounts.",
    });
  }

  // A capital item — one that always becomes a fixed asset rather than an
  // expense. Only a SERVICE item can be one, because a STOCK item''s purchase
  // already moves inventory and capitalising it would record the same
  // purchase twice. items_asset_class_kind_ck says the same thing at the
  // database; this is where it becomes a sentence rather than a 23514.
  const assetClassId = await resolveAssetClass(organizationId, kind, defaultAssetClassId, res);
  if (assetClassId === false) return;

  const existing = await prisma.item.findUnique({ where: { organizationId_sku: { organizationId, sku } } });
  if (existing) return res.status(409).json({ message: `Item code ${sku} already exists.` });'

Edit-FileText 'backend/src/routes/items.ts' '        isFinishedGood: kind === "SERVICE" ? false : !!isFinishedGood,
        itemKind: kind,
        stockAccountId,
        businessPartnerId: bp.id,
        salesRate: salesRate ?? null,
        purchaseRate: purchaseRate ?? null,' '        isFinishedGood: kind === "SERVICE" ? false : !!isFinishedGood,
        itemKind: kind,
        stockAccountId,
        defaultAssetClassId: assetClassId,
        businessPartnerId: bp.id,
        salesRate: salesRate ?? null,
        purchaseRate: purchaseRate ?? null,'

Edit-FileText 'backend/src/routes/items.ts' '  const item = await prisma.item.findFirst({ where: { id: req.params.id, organizationId } });
  if (!item) return res.status(404).json({ message: "Item not found." });

  const { name, description, uom, hsnCode, isFinishedGood, salesRate, purchaseRate, taxRate, defaultDiscountPct, isActive } = req.body ?? {};
  const updated = await prisma.item.update({
    where: { id: item.id },
    data: { name, description, uom, hsnCode, isFinishedGood, salesRate, purchaseRate, taxRate, defaultDiscountPct, isActive },
  });

  if (name && name !== item.name) {' '  const item = await prisma.item.findFirst({ where: { id: req.params.id, organizationId } });
  if (!item) return res.status(404).json({ message: "Item not found." });

  const { name, description, uom, hsnCode, isFinishedGood, salesRate, purchaseRate, taxRate, defaultDiscountPct, isActive, defaultAssetClassId } = req.body ?? {};

  // Unlike stockAccountId this one is editable after creation: it changes
  // what FUTURE bills do and never touches an asset already capitalised,
  // because every asset copies its accounts and life at capitalisation.
  // Sending null clears it, which is how an item stops being capital.
  let assetClassPatch: { defaultAssetClassId?: string | null } = {};
  if (defaultAssetClassId !== undefined) {
    const resolved = await resolveAssetClass(organizationId, item.itemKind, defaultAssetClassId, res);
    if (resolved === false) return;
    assetClassPatch = { defaultAssetClassId: resolved };
  }

  const updated = await prisma.item.update({
    where: { id: item.id },
    data: { name, description, uom, hsnCode, isFinishedGood, salesRate, purchaseRate, taxRate, defaultDiscountPct, isActive, ...assetClassPatch },
  });

  if (name && name !== item.name) {'

Edit-FileText 'backend/src/routes/purchaseBills.ts' '  // Same shape as the prepaid block above and validated for the same
  // reason: everything that can be rejected is rejected before a single
  // row is written, so a bill can never post with a broken asset beside it.
  const capitalIdx: number[] = [];
  computed.forEach((l, i) => {
    if ((l as { capitalise?: boolean }).capitalise) capitalIdx.push(i);' '  // Same shape as the prepaid block above and validated for the same
  // reason: everything that can be rejected is rejected before a single
  // row is written, so a bill can never post with a broken asset beside it.
  // An item that carries a default asset class is capital by nature — a
  // conference table, a laptop — so a line for it arrives capitalised
  // against that class without anyone having to remember. See
  // migration_037: the point is not that it cannot be overridden, but that
  // it cannot be missed by omission, which is the failure that puts an
  // asset''s cost in the P&L with no register entry behind it.
  //
  // An explicit `capitalise: false` still wins. Absent is what defaults.
  for (const l of computed as ({ itemId: string; capitalise?: boolean; assetClassId?: string })[]) {
    const fromItem = itemById.get(l.itemId)?.defaultAssetClassId;
    if (!fromItem) continue;
    if (l.capitalise === undefined) l.capitalise = true;
    if (l.capitalise && !l.assetClassId) l.assetClassId = fromItem;
  }

  const capitalIdx: number[] = [];
  computed.forEach((l, i) => {
    if ((l as { capitalise?: boolean }).capitalise) capitalIdx.push(i);'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green