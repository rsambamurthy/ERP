import { randomUUID } from "crypto";
import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { receiveStock } from "../lib/costing";
import { isInterState, splitGst } from "../lib/discountGst";

const TRADE_RECEIVABLES_CODE = "1005";
const SALES_REVENUE_CODE = "5001";
const CGST_OUTPUT_CODE = "2102";
const SGST_OUTPUT_CODE = "2103";
const IGST_OUTPUT_CODE = "2104";
const COGS_CODE = "4001";
const INVENTORY_ADJUSTMENTS_CODE = "4002"; // where a DAMAGED line's cost writes off to, instead of back to stock

const router = Router();
router.use(authenticate, requireActiveSubscription);
const canPost = requirePermission("sales.post");

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

interface LineInput {
  salesInvoiceLineId: string;
  quantity: number;
  condition: "GOOD" | "DAMAGED";
}

router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const returns = await prisma.salesReturn.findMany({
    where: { organizationId },
    include: {
      businessPartner: { select: { id: true, name: true } },
      salesInvoice: { select: { id: true, invoiceNumber: true } },
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
  const ret = await prisma.salesReturn.findFirst({
    where: { id: req.params.id, organizationId },
    include: {
      businessPartner: true,
      salesInvoice: { select: { id: true, invoiceNumber: true } },
      lines: { include: { item: true } },
      journalEntry: { include: { journalLines: true } },
    },
  });
  if (!ret) return res.status(404).json({ message: "Sales return not found." });
  res.json({ data: ret });
});

// GET /sales-returns/invoice/:invoiceId/lines — the original invoice's
// lines, each annotated with how much has already been returned, so the
// "new return" form can show and cap the remaining returnable quantity.
router.get("/invoice/:invoiceId/lines", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const invoice = await prisma.salesInvoice.findFirst({
    where: { id: req.params.invoiceId, organizationId },
    include: { lines: { include: { item: { select: { id: true, sku: true, name: true, uom: true } } } }, businessPartner: { select: { id: true, name: true } } },
  });
  if (!invoice) return res.status(404).json({ message: "Sales invoice not found." });

  const lineIds = invoice.lines.map((l) => l.id);
  const returned = await prisma.salesReturnLine.groupBy({
    by: ["salesInvoiceLineId"],
    where: { salesInvoiceLineId: { in: lineIds } },
    _sum: { quantity: true },
  });
  const returnedByLine = new Map(returned.map((r) => [r.salesInvoiceLineId, Number(r._sum.quantity ?? 0)]));

  res.json({
    data: {
      invoice: { id: invoice.id, invoiceNumber: invoice.invoiceNumber, businessPartner: invoice.businessPartner },
      lines: invoice.lines.map((l) => ({
        id: l.id, item: l.item, quantity: Number(l.quantity), rate: Number(l.rate), taxRate: Number(l.taxRate),
        unitCost: Number(l.unitCost),
        alreadyReturned: returnedByLine.get(l.id) ?? 0,
        remaining: Number(l.quantity) - (returnedByLine.get(l.id) ?? 0),
      })),
    },
  });
});

