import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { receiveStock } from "../lib/costing";
import { upload } from "../lib/upload";
import { buildTemplateWorkbook, loadUploadedWorksheet, cellText } from "../lib/xlsxTemplate";

const router = Router();
router.use(authenticate, requireActiveSubscription);

// Same gate as Chart of Accounts — Items are master data, structurally the
// same kind of decision (what account does this post to) as an Account
// itself.
const canManageItems = requirePermission("items.manage");

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

// GET /items/costing-method — null until the org has chosen one.
router.get("/costing-method", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true } });
  res.json({ data: { costingMethod: org?.costingMethod ?? null } });
});

// POST /items/costing-method — { costingMethod: "WEIGHTED_AVG" | "FIFO" }.
// Succeeds exactly once per org: every ItemStock/StockLot row that follows
// is computed under this rule, so there's no well-defined way to migrate
// an org's existing stock history from one method to the other later.
router.post("/costing-method", canManageItems, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const { costingMethod } = req.body ?? {};
  if (!["WEIGHTED_AVG", "FIFO"].includes(costingMethod)) {
    return res.status(400).json({ message: "costingMethod must be WEIGHTED_AVG or FIFO." });
  }

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true } });
  if (org?.costingMethod) {
    return res.status(409).json({ message: `Costing method is already set to ${org.costingMethod} and cannot be changed.` });
  }

  await prisma.organization.update({ where: { id: organizationId }, data: { costingMethod } });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "organization", entityId: organizationId,
    summary: `Set stock costing method to ${costingMethod} (permanent)`,
  });
  res.json({ data: { costingMethod } });
});

// GET /items — full item master for the org.
router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const items = await prisma.item.findMany({
    where: { organizationId, deletedAt: null },
    include: { stockAccount: { select: { id: true, accountCode: true, accountName: true } }, itemStocks: true },
    orderBy: { name: "asc" },
  });
  res.json({
    data: items.map((i) => ({
      id: i.id, sku: i.sku, name: i.name, description: i.description, uom: i.uom, hsnCode: i.hsnCode,
      isFinishedGood: i.isFinishedGood, isActive: i.isActive,
      stockAccount: i.stockAccount,
      salesRate: i.salesRate, purchaseRate: i.purchaseRate, taxRate: i.taxRate,
      defaultDiscountPct: i.defaultDiscountPct,
      totalQuantityOnHand: i.itemStocks.reduce((s, st) => s + Number(st.quantityOnHand), 0),
    })),
  });
});

// GET /items/stock-accounts — the org's control accounts eligible as an
// item's stockAccountId (isControlAccount + defaultBpType = ITEM), for the
// create-item form's dropdown. Whatever the org's selected domain(s)
// seeded — Inventory (Trading), Raw Materials / Finished Goods
// (Manufacturing), or a custom one.
router.get("/stock-accounts", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const accounts = await prisma.account.findMany({
    where: { organizationId, deletedAt: null, isControlAccount: true, defaultBpType: "ITEM" },
    orderBy: { accountCode: "asc" },
  });
  res.json({ data: accounts });
});

