import { randomUUID } from "crypto";
import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { returnStockToVendor, InsufficientStockError } from "../lib/costing";
import { isInterState, splitGst } from "../lib/discountGst";

const TRADE_PAYABLES_CODE = "2001";
const CGST_INPUT_CODE = "1102";
const SGST_INPUT_CODE = "1103";
const IGST_INPUT_CODE = "1104";

const router = Router();
router.use(authenticate, requireActiveSubscription);
const canPost = requirePermission("purchase.post");

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

interface LineInput {
  purchaseBillLineId: string;
  quantity: number;
}

router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const returns = await prisma.purchaseReturn.findMany({
    where: { organizationId },
    include: {
      businessPartner: { select: { id: true, name: true } },
      purchaseBill: { select: { id: true, billNumber: true } },
      lines: { include: { item: { select: { id: true, sku: true, name: true } } } },
    },
    orderBy: { returnDate: "desc" },
    take: 200,
  });
  res.json({ data: returns });
});

router.get("/:id", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const ret = await prisma.purchaseReturn.findFirst({
    where: { id: req.params.id, organizationId },
    include: {
      businessPartner: true,
      purchaseBill: { select: { id: true, billNumber: true } },
      lines: { include: { item: true } },
      journalEntry: { include: { journalLines: true } },
    },
  });
  if (!ret) return res.status(404).json({ message: "Purchase return not found." });
  res.json({ data: ret });
});

// GET /purchase-returns/bill/:billId/lines — the original bill's lines,
// each annotated with how much has already been returned, for the "new
// return" form to show and cap the remaining returnable quantity.
router.get("/bill/:billId/lines", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const bill = await prisma.purchaseBill.findFirst({
    where: { id: req.params.billId, organizationId },
    include: { lines: { include: { item: { select: { id: true, sku: true, name: true, uom: true } } } }, businessPartner: { select: { id: true, name: true } } },
  });
  if (!bill) return res.status(404).json({ message: "Purchase bill not found." });
  // A bill that hasn't posted yet (Pending Approval — see PurchaseBill.status)
  // never moved stock or touched Trade Payables, so there's nothing to
  // reverse. A Rejected bill never posted at all.
  if (bill.status !== "POSTED") {
    return res.status(400).json({ message: `Bill ${bill.billNumber} is ${bill.status}, not Posted — nothing to return against yet.` });
  }

  const lineIds = bill.lines.map((l) => l.id);
  const returned = await prisma.purchaseReturnLine.groupBy({
    by: ["purchaseBillLineId"],
    where: { purchaseBillLineId: { in: lineIds } },
    _sum: { quantity: true },
  });
  const returnedByLine = new Map(returned.map((r) => [r.purchaseBillLineId, Number(r._sum.quantity ?? 0)]));

  res.json({
    data: {
      bill: { id: bill.id, billNumber: bill.billNumber, businessPartner: bill.businessPartner },
      lines: bill.lines.map((l) => ({
        id: l.id, item: l.item, quantity: Number(l.quantity), rate: Number(l.rate), taxRate: Number(l.taxRate),
        alreadyReturned: returnedByLine.get(l.id) ?? 0,
        remaining: Number(l.quantity) - (returnedByLine.get(l.id) ?? 0),
      })),
    },
  });
});

