import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requireRole, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { receiveStock } from "../lib/costing";

const router = Router();
router.use(authenticate, requireActiveSubscription);

// Same gate as Chart of Accounts — Items are master data, structurally the
// same kind of decision (what account does this post to) as an Account
// itself.
const canManageItems = requireRole("OWNER", "ADMIN");

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
    stockAccountId, salesRate, purchaseRate, taxRate,
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

  const { name, description, uom, hsnCode, isFinishedGood, salesRate, purchaseRate, taxRate, isActive } = req.body ?? {};
  const updated = await prisma.item.update({
    where: { id: item.id },
    data: { name, description, uom, hsnCode, isFinishedGood, salesRate, purchaseRate, taxRate, isActive },
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

export default router;