// POST /items — create an item, its paired ITEM business partner, and (if
// an opening balance was given) the opening stock movement. All three or
// none — one transaction.
router.post("/", canManageItems, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const {
    sku, name, description, uom, hsnCode, isFinishedGood,
    stockAccountId, salesRate, purchaseRate, taxRate, defaultDiscountPct,
    openingQuantity, openingCost, openingBranchId, openingDate,
  } = req.body ?? {};

  if (!sku || !name || !stockAccountId) {
    return res.status(400).json({ message: "sku, name, and stockAccountId are required." });
  }

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true } });
  if (!org?.costingMethod) {
    return res.status(422).json({ message: "Set the organization's stock costing method before adding items." });
  }

  const account = await prisma.account.findFirst({
    where: { id: stockAccountId, organizationId, isControlAccount: true, defaultBpType: "ITEM" },
  });
  if (!account) return res.status(400).json({ message: "stockAccountId must be one of this org's item control accounts." });

  const existing = await prisma.item.findUnique({ where: { organizationId_sku: { organizationId, sku } } });
  if (existing) return res.status(409).json({ message: `Item code ${sku} already exists.` });

  const qty = Number(openingQuantity ?? 0);
  const cost = Number(openingCost ?? 0);
  let resolvedOpeningBranchId: string | null = openingBranchId ?? null;
  if (qty > 0) {
    if (!resolvedOpeningBranchId) {
      const ho = await prisma.branch.findFirst({ where: { organizationId, isHeadOffice: true } });
      resolvedOpeningBranchId = ho?.id ?? null;
    }
    if (!resolvedOpeningBranchId) return res.status(400).json({ message: "No branch found — provide openingBranchId." });
    if (cost <= 0) return res.status(400).json({ message: "openingCost must be greater than 0 when openingQuantity is set." });
  }

  const item = await prisma.$transaction(async (tx) => {
    const bp = await tx.businessPartner.create({
      data: { organizationId, bpType: "ITEM", name },
    });
    const created = await tx.item.create({
      data: {
        organizationId, sku, name,
        description: description ?? null,
        uom: uom || "EA",
        hsnCode: hsnCode ?? null,
        isFinishedGood: !!isFinishedGood,
        stockAccountId,
        businessPartnerId: bp.id,
        salesRate: salesRate ?? null,
        purchaseRate: purchaseRate ?? null,
        taxRate: taxRate ?? 0,
        defaultDiscountPct: defaultDiscountPct ?? 0,
        openingQuantity: qty,
        openingCost: cost,
      },
    });
    await tx.businessPartner.update({ where: { id: bp.id }, data: { refId: created.id } });

    if (qty > 0) {
      await receiveStock(tx, {
        organizationId, branchId: resolvedOpeningBranchId!, itemId: created.id,
        quantity: qty, unitCost: cost, costingMethod: org.costingMethod!,
        movementType: "ADJUSTMENT_IN", referenceType: "item_opening_balance", referenceId: created.id,
        movementDate: openingDate ? new Date(openingDate) : new Date(),
        narration: "Opening stock",
      });
    }

    return created;
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "CREATE", entityType: "item", entityId: item.id,
    summary: `Created item ${item.sku} — ${item.name}`,
  });
  res.status(201).json({ data: item });
});

// PATCH /items/:id — everything except sku, stockAccountId, and the
// opening figures, same "structural fields locked after creation"
// convention as system Accounts.
router.patch("/:id", canManageItems, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const item = await prisma.item.findFirst({ where: { id: req.params.id, organizationId } });
  if (!item) return res.status(404).json({ message: "Item not found." });

  const { name, description, uom, hsnCode, isFinishedGood, salesRate, purchaseRate, taxRate, defaultDiscountPct, isActive } = req.body ?? {};
  const updated = await prisma.item.update({
    where: { id: item.id },
    data: { name, description, uom, hsnCode, isFinishedGood, salesRate, purchaseRate, taxRate, defaultDiscountPct, isActive },
  });

  if (name && name !== item.name) {
    await prisma.businessPartner.update({ where: { id: item.businessPartnerId }, data: { name } });
  }

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "item", entityId: item.id,
    summary: `Updated item ${item.sku} — ${item.name}`,
  });
  res.json({ data: updated });
});

// DELETE /items/:id — only if it's never been touched by a stock movement.
router.delete("/:id", canManageItems, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const item = await prisma.item.findFirst({ where: { id: req.params.id, organizationId } });
  if (!item) return res.status(404).json({ message: "Item not found." });

  const used = await prisma.stockMovement.findFirst({ where: { itemId: item.id } });
  if (used) return res.status(409).json({ message: "This item has stock movements and cannot be deleted." });

  await prisma.$transaction([
    prisma.item.update({ where: { id: item.id }, data: { deletedAt: new Date() } }),
    prisma.businessPartner.update({ where: { id: item.businessPartnerId }, data: { deletedAt: new Date(), isActive: false } }),
  ]);
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "DELETE", entityType: "item", entityId: item.id,
    summary: `Deleted item ${item.sku} — ${item.name}`,
  });
  res.json({ data: { deleted: true } });
});

// ── Bulk upload (Template Download + Bulk Upload) ─────────────────────────
// Matches an uploaded row to an existing item by SKU. Opening Qty/Cost and
// Stock Account only ever apply when creating a new item — same
// "structural fields locked after creation" rule as PATCH /items/:id — so
// an update row silently ignores those three columns rather than erroring.