// POST /purchase-returns — always against an existing Purchase Bill, capped
// per line at (billed qty - already returned), same rule as Sales Return.
// Stock leaves at the bill line's own rate (mirroring how it arrived —
// receiveStock took that same rate as an explicit cost, not a computed
// one), preferring to drain the lot(s) that exact bill created. Reduces
// Trade Payables and reverses CGST+SGST or IGST Input for the full
// returned amount — the inter/intra-state split is recomputed the same way
// the original bill determined it (branch vs vendor state), not copied
// from the bill, since neither document stores that flag.
router.post("/", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const { purchaseBillId, returnDate, branchId, narration, lines } = req.body ?? {};
  if (!purchaseBillId || !returnDate || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ message: "purchaseBillId, returnDate, and at least one line are required." });
  }

  const bill = await prisma.purchaseBill.findFirst({
    where: { id: purchaseBillId, organizationId },
    include: { lines: true, businessPartner: true },
  });
  if (!bill) return res.status(400).json({ message: "purchaseBillId must be an existing purchase bill for this org." });
  // Same guard as GET /bill/:billId/lines above — a bill that hasn't
  // posted yet has no stock/Trade-Payables impact to reverse.
  if (bill.status !== "POSTED") {
    return res.status(400).json({ message: `Bill ${bill.billNumber} is ${bill.status}, not Posted — nothing to return against yet.` });
  }

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true } });
  if (!org?.costingMethod) return res.status(422).json({ message: "Set the organization's stock costing method first." });

  const resolvedBranchId: string | null = branchId ?? bill.branchId ?? null;
  if (!resolvedBranchId) return res.status(400).json({ message: "No branch found — provide branchId." });
  const branch = await prisma.branch.findFirst({ where: { id: resolvedBranchId, organizationId }, select: { stateCode: true } });
  const interState = isInterState(branch?.stateCode, bill.businessPartner.stateCode);

  const typedLines: LineInput[] = lines;
  for (const l of typedLines) {
    if (!l.purchaseBillLineId || !(l.quantity > 0)) {
      return res.status(400).json({ message: "Every line needs purchaseBillLineId and quantity > 0." });
    }
  }

  const originalById = new Map(bill.lines.map((l) => [l.id, l]));
  for (const l of typedLines) {
    if (!originalById.has(l.purchaseBillLineId)) {
      return res.status(400).json({ message: `Line ${l.purchaseBillLineId} does not belong to this bill.` });
    }
  }

  const lineIds = typedLines.map((l) => l.purchaseBillLineId);
  const alreadyReturned = await prisma.purchaseReturnLine.groupBy({
    by: ["purchaseBillLineId"],
    where: { purchaseBillLineId: { in: lineIds } },
    _sum: { quantity: true },
  });
  const returnedByLine = new Map(alreadyReturned.map((r) => [r.purchaseBillLineId, Number(r._sum.quantity ?? 0)]));
  const requestedByLine = new Map<string, number>();

  let subtotal = 0, taxTotal = 0;
  const computed = typedLines.map((l) => {
    const original = originalById.get(l.purchaseBillLineId)!;
    const already = returnedByLine.get(l.purchaseBillLineId) ?? 0;
    const requestedSoFar = requestedByLine.get(l.purchaseBillLineId) ?? 0;
    const remaining = Number(original.quantity) - already - requestedSoFar;
    if (l.quantity > remaining + 0.0001) {
      throw Object.assign(new Error(`Cannot return ${l.quantity} — only ${Math.max(remaining, 0)} remaining on this bill line.`), { status: 409 });
    }
    requestedByLine.set(l.purchaseBillLineId, requestedSoFar + l.quantity);

    const rate = Number(original.rate);
    const taxRate = Number(original.taxRate);
    const lineSubtotal = Math.round(l.quantity * rate * 100) / 100;
    const taxAmount = Math.round((lineSubtotal * taxRate) / 100 * 100) / 100;
    const lineTotal = lineSubtotal + taxAmount;

    subtotal += lineSubtotal; taxTotal += taxAmount;
    return { purchaseBillLineId: l.purchaseBillLineId, itemId: original.itemId, quantity: l.quantity, rate, taxRate, lineSubtotal, taxAmount, lineTotal };
  });
  const grandTotal = subtotal + taxTotal;

  const itemIds = [...new Set(computed.map((l) => l.itemId))];
  const items = await prisma.item.findMany({ where: { id: { in: itemIds }, organizationId } });
  const itemById = new Map(items.map((i) => [i.id, i]));

  const [tradePayables, cgstInput, sgstInput, igstInput] = await Promise.all([
    prisma.account.findFirst({ where: { organizationId, accountCode: TRADE_PAYABLES_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: CGST_INPUT_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: SGST_INPUT_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: IGST_INPUT_CODE } }),
  ]);
  if (!tradePayables) return res.status(500).json({ message: "Trade Payables account not found — re-run provisioning." });
  const { cgst: cgstTotal, sgst: sgstTotal, igst: igstTotal } = splitGst(taxTotal, interState);
  if (cgstTotal > 0 && !cgstInput) return res.status(500).json({ message: "CGST Input Credit account not found — re-run provisioning." });
  if (sgstTotal > 0 && !sgstInput) return res.status(500).json({ message: "SGST Input Credit account not found — re-run provisioning." });
  if (igstTotal > 0 && !igstInput) return res.status(500).json({ message: "IGST Input Credit account not found — re-run provisioning." });

  const count = await prisma.purchaseReturn.count({ where: { organizationId } });
  const returnNumber = `PR-${String(count + 1).padStart(4, "0")}`;
  const returnId = randomUUID();

  try {
    const created = await prisma.$transaction(async (tx) => {
      for (const l of computed) {
        await returnStockToVendor(tx, {
          organizationId, branchId: resolvedBranchId!, itemId: l.itemId,
          quantity: l.quantity, unitCost: l.rate, costingMethod: org.costingMethod!,
          referenceType: "purchase_return", referenceId: returnId, originalPurchaseBillId: purchaseBillId,
          movementDate: new Date(returnDate), narration: `Purchase return ${returnNumber}`,
        });
      }

      const journalEntry = await tx.journalEntry.create({
        data: {
          organizationId, branchId: resolvedBranchId, entryDate: new Date(returnDate),
          narration: narration || `Purchase return ${returnNumber} — ${bill.businessPartner.name}`,
          voucherType: "PR", referenceType: "purchase_return", createdBy: req.user!.userId,
        },
      });

      await tx.journalLine.createMany({
        data: [
          { journalEntryId: journalEntry.id, accountId: tradePayables.id, businessPartnerId: bill.businessPartnerId, debit: grandTotal, credit: 0, narration: `Debited to ${bill.businessPartner.name}` },
          ...computed.map((l) => ({
            journalEntryId: journalEntry.id,
            accountId: itemById.get(l.itemId)!.stockAccountId,
            businessPartnerId: itemById.get(l.itemId)!.businessPartnerId,
            debit: 0, credit: l.lineSubtotal,
            narration: `${itemById.get(l.itemId)!.sku} x ${l.quantity}`,
          })),
          ...(cgstTotal > 0 ? [{ journalEntryId: journalEntry.id, accountId: cgstInput!.id, businessPartnerId: null, debit: 0, credit: cgstTotal, narration: "CGST Input reversed" }] : []),
          ...(sgstTotal > 0 ? [{ journalEntryId: journalEntry.id, accountId: sgstInput!.id, businessPartnerId: null, debit: 0, credit: sgstTotal, narration: "SGST Input reversed" }] : []),
          ...(igstTotal > 0 ? [{ journalEntryId: journalEntry.id, accountId: igstInput!.id, businessPartnerId: null, debit: 0, credit: igstTotal, narration: "IGST Input reversed" }] : []),
        ],
      });

      const createdReturn = await tx.purchaseReturn.create({
        data: {
          id: returnId,
          organizationId, branchId: resolvedBranchId, purchaseBillId, businessPartnerId: bill.businessPartnerId,
          returnNumber, returnDate: new Date(returnDate), narration: narration ?? "",
          journalEntryId: journalEntry.id, subtotal, taxTotal, grandTotal,
          createdBy: req.user!.userId,
        },
      });

      await tx.purchaseReturnLine.createMany({
        data: computed.map((l) => ({
          purchaseReturnId: createdReturn.id, purchaseBillLineId: l.purchaseBillLineId, itemId: l.itemId,
          quantity: l.quantity, rate: l.rate, taxRate: l.taxRate,
          lineSubtotal: l.lineSubtotal, taxAmount: l.taxAmount, lineTotal: l.lineTotal,
        })),
      });

      return createdReturn;
    });

    logAudit({
      organizationId, actorUserId: req.user!.userId,
      action: "CREATE", entityType: "purchase_return", entityId: created.id,
      summary: `Posted purchase return ${returnNumber} — ${bill.businessPartner.name} (${Number(created.grandTotal).toFixed(2)})`,
    });
    res.status(201).json({ data: created });
  } catch (err: any) {
    if (err instanceof InsufficientStockError) return res.status(409).json({ message: err.message });
    if (err?.status) return res.status(err.status).json({ message: err.message });
    throw err;
  }
});

export default router;
