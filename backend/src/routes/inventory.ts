import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requireActiveSubscription, resolveOrgId } from "../middleware/auth";

const router = Router();
router.use(authenticate, requireActiveSubscription);

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

// GET /inventory/stock-ledger?itemId=&branchId=&from=&to= — running
// quantity balance for one item, same shape as /journal/ledger for an
// account: opening qty (from Item.openingQuantity, scoped to this branch
// only if this is the item's opening branch — approximated here as "if no
// branch filter, opening applies once"), then every StockMovement in date
// order.
router.get("/stock-ledger", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const { itemId, branchId, from, to } = req.query;
  if (!itemId) return res.status(400).json({ message: "itemId is required." });

  const item = await prisma.item.findFirst({ where: { id: String(itemId), organizationId } });
  if (!item) return res.status(404).json({ message: "Item not found." });

  const movements = await prisma.stockMovement.findMany({
    where: {
      itemId: String(itemId),
      organizationId,
      ...(branchId ? { branchId: String(branchId) } : {}),
      ...(from || to
        ? { movementDate: { ...(from ? { gte: new Date(String(from)) } : {}), ...(to ? { lte: new Date(String(to)) } : {}) } }
        : {}),
    },
    include: { branch: { select: { id: true, name: true } } },
    orderBy: [{ movementDate: "asc" }, { createdAt: "asc" }],
  });

  const openingQuantity = Number(item.openingQuantity ?? 0);
  let balance = openingQuantity;
  const rows = movements.map((m) => {
    const qty = Number(m.quantity);
    const inward = m.movementType === "PURCHASE" || m.movementType === "ADJUSTMENT_IN";
    balance += inward ? qty : -qty;
    return {
      date: m.movementDate,
      movementType: m.movementType,
      branch: m.branch.name,
      quantity: inward ? qty : -qty,
      unitCost: Number(m.unitCost),
      narration: m.narration,
      referenceType: m.referenceType,
      balance,
    };
  });

  res.json({ data: { item: { id: item.id, sku: item.sku, name: item.name, uom: item.uom }, openingQuantity, rows } });
});

// GET /inventory/valuation?branchId= — every active item's qty on hand and
// its value under the org's costing method. Weighted-average reads
// straight off ItemStock; FIFO sums the remaining lots instead, since
// ItemStock.averageCost is only a display estimate for those orgs.
router.get("/valuation", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const { branchId } = req.query;

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true } });

  const items = await prisma.item.findMany({
    where: { organizationId, deletedAt: null },
    include: {
      itemStocks: branchId ? { where: { branchId: String(branchId) } } : true,
      stockAccount: { select: { accountCode: true, accountName: true } },
    },
    orderBy: { name: "asc" },
  });

  let rows;
  if (org?.costingMethod === "FIFO") {
    const lots = await prisma.stockLot.findMany({
      where: { organizationId, quantityRemaining: { gt: 0 }, ...(branchId ? { branchId: String(branchId) } : {}) },
    });
    const byItem = new Map<string, { qty: number; value: number }>();
    for (const lot of lots) {
      const cur = byItem.get(lot.itemId) ?? { qty: 0, value: 0 };
      cur.qty += Number(lot.quantityRemaining);
      cur.value += Number(lot.quantityRemaining) * Number(lot.unitCost);
      byItem.set(lot.itemId, cur);
    }
    rows = items.map((i) => {
      const v = byItem.get(i.id) ?? { qty: 0, value: 0 };
      return {
        item: { id: i.id, sku: i.sku, name: i.name, uom: i.uom },
        stockAccount: i.stockAccount,
        quantityOnHand: v.qty, averageCost: v.qty > 0 ? v.value / v.qty : 0, value: v.value,
      };
    });
  } else {
    rows = items.map((i) => {
      const qty = i.itemStocks.reduce((s, st) => s + Number(st.quantityOnHand), 0);
      const value = i.itemStocks.reduce((s, st) => s + Number(st.quantityOnHand) * Number(st.averageCost), 0);
      return {
        item: { id: i.id, sku: i.sku, name: i.name, uom: i.uom },
        stockAccount: i.stockAccount,
        quantityOnHand: qty, averageCost: qty > 0 ? value / qty : 0, value,
      };
    });
  }

  rows = rows.filter((r) => Math.abs(r.quantityOnHand) > 0.0001);
  res.json({ data: { costingMethod: org?.costingMethod ?? null, rows, totalValue: rows.reduce((s, r) => s + r.value, 0) } });
});

export default router;