const ITEM_COLUMNS = [
  { header: "SKU *", hint: "← required", width: 14 },
  { header: "Name *", hint: "← required", width: 30 },
  { header: "Description", hint: "optional", width: 30 },
  { header: "UOM", hint: "default EA", width: 10 },
  { header: "HSN Code", hint: "optional", width: 12 },
  { header: "Stock Account Code *", hint: "← required for new items only", width: 18 },
  { header: "Sales Rate", hint: "optional, number", width: 14, numFmt: "#,##0.00" },
  { header: "Purchase Rate", hint: "optional, number", width: 14, numFmt: "#,##0.00" },
  { header: "Tax %", hint: "default 0", width: 9, numFmt: "0.00" },
  { header: "Opening Qty", hint: "new items only", width: 14, numFmt: "0.0000" },
  { header: "Opening Cost", hint: "required if Opening Qty > 0", width: 14, numFmt: "#,##0.00" },
];

interface ItemPreviewRow {
  rowNum: number;
  sku: string;
  name: string;
  description: string | null;
  uom: string;
  hsnCode: string | null;
  stockAccountCode: string | null;
  salesRate: number | null;
  purchaseRate: number | null;
  taxRate: number;
  openingQuantity: number;
  openingCost: number;
  status: "create" | "update" | "error";
  error?: string;
}

router.get("/bulk-upload/template", canManageItems, async (req, res) => {
  const buffer = await buildTemplateWorkbook("Items", ITEM_COLUMNS);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="SmartERP_Items_Template.xlsx"');
  res.send(buffer);
});

router.post("/bulk-upload/preview", canManageItems, upload.single("file"), async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  if (!req.file) return res.status(400).json({ message: "No file uploaded." });

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true } });

  const ws = await loadUploadedWorksheet(req.file.buffer);
  if (!ws) return res.json({ data: [] });

  const [existingItems, stockAccounts] = await Promise.all([
    prisma.item.findMany({ where: { organizationId, deletedAt: null }, select: { sku: true } }),
    prisma.account.findMany({
      where: { organizationId, deletedAt: null, isControlAccount: true, defaultBpType: "ITEM" },
      select: { id: true, accountCode: true },
    }),
  ]);
  const skuSet = new Set(existingItems.map((i) => i.sku.trim()));
  const accountByCode = new Map(stockAccounts.map((a) => [a.accountCode.trim(), a]));

  const preview: ItemPreviewRow[] = [];

  ws.eachRow((row, rowNum) => {
    if (rowNum <= 2) return;
    const sku = cellText(row, 1);
    const name = cellText(row, 2);
    if (!sku && !name) return;

    const push = (status: ItemPreviewRow["status"], error?: string) =>
      preview.push({
        rowNum, sku: sku ?? "", name: name ?? "",
        description: cellText(row, 3), uom: cellText(row, 4) || "EA", hsnCode: cellText(row, 5),
        stockAccountCode: cellText(row, 6),
        salesRate: null, purchaseRate: null, taxRate: 0, openingQuantity: 0, openingCost: 0,
        status, error,
      });

    if (!sku) return push("error", "SKU is required");
    if (!name) return push("error", "Name is required");

    const isUpdate = skuSet.has(sku);
    const stockAccountCode = cellText(row, 6);

    if (!isUpdate) {
      if (!org?.costingMethod) return push("error", "Set the org's stock costing method before adding items.");
      if (!stockAccountCode) return push("error", "Stock Account Code is required for a new item");
      if (!accountByCode.has(stockAccountCode)) return push("error", `Stock Account Code "${stockAccountCode}" is not one of this org's item control accounts`);
    }

    const salesRaw = row.getCell(7).value;
    const purchaseRaw = row.getCell(8).value;
    const taxRaw = row.getCell(9).value;
    const qtyRaw = row.getCell(10).value;
    const costRaw = row.getCell(11).value;

    const salesRate = salesRaw != null && salesRaw !== "" ? Number(salesRaw) : null;
    const purchaseRate = purchaseRaw != null && purchaseRaw !== "" ? Number(purchaseRaw) : null;
    const taxRate = taxRaw != null && taxRaw !== "" ? Number(taxRaw) : 0;
    const qty = qtyRaw != null && qtyRaw !== "" ? Number(qtyRaw) : 0;
    const cost = costRaw != null && costRaw !== "" ? Number(costRaw) : 0;

    if ([salesRate, purchaseRate, taxRate, qty, cost].some((n) => n !== null && isNaN(n as number))) {
      return push("error", "One of the numeric columns is not a valid number");
    }
    if (!isUpdate && qty > 0 && cost <= 0) {
      return push("error", "Opening Cost must be greater than 0 when Opening Qty is set");
    }

    preview.push({
      rowNum, sku, name,
      description: cellText(row, 3), uom: cellText(row, 4) || "EA", hsnCode: cellText(row, 5),
      stockAccountCode,
      salesRate, purchaseRate, taxRate,
      openingQuantity: isUpdate ? 0 : qty, openingCost: isUpdate ? 0 : cost,
      status: isUpdate ? "update" : "create",
    });
  });

  res.json({ data: preview });
});