// POST /sales-returns — always against an existing Sales Invoice. Every
// line is capped at (that invoice line's quantity - already returned), so
// this can never overreturn even across multiple partial returns. GOOD
// lines re-enter sellable stock at the original invoice line's cost
// (receiveStock — a new FIFO lot, or folded into the weighted average);
// DAMAGED lines skip the stock movement entirely and write the cost off to
// Inventory Adjustments instead. Either way the customer is credited and
// Sales Revenue/CGST+SGST or IGST Output/COGS are reversed for the full
// returned amount — the GOOD/DAMAGED split only changes which account
// absorbs the cost. The inter/intra-state split is recomputed the same way
// the original invoice determined it (branch vs customer state), not
// copied from the invoice, since neither document stores that flag.
router.post("/", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const { salesInvoiceId, returnDate, branchId, narration, lines } = req.body ?? {};
  if (!salesInvoiceId || !returnDate || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ message: "salesInvoiceId, returnDate, and at least one line are required." });
  }

  const invoice = await prisma.salesInvoice.findFirst({
    where: { id: salesInvoiceId, organizationId },
    include: { lines: true, businessPartner: true },
  });
  if (!invoice) return res.status(400).json({ message: "salesInvoiceId must be an existing sales invoice for this org." });

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true } });
  if (!org?.costingMethod) return res.status(422).json({ message: "Set the organization's stock costing method first." });

  const resolvedBranchId: string | null = branchId ?? invoice.branchId ?? null;
  if (!resolvedBranchId) return res.status(400).json({ message: "No branch found — provide branchId." });
  const branch = await prisma.branch.findFirst({ where: { id: resolvedBranchId, organizationId }, select: { stateCode: true } });
  // Prefer the state code pinned on the invoice being reversed (migration_031)
  // over the customer master. A credit note must split exactly the way the
  // invoice it reverses did, and the master may have moved since. Falls back
  // to the master for invoices posted before that column existed.
  const partyStateCode = invoice.partyStateCode ?? invoice.businessPartner.stateCode;
  const interState = isInterState(branch?.stateCode, partyStateCode);

  const typedLines: LineInput[] = lines;
  for (const l of typedLines) {
    if (!l.salesInvoiceLineId || !(l.quantity > 0) || !["GOOD", "DAMAGED"].includes(l.condition)) {
      return res.status(400).json({ message: "Every line needs salesInvoiceLineId, quantity > 0, and condition (GOOD/DAMAGED)." });
    }
  }

  const originalById = new Map(invoice.lines.map((l) => [l.id, l]));
  for (const l of typedLines) {
    if (!originalById.has(l.salesInvoiceLineId)) {
      return res.status(400).json({ message: `Line ${l.salesInvoiceLineId} does not belong to this invoice.` });
    }
  }

  const lineIds = typedLines.map((l) => l.salesInvoiceLineId);
  const alreadyReturned = await prisma.salesReturnLine.groupBy({
    by: ["salesInvoiceLineId"],
    where: { salesInvoiceLineId: { in: lineIds } },
    _sum: { quantity: true },
  });
  const returnedByLine = new Map(alreadyReturned.map((r) => [r.salesInvoiceLineId, Number(r._sum.quantity ?? 0)]));

  // Same item can appear twice in one submission (e.g. part good, part
  // damaged) — cap against cumulative requested quantity too, not just
  // each row against history in isolation.
  const requestedByLine = new Map<string, number>();

  let subtotal = 0, taxTotal = 0, totalCogsReversed = 0;
  const computed = typedLines.map((l) => {
    const original = originalById.get(l.salesInvoiceLineId)!;
    const already = returnedByLine.get(l.salesInvoiceLineId) ?? 0;
    const requestedSoFar = requestedByLine.get(l.salesInvoiceLineId) ?? 0;
    const remaining = Number(original.quantity) - already - requestedSoFar;
    if (l.quantity > remaining + 0.0001) {
      throw Object.assign(new Error(`Cannot return ${l.quantity} — only ${Math.max(remaining, 0)} remaining on this invoice line.`), { status: 409 });
    }
    requestedByLine.set(l.salesInvoiceLineId, requestedSoFar + l.quantity);

    const rate = Number(original.rate);
    const taxRate = Number(original.taxRate);
    const unitCost = Number(original.unitCost);
    const lineSubtotal = Math.round(l.quantity * rate * 100) / 100;
    const taxAmount = Math.round((lineSubtotal * taxRate) / 100 * 100) / 100;
    const lineTotal = lineSubtotal + taxAmount;
    const lineCogsReversed = Math.round(l.quantity * unitCost * 100) / 100;

    subtotal += lineSubtotal; taxTotal += taxAmount; totalCogsReversed += lineCogsReversed;
    return {
      salesInvoiceLineId: l.salesInvoiceLineId, itemId: original.itemId, quantity: l.quantity, condition: l.condition,
      rate, taxRate, unitCost, lineSubtotal, taxAmount, lineTotal, lineCogsReversed,
    };
  });
  const grandTotal = subtotal + taxTotal;
  const damagedTotal = computed.filter((l) => l.condition === "DAMAGED").reduce((s, l) => s + l.lineCogsReversed, 0);

  const itemIds = [...new Set(computed.map((l) => l.itemId))];
  const items = await prisma.item.findMany({ where: { id: { in: itemIds }, organizationId } });
  const itemById = new Map(items.map((i) => [i.id, i]));

  const [tradeReceivables, salesRevenue, cgstOutput, sgstOutput, igstOutput, cogs, inventoryAdjustments] = await Promise.all([
    prisma.account.findFirst({ where: { organizationId, accountCode: TRADE_RECEIVABLES_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: SALES_REVENUE_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: CGST_OUTPUT_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: SGST_OUTPUT_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: IGST_OUTPUT_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: COGS_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: INVENTORY_ADJUSTMENTS_CODE } }),
  ]);
  if (!tradeReceivables || !salesRevenue || !cogs) {
    return res.status(500).json({ message: "Core Sales accounts not found — re-run provisioning." });
  }
  const { cgst: cgstTotal, sgst: sgstTotal, igst: igstTotal } = splitGst(taxTotal, interState);
  if (cgstTotal > 0 && !cgstOutput) return res.status(500).json({ message: "CGST Output Payable account not found — re-run provisioning." });
  if (sgstTotal > 0 && !sgstOutput) return res.status(500).json({ message: "SGST Output Payable account not found — re-run provisioning." });
  if (igstTotal > 0 && !igstOutput) return res.status(500).json({ message: "IGST Output Payable account not found — re-run provisioning." });
  if (damagedTotal > 0 && !inventoryAdjustments) return res.status(500).json({ message: "Inventory Adjustments account not found — re-run provisioning." });

  const count = await prisma.salesReturn.count({ where: { organizationId } });
  const returnNumber = `SR-${String(count + 1).padStart(4, "0")}`;
  const returnId = randomUUID();

  try {
    const created = await prisma.$transaction(async (tx) => {
      for (const l of computed) {
        if (l.condition === "GOOD") {
          await receiveStock(tx, {
            organizationId, branchId: resolvedBranchId!, itemId: l.itemId,
            quantity: l.quantity, unitCost: l.unitCost, costingMethod: org.costingMethod!,
            movementType: "SALES_RETURN_IN", referenceType: "sales_return", referenceId: returnId,
            movementDate: new Date(returnDate), narration: `Sales return ${returnNumber}`,
          });
        }
        // DAMAGED: no stock movement — it never re-enters sellable on-hand.
      }

      const journalEntry = await tx.journalEntry.create({
        data: {
          organizationId, branchId: resolvedBranchId, entryDate: new Date(returnDate),
          narration: narration || `Sales return ${returnNumber} — ${invoice.businessPartner.name}`,
          voucherType: "SR", referenceType: "sales_return", createdBy: req.user!.userId,
        },
      });

      await tx.journalLine.createMany({
        data: [
          { journalEntryId: journalEntry.id, accountId: salesRevenue.id, businessPartnerId: null, debit: subtotal, credit: 0, narration: `Sales return — ${returnNumber}` },
          ...(cgstTotal > 0 ? [{ journalEntryId: journalEntry.id, accountId: cgstOutput!.id, businessPartnerId: null, debit: cgstTotal, credit: 0, narration: "CGST Output reversed" }] : []),
          ...(sgstTotal > 0 ? [{ journalEntryId: journalEntry.id, accountId: sgstOutput!.id, businessPartnerId: null, debit: sgstTotal, credit: 0, narration: "SGST Output reversed" }] : []),
          ...(igstTotal > 0 ? [{ journalEntryId: journalEntry.id, accountId: igstOutput!.id, businessPartnerId: null, debit: igstTotal, credit: 0, narration: "IGST Output reversed" }] : []),
          { journalEntryId: journalEntry.id, accountId: tradeReceivables.id, businessPartnerId: invoice.businessPartnerId, debit: 0, credit: grandTotal, narration: `Credited to ${invoice.businessPartner.name}` },
          { journalEntryId: journalEntry.id, accountId: cogs.id, businessPartnerId: null, debit: 0, credit: totalCogsReversed, narration: `Cost of goods sold reversed — ${returnNumber}` },
          ...computed.filter((l) => l.condition === "GOOD").map((l) => ({
            journalEntryId: journalEntry.id,
            accountId: itemById.get(l.itemId)!.stockAccountId,
            businessPartnerId: itemById.get(l.itemId)!.businessPartnerId,
            debit: l.lineCogsReversed, credit: 0,
            narration: `${itemById.get(l.itemId)!.sku} x ${l.quantity} (good)`,
          })),
          ...(damagedTotal > 0 ? [{ journalEntryId: journalEntry.id, accountId: inventoryAdjustments!.id, businessPartnerId: null, debit: damagedTotal, credit: 0, narration: "Damaged return — written off" }] : []),
        ],
      });

      const createdReturn = await tx.salesReturn.create({
        data: {
          id: returnId,
          organizationId, branchId: resolvedBranchId, salesInvoiceId, businessPartnerId: invoice.businessPartnerId,
          returnNumber, returnDate: new Date(returnDate), narration: narration ?? "",
          journalEntryId: journalEntry.id, subtotal, taxTotal, grandTotal, totalCogsReversed,
          // Inherited from the invoice's own snapshot rather than re-read
          // from the master, so a credit note always reports the identity
          // the original invoice was filed under — migration_031.
          partyGstin: invoice.partyGstin ?? invoice.businessPartner.gstin ?? null,
          partyName: invoice.partyName ?? invoice.businessPartner.name,
          partyStateCode: partyStateCode ?? null,
          createdBy: req.user!.userId,
        },
      });

      await tx.salesReturnLine.createMany({
        data: computed.map((l) => {
          // Split each line at posting instead of leaving the GST reports to
          // recompute it from whatever the master says at read time.
          const { cgst, sgst, igst } = splitGst(l.taxAmount, interState);
          return {
            salesReturnId: createdReturn.id, salesInvoiceLineId: l.salesInvoiceLineId, itemId: l.itemId,
            quantity: l.quantity, condition: l.condition, rate: l.rate, taxRate: l.taxRate,
            lineSubtotal: l.lineSubtotal, taxAmount: l.taxAmount, lineTotal: l.lineTotal,
            unitCost: l.unitCost, lineCogsReversed: l.lineCogsReversed,
            cgstAmount: cgst, sgstAmount: sgst, igstAmount: igst,
          };
        }),
      });

      return createdReturn;
    });

    logAudit({
      organizationId, actorUserId: req.user!.userId,
      action: "CREATE", entityType: "sales_return", entityId: created.id,
      summary: `Posted sales return ${returnNumber} — ${invoice.businessPartner.name} (${Number(created.grandTotal).toFixed(2)})`,
    });
    res.status(201).json({ data: created });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ message: err.message });
    throw err;
  }
});

export default router;
