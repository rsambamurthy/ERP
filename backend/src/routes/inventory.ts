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
// account: the quantity brought forward into the window, then every
// StockMovement inside it in date order.
//
// Brought-forward is COMPUTED from the movements before `from`, under the
// same branch filter and the same in/out signs as the rows - not read from
// Item.openingQuantity, which is a per-item column that knows nothing about
// either. See the note on INWARD below.
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

  // EVERY receipt, not two of them. Ten movement types exist and this listed
  // PURCHASE and ADJUSTMENT_IN, so TRANSFER_IN, SALES_RETURN_IN and
  // PRODUCTION_IN - all receipts - were signed negative and subtracted from
  // the running balance. On the report an auditor reads to trace an item, a
  // branch receiving a transfer showed stock going OUT.
  const INWARD = new Set([
    "PURCHASE", "ADJUSTMENT_IN", "TRANSFER_IN", "SALES_RETURN_IN", "PRODUCTION_IN",
  ]);

  // BROUGHT FORWARD, computed. This used to seed the running balance from
  // item.openingQuantity, which is wrong three ways at once: that column is on
  // the ITEM with no branch, so a branch-filtered ledger opened with stock
  // held somewhere else; it ignores the from/to window, so a May-onwards
  // ledger opened at the item's creation quantity rather than the balance at
  // 30 April; and creating an item with an opening balance already writes an
  // ADJUSTMENT_IN movement, so on the owning branch the quantity was counted
  // twice - once as the opening figure and again as the movement below it.
  //
  // What an opening balance means on a stock ledger is the balance carried
  // into the window being shown. So compute it: everything before `from`, for
  // this branch if one was asked for. With no `from` there is nothing before
  // the window and it opens at nil.
  const earlier = from
    ? await prisma.stockMovement.findMany({
        where: {
          itemId: String(itemId), organizationId,
          ...(branchId ? { branchId: String(branchId) } : {}),
          movementDate: { lt: new Date(String(from)) },
        },
        select: { movementType: true, quantity: true },
      })
    : [];
  const openingQuantity = earlier.reduce(
    (t, m) => t + (INWARD.has(m.movementType) ? Number(m.quantity) : -Number(m.quantity)), 0);
  let balance = openingQuantity;
  const rows = movements.map((m) => {
    const qty = Number(m.quantity);
    const inward = INWARD.has(m.movementType);
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
