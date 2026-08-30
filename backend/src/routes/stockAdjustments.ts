import { randomUUID } from "crypto";
import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, requireModule, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { consumeStock, receiveStock, InsufficientStockError } from "../lib/costing";

const INVENTORY_ADJUSTMENTS_CODE = "4002";

const router = Router();
// Stock movement, valuation and the stock ledger are the Inventory
// module itself. An organisation that has given it up keeps its books,
// its bills and its invoices - it just stops moving stock.
router.use(authenticate, requireActiveSubscription, requireModule("INVENTORY"));
// Same gate as posting a journal entry directly — an adjustment is a real
// accounting event, not a data-entry convenience.
const canPost = requirePermission("inventory.post");

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

interface LineInput {
  itemId: string;
  direction: "IN" | "OUT";
  quantity: number;
  unitCost?: number; // required for IN; OUT is costed automatically
}

router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const adjustments = await prisma.stockAdjustment.findMany({
    where: { organizationId },
    include: { lines: { include: { item: { select: { id: true, sku: true, name: true } } } } },
    orderBy: { adjustmentDate: "desc" },
    take: 200,
  });
  res.json({ data: adjustments });
});

// POST /stock-adjustments — one document, both directions. IN needs an
// explicit unitCost (found stock has no natural cost of its own); OUT is
// costed by consumeStock under whatever the org's costing method says is
// currently on the shelf — never a number the caller supplies, since that
// would let a write-off silently misstate the loss.
router.post("/", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const { adjustmentDate, branchId, narration, lines } = req.body ?? {};
  if (!adjustmentDate || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ message: "adjustmentDate and at least one line are required." });
  }

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true } });
  if (!org?.costingMethod) return res.status(422).json({ message: "Set the organization's stock costing method first." });

  let resolvedBranchId: string | null = branchId ?? null;
  if (!resolvedBranchId) {
    const ho = await prisma.branch.findFirst({ where: { organizationId, isHeadOffice: true } });
    resolvedBranchId = ho?.id ?? null;
  }
  if (!resolvedBranchId) return res.status(400).json({ message: "No branch found — provide branchId." });

  const typedLines: LineInput[] = lines;
  for (const l of typedLines) {
    if (!l.itemId || !["IN", "OUT"].includes(l.direction) || !(l.quantity > 0)) {
      return res.status(400).json({ message: "Every line needs itemId, direction (IN/OUT), and quantity > 0." });
    }
    if (l.direction === "IN" && !(Number(l.unitCost) > 0)) {
      return res.status(400).json({ message: "unitCost is required and must be > 0 for an IN line." });
    }
  }

  const itemIds = [...new Set(typedLines.map((l) => l.itemId))];
  // SERVICE items are purchase-only (migration_029): they debit an expense
  // head and have no stock, so issuing, receiving or adjusting one is
  // meaningless. Filtering here rather than only in the picker means an
  // API-level call can't post one either — a sales line would otherwise
  // credit an expense account and try to issue stock that never existed.
  const items = await prisma.item.findMany({ where: { id: { in: itemIds }, organizationId, deletedAt: null, itemKind: "STOCK" } });
  if (items.length !== itemIds.length) return res.status(400).json({ message: "One or more items are invalid for this organization." });
  const itemById = new Map(items.map((i) => [i.id, i]));

  const adjustmentAccount = await prisma.account.findFirst({ where: { organizationId, accountCode: INVENTORY_ADJUSTMENTS_CODE } });
  if (!adjustmentAccount) return res.status(500).json({ message: "Inventory Adjustments account not found — re-run provisioning." });

  const adjustmentId = randomUUID();

  try {
    const adjustment = await prisma.$transaction(async (tx) => {
      let totalIn = 0, totalOut = 0;
      const computed = [];
      for (const l of typedLines) {
        if (l.direction === "IN") {
          const unitCost = Number(l.unitCost);
          await receiveStock(tx, {
            organizationId, branchId: resolvedBranchId!, itemId: l.itemId,
            quantity: l.quantity, unitCost, costingMethod: org.costingMethod!,
            movementType: "ADJUSTMENT_IN", referenceType: "stock_adjustment", referenceId: adjustmentId,
            movementDate: new Date(adjustmentDate), narration: narration || "Stock adjustment",
          });
          const lineValue = Math.round(l.quantity * unitCost * 100) / 100;
          totalIn += lineValue;
          computed.push({ ...l, unitCost, lineValue });
        } else {
          const { unitCost, totalCost } = await consumeStock(tx, {
            organizationId, branchId: resolvedBranchId!, itemId: l.itemId,
            quantity: l.quantity, costingMethod: org.costingMethod!,
            movementType: "ADJUSTMENT_OUT", referenceType: "stock_adjustment", referenceId: adjustmentId,
            movementDate: new Date(adjustmentDate), narration: narration || "Stock adjustment",
          });
          const lineValue = Math.round(totalCost * 100) / 100;
          totalOut += lineValue;
          computed.push({ ...l, unitCost, lineValue });
        }
      }

      const journalEntry = await tx.journalEntry.create({
        data: {
          organizationId, branchId: resolvedBranchId, entryDate: new Date(adjustmentDate),
          narration: narration || "Stock adjustment",
          voucherType: "SA", referenceType: "stock_adjustment", createdBy: req.user!.userId,
        },
      });

      await tx.journalLine.createMany({
        data: [
          ...computed.map((l) => ({
            journalEntryId: journalEntry.id,
            accountId: itemById.get(l.itemId)!.stockAccountId,
            businessPartnerId: itemById.get(l.itemId)!.businessPartnerId,
            debit: l.direction === "IN" ? l.lineValue : 0,
            credit: l.direction === "OUT" ? l.lineValue : 0,
            narration: `${itemById.get(l.itemId)!.sku} ${l.direction} x ${l.quantity}`,
          })),
          ...(totalOut > 0 ? [{ journalEntryId: journalEntry.id, accountId: adjustmentAccount.id, businessPartnerId: null, debit: totalOut, credit: 0, narration: "Write-off / shrinkage" }] : []),
          ...(totalIn > 0 ? [{ journalEntryId: journalEntry.id, accountId: adjustmentAccount.id, businessPartnerId: null, debit: 0, credit: totalIn, narration: "Found stock / opening correction" }] : []),
        ],
      });

      const created = await tx.stockAdjustment.create({
        data: {
          id: adjustmentId,
          organizationId, branchId: resolvedBranchId,
          adjustmentDate: new Date(adjustmentDate), narration: narration ?? "",
          journalEntryId: journalEntry.id, createdBy: req.user!.userId,
        },
      });

      await tx.stockAdjustmentLine.createMany({
        data: computed.map((l) => ({
          stockAdjustmentId: created.id, itemId: l.itemId, direction: l.direction,
          quantity: l.quantity, unitCost: l.unitCost, lineValue: l.lineValue,
        })),
      });

      return created;
    });

    logAudit({
      organizationId, actorUserId: req.user!.userId,
      action: "CREATE", entityType: "stock_adjustment", entityId: adjustment.id,
      summary: `Posted stock adjustment (${typedLines.length} line${typedLines.length === 1 ? "" : "s"})`,
    });
    res.status(201).json({ data: adjustment });
  } catch (err: any) {
    if (err instanceof InsufficientStockError) return res.status(409).json({ message: err.message });
    throw err;
  }
});

export default router;
