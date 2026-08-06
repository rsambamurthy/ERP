import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requireRole, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { receiveStock } from "../lib/costing";

// Every org's core COA (seed.ts) always includes these — same convention
// journal.ts uses for CASH_BANK_CODES.
const TRADE_PAYABLES_CODE = "2001";
const GST_INPUT_CODE = "1101";

const router = Router();
router.use(authenticate, requireActiveSubscription);
const canPost = requireRole("OWNER", "ADMIN", "ACCOUNTANT");

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
  quantity: number;
  rate: number;
  taxRate?: number;
}

router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const bills = await prisma.purchaseBill.findMany({
    where: { organizationId },
    include: { businessPartner: { select: { id: true, name: true } }, lines: { include: { item: { select: { id: true, sku: true, name: true } } } } },
    orderBy: { billDate: "desc" },
    take: 200,
  });
  res.json({ data: bills });
});

router.get("/:id", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const bill = await prisma.purchaseBill.findFirst({
    where: { id: req.params.id, organizationId },
    include: { businessPartner: true, lines: { include: { item: true } }, journalEntry: { include: { journalLines: true } } },
  });
  if (!bill) return res.status(404).json({ message: "Purchase bill not found." });
  res.json({ data: bill });
});

// POST /purchase-bills — create and post in one step, same UX as journal
// entries. Stock inward for every line, one journal entry: Dr each item's
// stock account (tagged that item's own ITEM business partner) + Dr GST
// Input Credit, Cr Trade Payables (tagged the vendor).
router.post("/", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const { businessPartnerId, billDate, branchId, narration, lines } = req.body ?? {};
  if (!businessPartnerId || !billDate || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ message: "businessPartnerId, billDate, and at least one line are required." });
  }

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true } });
  if (!org?.costingMethod) return res.status(422).json({ message: "Set the organization's stock costing method first." });

  const vendor = await prisma.businessPartner.findFirst({ where: { id: businessPartnerId, organizationId, bpType: "VENDOR" } });
  if (!vendor) return res.status(400).json({ message: "businessPartnerId must be an existing vendor." });

  let resolvedBranchId: string | null = branchId ?? null;
  if (!resolvedBranchId) {
    const ho = await prisma.branch.findFirst({ where: { organizationId, isHeadOffice: true } });
    resolvedBranchId = ho?.id ?? null;
  }
  if (!resolvedBranchId) return res.status(400).json({ message: "No branch found — provide branchId." });

  const typedLines: LineInput[] = lines;
  const itemIds = [...new Set(typedLines.map((l) => l.itemId))];
  const items = await prisma.item.findMany({ where: { id: { in: itemIds }, organizationId, deletedAt: null } });
  if (items.length !== itemIds.length) return res.status(400).json({ message: "One or more items are invalid for this organization." });
  const itemById = new Map(items.map((i) => [i.id, i]));

  let subtotal = 0, taxTotal = 0;
  const computed = typedLines.map((l) => {
    if (!l.itemId || !(l.quantity > 0) || !(l.rate >= 0)) {
      throw Object.assign(new Error("Every line needs itemId, quantity > 0, and rate >= 0."), { status: 400 });
    }
    const lineSubtotal = Math.round(l.quantity * l.rate * 100) / 100;
    const taxAmount = Math.round(lineSubtotal * (l.taxRate ?? 0) / 100 * 100) / 100;
    subtotal += lineSubtotal; taxTotal += taxAmount;
    return { ...l, lineSubtotal, taxAmount, lineTotal: lineSubtotal + taxAmount };
  });
  const grandTotal = subtotal + taxTotal;

  const [gstInput, tradePayables] = await Promise.all([
    prisma.account.findFirst({ where: { organizationId, accountCode: GST_INPUT_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: TRADE_PAYABLES_CODE } }),
  ]);
  if (!tradePayables) return res.status(500).json({ message: "Trade Payables account not found — re-run provisioning." });
  if (taxTotal > 0 && !gstInput) return res.status(500).json({ message: "GST Input Credit account not found — re-run provisioning." });

  const count = await prisma.purchaseBill.count({ where: { organizationId } });
  const billNumber = `PB-${String(count + 1).padStart(4, "0")}`;

  try {
    const bill = await prisma.$transaction(async (tx) => {
      const journalEntry = await tx.journalEntry.create({
        data: {
          organizationId, branchId: resolvedBranchId, entryDate: new Date(billDate),
          narration: narration || `Purchase bill ${billNumber} — ${vendor.name}`,
          voucherType: "PB", referenceType: "purchase_bill", createdBy: req.user!.userId,
        },
      });

      await tx.journalLine.createMany({
        data: [
          ...computed.map((l) => ({
            journalEntryId: journalEntry.id,
            accountId: itemById.get(l.itemId)!.stockAccountId,
            businessPartnerId: itemById.get(l.itemId)!.businessPartnerId,
            debit: l.lineSubtotal, credit: 0,
            narration: `${itemById.get(l.itemId)!.sku} x ${l.quantity}`,
          })),
          ...(taxTotal > 0 ? [{ journalEntryId: journalEntry.id, accountId: gstInput!.id, businessPartnerId: null, debit: taxTotal, credit: 0, narration: "GST Input" }] : []),
          { journalEntryId: journalEntry.id, accountId: tradePayables.id, businessPartnerId: vendor.id, debit: 0, credit: grandTotal, narration: `Payable to ${vendor.name}` },
        ],
      });

      const created = await tx.purchaseBill.create({
        data: {
          organizationId, branchId: resolvedBranchId, businessPartnerId,
          billNumber, billDate: new Date(billDate), narration: narration ?? "",
          journalEntryId: journalEntry.id, subtotal, taxTotal, grandTotal,
          createdBy: req.user!.userId,
        },
      });

      await tx.purchaseBillLine.createMany({
        data: computed.map((l) => ({
          purchaseBillId: created.id, itemId: l.itemId, quantity: l.quantity, rate: l.rate,
          taxRate: l.taxRate ?? 0, lineSubtotal: l.lineSubtotal, taxAmount: l.taxAmount, lineTotal: l.lineTotal,
        })),
      });

      for (const l of computed) {
        await receiveStock(tx, {
          organizationId, branchId: resolvedBranchId!, itemId: l.itemId,
          quantity: l.quantity, unitCost: l.rate, costingMethod: org.costingMethod!,
          movementType: "PURCHASE", referenceType: "purchase_bill", referenceId: created.id,
          movementDate: new Date(billDate), narration: `Purchase bill ${billNumber}`,
        });
      }

      return created;
    });

    logAudit({
      organizationId, actorUserId: req.user!.userId,
      action: "CREATE", entityType: "purchase_bill", entityId: bill.id,
      summary: `Posted purchase bill ${billNumber} — ${vendor.name} (${grandTotal.toFixed(2)})`,
    });
    res.status(201).json({ data: bill });
  } catch (err: any) {
    if (err?.status === 400) return res.status(400).json({ message: err.message });
    throw err;
  }
});

export default router;