router.post("/bulk-upload/apply", canManageItems, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const rows: ItemPreviewRow[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const workRows = rows.filter((r) => r.status === "create" || r.status === "update");
  if (workRows.length === 0) return res.json({ data: { created: 0, updated: 0 } });

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true } });
  const existingItems = await prisma.item.findMany({ where: { organizationId, deletedAt: null } });
  const bySku = new Map(existingItems.map((i) => [i.sku.trim(), i]));
  const stockAccounts = await prisma.account.findMany({
    where: { organizationId, deletedAt: null, isControlAccount: true, defaultBpType: "ITEM" },
  });
  const accountByCode = new Map(stockAccounts.map((a) => [a.accountCode.trim(), a]));
  const ho = await prisma.branch.findFirst({ where: { organizationId, isHeadOffice: true } });

  let created = 0, updated = 0;
  for (const row of workRows) {
    const found = bySku.get(row.sku);
    if (found) {
      await prisma.item.update({
        where: { id: found.id },
        data: {
          name: row.name, description: row.description, uom: row.uom || "EA",
          hsnCode: row.hsnCode, salesRate: row.salesRate, purchaseRate: row.purchaseRate,
          taxRate: row.taxRate,
        },
      });
      if (row.name !== found.name) {
        await prisma.businessPartner.update({ where: { id: found.businessPartnerId }, data: { name: row.name } });
      }
      updated++;
    } else {
      const account = row.stockAccountCode ? accountByCode.get(row.stockAccountCode) : null;
      if (!account || !org?.costingMethod || !ho) continue; // shouldn't happen — preview already validated this
      const item = await prisma.$transaction(async (tx) => {
        const bp = await tx.businessPartner.create({ data: { organizationId, bpType: "ITEM", name: row.name } });
        const createdItem = await tx.item.create({
          data: {
            organizationId, sku: row.sku, name: row.name,
            description: row.description, uom: row.uom || "EA", hsnCode: row.hsnCode,
            stockAccountId: account.id, businessPartnerId: bp.id,
            salesRate: row.salesRate, purchaseRate: row.purchaseRate, taxRate: row.taxRate,
            openingQuantity: row.openingQuantity, openingCost: row.openingCost,
          },
        });
        await tx.businessPartner.update({ where: { id: bp.id }, data: { refId: createdItem.id } });
        if (row.openingQuantity > 0) {
          await receiveStock(tx, {
            organizationId, branchId: ho.id, itemId: createdItem.id,
            quantity: row.openingQuantity, unitCost: row.openingCost, costingMethod: org!.costingMethod!,
            movementType: "ADJUSTMENT_IN", referenceType: "item_opening_balance", referenceId: createdItem.id,
            movementDate: new Date(), narration: "Opening stock (bulk upload)",
          });
        }
        return createdItem;
      });
      bySku.set(item.sku.trim(), item);
      created++;
    }
  }

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "BULK_UPLOAD", entityType: "item", entityId: organizationId,
    summary: `Bulk upload: ${created} item(s) created, ${updated} updated`,
  });
  res.json({ data: { created, updated } });
});

export default router;
