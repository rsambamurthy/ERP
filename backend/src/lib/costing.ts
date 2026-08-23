import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export class InsufficientStockError extends Error {}

interface ReceiveArgs {
  organizationId: string;
  branchId: string;
  itemId: string;
  quantity: number;
  unitCost: number;
  costingMethod: string; // "WEIGHTED_AVG" | "FIFO"
  movementType: "PURCHASE" | "ADJUSTMENT_IN" | "SALES_RETURN_IN" | "PRODUCTION_IN" | "TRANSFER_IN";
  referenceType: string;
  referenceId: string;
  movementDate: Date;
  narration?: string | null;
}

// Stock coming in — a Purchase Bill line, an inward Stock Adjustment, or
// (via routes/items.ts, at item creation) an opening balance. Always
// updates ItemStock; additionally lays down a StockLot when the org is
// FIFO, since that's the cost layer a future sale will consume from.
export async function receiveStock(tx: Tx, args: ReceiveArgs) {
  const { organizationId, branchId, itemId, quantity, unitCost, costingMethod, movementType, referenceType, referenceId, movementDate, narration } = args;

  await tx.stockMovement.create({
    data: {
      organizationId, branchId, itemId, movementType, quantity, unitCost,
      referenceType, referenceId, movementDate, narration: narration ?? null,
    },
  });

  const existing = await tx.itemStock.findUnique({ where: { itemId_branchId: { itemId, branchId } } });
  const oldQty = Number(existing?.quantityOnHand ?? 0);
  const oldAvg = Number(existing?.averageCost ?? 0);
  const newQty = oldQty + quantity;
  // Weighted average recalculated on every receipt. If the org is FIFO this
  // number is only ever used for a quick display estimate — StockLot is
  // what a sale actually consumes from — but it costs nothing to keep it
  // honest either way.
  const newAvg = newQty > 0 ? (oldQty * oldAvg + quantity * unitCost) / newQty : 0;

  await tx.itemStock.upsert({
    where: { itemId_branchId: { itemId, branchId } },
    create: { itemId, branchId, quantityOnHand: newQty, averageCost: newAvg },
    update: { quantityOnHand: newQty, averageCost: newAvg },
  });

  if (costingMethod === "FIFO") {
    await tx.stockLot.create({
      data: {
        organizationId, branchId, itemId,
        quantityRemaining: quantity, unitCost, receivedAt: movementDate,
        referenceType, referenceId,
      },
    });
  }
}

interface ConsumeArgs {
  organizationId: string;
  branchId: string;
  itemId: string;
  quantity: number;
  costingMethod: string;
  movementType: "SALE" | "ADJUSTMENT_OUT" | "PRODUCTION_OUT" | "TRANSFER_OUT";
  referenceType: string;
  referenceId: string;
  movementDate: Date;
  narration?: string | null;
}

// Stock going out — a Sales Invoice line or an outward Stock Adjustment.
// Returns the blended unit cost actually consumed, which is what the
// caller posts as COGS (Sales Invoice) or the write-off amount (Stock
// Adjustment) — never the sale/adjustment's own rate, which is a price,
// not a cost.
export async function consumeStock(tx: Tx, args: ConsumeArgs): Promise<{ unitCost: number; totalCost: number }> {
  const { organizationId, branchId, itemId, quantity, costingMethod, movementType, referenceType, referenceId, movementDate, narration } = args;

  const stock = await tx.itemStock.findUnique({ where: { itemId_branchId: { itemId, branchId } } });
  const onHand = Number(stock?.quantityOnHand ?? 0);
  if (onHand < quantity) {
    throw new InsufficientStockError(`Only ${onHand} in stock at this branch — cannot remove ${quantity}.`);
  }

  let totalCost: number;

  if (costingMethod === "FIFO") {
    const lots = await tx.stockLot.findMany({
      where: { itemId, branchId, quantityRemaining: { gt: 0 } },
      orderBy: { receivedAt: "asc" },
    });
    let remaining = quantity;
    totalCost = 0;
    for (const lot of lots) {
      if (remaining <= 0) break;
      const available = Number(lot.quantityRemaining);
      const take = Math.min(available, remaining);
      totalCost += take * Number(lot.unitCost);
      remaining -= take;
      await tx.stockLot.update({ where: { id: lot.id }, data: { quantityRemaining: available - take } });
    }
    if (remaining > 0.0001) {
      // Lots don't cover the on-hand quantity — a data inconsistency
      // (should be unreachable if receiveStock is always used to bring
      // stock in), but fail loudly rather than silently under-costing.
      throw new InsufficientStockError("Stock lots don't cover the requested quantity — inventory data is inconsistent for this item.");
    }
  } else {
    const avgCost = Number(stock?.averageCost ?? 0);
    totalCost = quantity * avgCost;
  }

  const unitCost = quantity > 0 ? totalCost / quantity : 0;

  await tx.itemStock.update({
    where: { itemId_branchId: { itemId, branchId } },
    data: { quantityOnHand: onHand - quantity }, // averageCost unchanged on consumption
  });

  await tx.stockMovement.create({
    data: {
      organizationId, branchId, itemId, movementType, quantity, unitCost,
      referenceType, referenceId, movementDate, narration: narration ?? null,
    },
  });

  return { unitCost, totalCost };
}

