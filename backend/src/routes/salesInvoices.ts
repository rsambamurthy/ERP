import { randomUUID } from "crypto";
import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { consumeStock, InsufficientStockError } from "../lib/costing";

const TRADE_RECEIVABLES_CODE = "1005";
const SALES_REVENUE_CODE = "5001";
const GST_OUTPUT_CODE = "2101";
const COGS_CODE = "4001";

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
  itemId: string;
  quantity: number;
  rate: number;
  taxRate?: number;
}

router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const invoices = await prisma.salesInvoice.findMany({
    where: { organizationId },
    include: { businessPartner: { select: { id: true, name: true } }, lines: { include: { item: { select: { id: true, sku: true, name: true } } } } },
    orderBy: { invoiceDate: "desc" },
    take: 200,
  });
  res.json({ data: invoices });
});

router.get("/:id", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const invoice = await prisma.salesInvoice.findFirst({
    where: { id: req.params.id, organizationId },
    include: { businessPartner: true, lines: { include: { item: true } }, journalEntry: { include: { journalLines: true } } },
  });
  if (!invoice) return res.status(404).json({ message: "Sales invoice not found." });
  res.json({ data: invoice });
});

// POST /sales-invoices — create and post in one step. Stock outward for
// every line (rejected if any line's branch stock can't cover it), one
// journal entry: Dr Trade Receivables (tagged the customer) / Cr Sales
// Revenue + Cr GST Output, and Dr Cost of Goods Sold / Cr each item's
// stock account (tagged that item's own ITEM business partner).
router.post("/", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const { businessPartnerId, invoiceDate, branchId, narration, lines } = req.body ?? {};
  if (!businessPartnerId || !invoiceDate || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ message: "businessPartnerId, invoiceDate, and at least one line are required." });
  }

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true } });
  if (!org?.costingMethod) return res.status(422).json({ message: "Set the organization's stock costing method first." });

  const customer = await prisma.businessPartner.findFirst({ where: { id: businessPartnerId, organizationId, bpType: "CUSTOMER" } });
  if (!customer) return res.status(400).json({ message: "businessPartnerId must be an existing customer." });

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

  for (const l of typedLines) {
    if (!l.itemId || !(l.quantity > 0) || !(l.rate >= 0)) {
      return res.status(400).json({ message: "Every line needs itemId, quantity > 0, and rate >= 0." });
    }
  }

  const [tradeReceivables, salesRevenue, gstOutput, cogs] = await Promise.all([
    prisma.account.findFirst({ where: { organizationId, accountCode: TRADE_RECEIVABLES_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: SALES_REVENUE_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: GST_OUTPUT_CODE } }),
    prisma.account.findFirst({ where: { organizationId, accountCode: COGS_CODE } }),
  ]);
  if (!tradeReceivables || !salesRevenue || !cogs) {
    return res.status(500).json({ message: "Core Sales accounts not found — re-run provisioning." });
  }

  const count = await prisma.salesInvoice.count({ where: { organizationId } });
  const invoiceNumber = `SI-${String(count + 1).padStart(4, "0")}`;

  const invoiceId = randomUUID();

  try {
    const invoice = await prisma.$transaction(async (tx) => {
      // Consume stock first — need each line's real cost before the
      // journal entry can be built, and this is where insufficient stock
      // fails the whole transaction atomically. The invoice id is
      // generated upfront (rather than left blank and backfilled) so the
      // StockMovement rows created here can reference it directly.
      let subtotal = 0, taxTotal = 0, totalCogs = 0;
      const computed = [];
      for (const l of typedLines) {
        const lineSubtotal = Math.round(l.quantity * l.rate * 100) / 100;
        const taxAmount = Math.round(lineSubtotal * (l.taxRate ?? 0) / 100 * 100) / 100;
        const { unitCost, totalCost } = await consumeStock(tx, {
          organizationId, branchId: resolvedBranchId!, itemId: l.itemId,
          quantity: l.quantity, costingMethod: org.costingMethod!,
          movementType: "SALE", referenceType: "sales_invoice", referenceId: invoiceId,
          movementDate: new Date(invoiceDate), narration: `Sales invoice ${invoiceNumber}`,
        });
        subtotal += lineSubtotal; taxTotal += taxAmount; totalCogs += totalCost;
        computed.push({ ...l, lineSubtotal, taxAmount, lineTotal: lineSubtotal + taxAmount, unitCost, lineCogs: Math.round(totalCost * 100) / 100 });
      }
      const grandTotal = subtotal + taxTotal;

      if (taxTotal > 0 && !gstOutput) {
        throw Object.assign(new Error("GST Output Payable account not found — re-run provisioning."), { status: 500 });
      }

      const journalEntry = await tx.journalEntry.create({
        data: {
          organizationId, branchId: resolvedBranchId, entryDate: new Date(invoiceDate),
          narration: narration || `Sales invoice ${invoiceNumber} — ${customer.name}`,
          voucherType: "SI", referenceType: "sales_invoice", createdBy: req.user!.userId,
        },
      });

      await tx.journalLine.createMany({
        data: [
          { journalEntryId: journalEntry.id, accountId: tradeReceivables.id, businessPartnerId: customer.id, debit: grandTotal, credit: 0, narration: `Receivable from ${customer.name}` },
          { journalEntryId: journalEntry.id, accountId: salesRevenue.id, businessPartnerId: null, debit: 0, credit: subtotal, narration: `Sales revenue — ${invoiceNumber}` },
          ...(taxTotal > 0 ? [{ journalEntryId: journalEntry.id, accountId: gstOutput!.id, businessPartnerId: null, debit: 0, credit: taxTotal, narration: "GST Output" }] : []),
          { journalEntryId: journalEntry.id, accountId: cogs.id, businessPartnerId: null, debit: totalCogs, credit: 0, narration: `Cost of goods sold — ${invoiceNumber}` },
          ...computed.map((l) => ({
            journalEntryId: journalEntry.id,
            accountId: itemById.get(l.itemId)!.stockAccountId,
            businessPartnerId: itemById.get(l.itemId)!.businessPartnerId,
            debit: 0, credit: l.lineCogs,
            narration: `${itemById.get(l.itemId)!.sku} x ${l.quantity}`,
          })),
        ],
      });

      const created = await tx.salesInvoice.create({
        data: {
          id: invoiceId,
          organizationId, branchId: resolvedBranchId, businessPartnerId,
          invoiceNumber, invoiceDate: new Date(invoiceDate), narration: narration ?? "",
          journalEntryId: journalEntry.id, subtotal, taxTotal, grandTotal, totalCogs,
          createdBy: req.user!.userId,
        },
      });

      await tx.salesInvoiceLine.createMany({
        data: computed.map((l) => ({
          salesInvoiceId: created.id, itemId: l.itemId, quantity: l.quantity, rate: l.rate,
          taxRate: l.taxRate ?? 0, lineSubtotal: l.lineSubtotal, taxAmount: l.taxAmount, lineTotal: l.lineTotal,
          unitCost: l.unitCost, lineCogs: l.lineCogs,
        })),
      });

      return created;
    });

    logAudit({
      organizationId, actorUserId: req.user!.userId,
      action: "CREATE", entityType: "sales_invoice", entityId: invoice.id,
      summary: `Posted sales invoice ${invoiceNumber} — ${customer.name} (${Number(invoice.grandTotal).toFixed(2)})`,
    });
    res.status(201).json({ data: invoice });
  } catch (err: any) {
    if (err instanceof InsufficientStockError) return res.status(409).json({ message: err.message });
    if (err?.status) return res.status(err.status).json({ message: err.message });
    throw err;
  }
});

export default router;
