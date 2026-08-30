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
  // Let the balance go negative rather than refusing. Set only by a Sales
  // Invoice that explicitly asked for it, in an organisation that permits
  // it. Every other caller - stock adjustments, transfers, production
  // issues, delivery notes - leaves it unset and keeps the old refusal,
  // because none of them is a promise to a customer that somebody has
  // already made.
  allowNegative?: boolean;
}

// Stock going out — a Sales Invoice line or an outward Stock Adjustment.
// Returns the blended unit cost actually consumed, which is what the
// caller posts as COGS (Sales Invoice) or the write-off amount (Stock
// Adjustment) — never the sale/adjustment's own rate, which is a price,
// not a cost.
// wentNegative says whether this call actually took the balance below
// zero, which is not the same question as whether it was ALLOWED to. An
// invoice can ask for the override and have enough stock after all, and
// recording that as an override would put invoices on the exception
// report that never were one.
export async function consumeStock(tx: Tx, args: ConsumeArgs):
  Promise<{ unitCost: number; totalCost: number; wentNegative: boolean }> {
  const { organizationId, branchId, itemId, quantity, costingMethod, movementType, referenceType, referenceId, movementDate, narration, allowNegative } = args;

  const stock = await tx.itemStock.findUnique({ where: { itemId_branchId: { itemId, branchId } } });
  const onHand = Number(stock?.quantityOnHand ?? 0);
  if (onHand < quantity) {
    // THE OVERRIDE, and it is narrow on purpose. Two locks have to be open:
    // the organisation must permit negative stock at all, and the document
    // must ask for it — see routes/salesInvoices.ts. Neither alone is
    // enough, so nobody arrives here by accident.
    if (!allowNegative) {
      throw new InsufficientStockError(`Only ${onHand} in stock at this branch — cannot remove ${quantity}.`);
    }
    // FIFO REFUSES EVEN WITH THE OVERRIDE ON, and this is not an oversight.
    // Weighted average always has an answer to "at what cost did this
    // leave?" — the stored average, which is a real number computed from
    // real receipts. FIFO's answer is a LOT, and for the shortfall there is
    // no lot: nothing was ever received to consume from. Inventing one
    // means inventing a cost and a date, and then reconciling it against
    // whatever actually arrives later. That is a different feature with its
    // own failure modes, not a flag on this one.
    //
    // The refusal below is also why the "lots don't cover" check further
    // down can go on treating that state as corruption rather than as
    // something this path might legitimately produce.
    if (costingMethod === "FIFO") {
      throw new InsufficientStockError(
        `Only ${onHand} in stock at this branch. Negative stock is allowed for this organisation, ` +
        `but not under FIFO — there is no lot to take the shortfall of ${quantity - onHand} from. ` +
        `Receive the stock first.`);
    }
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
    // The whole quantity leaves at the stored average, INCLUDING any part of
    // it the branch did not hold. That is the only defensible cost available
    // - it is what every unit of this item has cost on average up to now -
    // but it is a forecast rather than a fact for the shortfall, and when
    // the real receipt lands at a different rate the COGS already posted on
    // that invoice is wrong and nothing goes back to correct it. The margin
    // on a negative-stock sale is an estimate. That is the price of the
    // override and it is why the organisation has to switch it on.
    const avgCost = Number(stock?.averageCost ?? 0);
    totalCost = quantity * avgCost;
  }

  const unitCost = quantity > 0 ? totalCost / quantity : 0;

  // upsert, not update: an override can sell an item this branch has NO row
  // for at all - never received one unit - and update would throw on the
  // missing row rather than record the negative balance. averageCost stays
  // where it was (0 for an item never held), because consumption never moves
  // the average.
  await tx.itemStock.upsert({
    where: { itemId_branchId: { itemId, branchId } },
    create: {
      itemId, branchId,
      quantityOnHand: onHand - quantity,
      averageCost: Number(stock?.averageCost ?? 0),
    },
    update: { quantityOnHand: onHand - quantity }, // averageCost unchanged on consumption
  });

  await tx.stockMovement.create({
    data: {
      organizationId, branchId, itemId, movementType, quantity, unitCost,
      referenceType, referenceId, movementDate, narration: narration ?? null,
    },
  });

  return { unitCost, totalCost, wentNegative: onHand < quantity };
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
function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export async function returnStockToVendor(tx: Tx, args: ReturnToVendorArgs) {
  const { organizationId, branchId, itemId, quantity, unitCost, costingMethod, referenceType, referenceId, originalPurchaseBillId, movementDate, narration } = args;

  const stock = await tx.itemStock.findUnique({ where: { itemId_branchId: { itemId, branchId } } });
  const onHand = Number(stock?.quantityOnHand ?? 0);
  if (onHand < quantity) {
    throw new InsufficientStockError(`Only ${onHand} in stock at this branch — cannot return ${quantity} to the vendor.`);
  }

  // THE AVERAGE MOVES. consumeStock leaves it alone because consumption takes
  // stock out AT the average, so the character of what remains is unchanged.
  // A vendor return takes it out at the BILL RATE, which is not the average,
  // and removing value at any other rate must change the average of the
  // remainder.
  //
  // Leaving it alone was a silent reconciliation break: the journal credited
  // the bill rate while the valuation report moved by quantity x the OLD
  // average, and the two drifted apart by the difference on every return.
  const remainingQty = round4(onHand - quantity);
  const residualValue = round2(onHand * Number(stock?.averageCost ?? 0) - quantity * unitCost);
  await tx.itemStock.update({
    where: { itemId_branchId: { itemId, branchId } },
    data: {
      quantityOnHand: remainingQty,
      // Returning above the average against nearly-exhausted stock can drive
      // the residual negative. That is real arithmetic, not a meaningful unit
      // cost, so hold at zero rather than publish a negative average.
      averageCost: remainingQty > 0.0001 && residualValue > 0
        ? round4(residualValue / remainingQty)
        : 0,
    },
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