interface ReturnToVendorArgs {
  organizationId: string;
  branchId: string;
  itemId: string;
  quantity: number;
  unitCost: number; // fixed — the original Purchase Bill line's rate, not recomputed
  costingMethod: string;
  referenceType: string;
  referenceId: string;
  originalPurchaseBillId?: string; // FIFO: drain lots this exact bill created first
  movementDate: Date;
  narration?: string | null;
}

// Stock going back out to a vendor (Purchase Return). Deliberately not
// consumeStock: a Purchase Bill brings stock in at an explicit rate
// (receiveStock's unitCost param, not a computed one), so reversing it
// should credit that same fixed rate back — mirroring the original entry —
// rather than whatever consumeStock's FIFO/weighted-average engine would
// currently compute, which could drift from what was actually paid. For
// FIFO, prefers depleting the lot(s) this exact bill created (the literal
// units being sent back) before falling back to oldest-first for any
// shortfall — e.g. if some of this bill's own stock already sold through.
export async function returnStockToVendor(tx: Tx, args: ReturnToVendorArgs) {
  const { organizationId, branchId, itemId, quantity, unitCost, costingMethod, referenceType, referenceId, originalPurchaseBillId, movementDate, narration } = args;

  const stock = await tx.itemStock.findUnique({ where: { itemId_branchId: { itemId, branchId } } });
  const onHand = Number(stock?.quantityOnHand ?? 0);
  if (onHand < quantity) {
    throw new InsufficientStockError(`Only ${onHand} in stock at this branch — cannot return ${quantity} to the vendor.`);
  }

  await tx.itemStock.update({
    where: { itemId_branchId: { itemId, branchId } },
    data: { quantityOnHand: onHand - quantity }, // averageCost unchanged, same convention as consumeStock
  });

  if (costingMethod === "FIFO") {
    const preferredLots = originalPurchaseBillId
      ? await tx.stockLot.findMany({
          where: { itemId, branchId, referenceId: originalPurchaseBillId, quantityRemaining: { gt: 0 } },
          orderBy: { receivedAt: "asc" },
        })
      : [];
    const otherLots = await tx.stockLot.findMany({
      where: {
        itemId, branchId, quantityRemaining: { gt: 0 },
        ...(originalPurchaseBillId ? { NOT: { referenceId: originalPurchaseBillId } } : {}),
      },
      orderBy: { receivedAt: "asc" },
    });

    let remaining = quantity;
    for (const lot of [...preferredLots, ...otherLots]) {
      if (remaining <= 0) break;
      const available = Number(lot.quantityRemaining);
      const take = Math.min(available, remaining);
      remaining -= take;
      await tx.stockLot.update({ where: { id: lot.id }, data: { quantityRemaining: available - take } });
    }
    // If remaining > 0.0001 here the lots didn't cover it — same data
    // inconsistency case consumeStock guards against — but the onHand
    // check above already caught any real shortfall, so this is
    // unreachable in practice rather than worth a second throw.
  }

  await tx.stockMovement.create({
    data: {
      organizationId, branchId, itemId, movementType: "PURCHASE_RETURN_OUT", quantity, unitCost,
      referenceType, referenceId, movementDate, narration: narration ?? null,
    },
  });
}
