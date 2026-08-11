import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { round2 } from "../lib/discountGst";
import { buildSalesOrderPdf } from "../lib/salesOrderPdf";
import { isSupportedCurrency } from "../lib/currencies";

// A Sales Order never touches the journal or stock — it's a
// pre-commitment/approval document only, the exact sales-side mirror of
// PurchaseOrder. See the schema.prisma comment on the SalesOrder model for
// the full status state machine, and routes/deliveryNotes.ts /
// routes/salesInvoices.ts for how an APPROVED SO turns into real stock
// movement and postings.
const router = Router();
router.use(authenticate, requireActiveSubscription);
const canPost = requirePermission("sales.post");
const canApprove = requirePermission("sales.approve");

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
  // Foreign-currency SOs only — the unit rate as entered, in the SO's
  // currency. When present (isForeign), it — not `rate` — is authoritative:
  // rate gets overwritten server-side as round2(rateFc * exchangeRate)
  // before anything else runs. Same convention as salesInvoices.ts.
  rateFc?: number;
  taxRate?: number;
}

// Shared by POST / and PATCH /:id — validates currency/exchangeRate and
// returns the resolved { currencyCode, isForeign, fxRate } triple. Throws
// {status:400} on bad input, same convention as resolveAndComputeLines.
function resolveCurrency(currency: unknown, exchangeRate: unknown) {
  const currencyCode = String(currency || "INR").toUpperCase();
  if (!isSupportedCurrency(currencyCode)) {
    throw Object.assign(new Error(`Unsupported currency "${currencyCode}".`), { status: 400 });
  }
  const isForeign = currencyCode !== "INR";
  const fxRate = isForeign ? Number(exchangeRate) : 1;
  if (isForeign && !(fxRate > 0)) {
    throw Object.assign(new Error("exchangeRate must be greater than 0 for a non-INR Sales Order."), { status: 400 });
  }
  return { currencyCode, isForeign, fxRate };
}

const DETAIL_INCLUDE = {
  businessPartner: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  lines: { include: { item: { select: { id: true, sku: true, name: true } } } },
  salesInvoices: { select: { id: true, invoiceNumber: true, invoiceDate: true, grandTotal: true } },
  deliveryNotes: { select: { id: true, dnNumber: true, dnDate: true } },
} as const;

router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const businessPartnerId = typeof req.query.businessPartnerId === "string" ? req.query.businessPartnerId : undefined;
  const orders = await prisma.salesOrder.findMany({
    where: { organizationId, ...(status ? { status } : {}), ...(businessPartnerId ? { businessPartnerId } : {}) },
    include: {
      businessPartner: { select: { id: true, name: true } },
      lines: { include: { item: { select: { id: true, sku: true, name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json({ data: orders });
});

router.get("/:id", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const order = await prisma.salesOrder.findFirst({
    where: { id: req.params.id, organizationId },
    include: DETAIL_INCLUDE,
  });
  if (!order) return res.status(404).json({ message: "Sales order not found." });
  res.json({ data: order });
});

// GET /sales-orders/:id/pdf — the same information already on the detail
// screen, rendered as a downloadable document to actually send to the
// customer. No extra permission beyond viewing the SO itself (this is a
// read/export action, not a workflow transition). See lib/salesOrderPdf.ts.
router.get("/:id/pdf", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const order = await prisma.salesOrder.findFirst({
    where: { id: req.params.id, organizationId },
    include: {
      businessPartner: { select: { name: true, gstin: true, address: true, phone: true, email: true } },
      branch: { select: { name: true, gstin: true, address: true, phone: true, email: true } },
      lines: { include: { item: { select: { sku: true, name: true, hsnCode: true, uom: true } } } },
    },
  });
  if (!order) return res.status(404).json({ message: "Sales order not found." });

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, registeredOfficeAddress: true, cin: true },
  });
  if (!organization) return res.status(404).json({ message: "Organization not found." });

  const buffer = await buildSalesOrderPdf({
    soNumber: order.soNumber,
    soDate: order.soDate,
    expectedDeliveryDate: order.expectedDeliveryDate,
    status: order.status,
    narration: order.narration,
    subtotal: Number(order.subtotal),
    taxTotal: Number(order.taxTotal),
    grandTotal: Number(order.grandTotal),
    currency: order.currency,
    exchangeRate: Number(order.exchangeRate),
    grandTotalFc: order.grandTotalFc !== null ? Number(order.grandTotalFc) : null,
    organization: {
      name: organization.name,
      registeredOfficeAddress: organization.registeredOfficeAddress as string | null,
      cin: organization.cin,
    },
    branch: order.branch
      ? { name: order.branch.name, gstin: order.branch.gstin, address: order.branch.address, phone: order.branch.phone, email: order.branch.email }
      : null,
    customer: {
      name: order.businessPartner.name, gstin: order.businessPartner.gstin,
      address: order.businessPartner.address, phone: order.businessPartner.phone, email: order.businessPartner.email,
    },
    lines: order.lines.map((l) => ({
      itemSku: l.item.sku, itemName: l.item.name, hsnCode: l.item.hsnCode, uom: l.item.uom,
      quantity: Number(l.quantity), rate: Number(l.rate), taxRate: Number(l.taxRate), lineTotal: Number(l.lineTotal),
    })),
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${order.soNumber}.pdf"`);
  res.send(buffer);
});

// Shared by POST / and PATCH /:id — validates + computes lines. Throws
// {status:400} on bad input, same convention as purchaseOrders.ts. isForeign/
// fxRate come from resolveCurrency above — when isForeign, every line's
// rateFc (not rate) is authoritative, overwritten into an INR `rate` before
// any of the existing subtotal/tax math runs, so everything downstream
// (Delivery Note's descriptive rate, the approval threshold, PDF totals)
// keeps reading a plain INR `rate`/`grandTotal` exactly as it always has.
async function resolveAndComputeLines(organizationId: string, lines: LineInput[], isForeign: boolean, fxRate: number) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw Object.assign(new Error("At least one line is required."), { status: 400 });
  }
  const typedLines: LineInput[] = lines;
  const itemIds = [...new Set(typedLines.map((l) => l.itemId))];
  const items = await prisma.item.findMany({ where: { id: { in: itemIds }, organizationId, deletedAt: null } });
  if (items.length !== itemIds.length) {
    throw Object.assign(new Error("One or more items are invalid for this organization."), { status: 400 });
  }

  for (const l of typedLines) {
    if (isForeign) {
      if (!l.itemId || !(l.quantity > 0) || !(l.rateFc! >= 0)) {
        throw Object.assign(new Error("Every line needs itemId, quantity > 0, and rateFc >= 0."), { status: 400 });
      }
      l.rate = round2(l.rateFc! * fxRate);
    } else if (!l.itemId || !(l.quantity > 0) || !(l.rate >= 0)) {
      throw Object.assign(new Error("Every line needs itemId, quantity > 0, and rate >= 0."), { status: 400 });
    }
  }

  let subtotal = 0, taxTotal = 0;
  const computed = typedLines.map((l) => {
    const lineSubtotal = round2(l.quantity * l.rate);
    const taxAmount = round2(lineSubtotal * (l.taxRate ?? 0) / 100);
    const lineTotal = round2(lineSubtotal + taxAmount);
    subtotal += lineSubtotal; taxTotal += taxAmount;
    return {
      itemId: l.itemId, quantity: l.quantity, rate: l.rate, taxRate: l.taxRate ?? 0, lineSubtotal, taxAmount, lineTotal,
      rateFc: isForeign ? l.rateFc : null, lineTotalFc: isForeign ? round2(lineTotal / fxRate) : null,
    };
  });
  const grandTotal = round2(subtotal + taxTotal);
  return { computed, subtotal: round2(subtotal), taxTotal: round2(taxTotal), grandTotal };
}

// POST /sales-orders — always creates as DRAFT, freely editable from here
// via PATCH until it's submitted. No journal, no stock — purely a record
// until it's turned into a Delivery Note / Sales Invoice after approval.
router.post("/", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const { businessPartnerId, soDate, branchId, expectedDeliveryDate, narration, lines, currency, exchangeRate } = req.body ?? {};
  if (!businessPartnerId || !soDate) {
    return res.status(400).json({ message: "businessPartnerId and soDate are required." });
  }

  const customer = await prisma.businessPartner.findFirst({ where: { id: businessPartnerId, organizationId, bpType: "CUSTOMER" } });
  if (!customer) return res.status(400).json({ message: "businessPartnerId must be an existing customer." });

  let resolvedBranchId: string | null = branchId ?? null;
  if (!resolvedBranchId) {
    const ho = await prisma.branch.findFirst({ where: { organizationId, isHeadOffice: true } });
    resolvedBranchId = ho?.id ?? null;
  }

  try {
    const { currencyCode, isForeign, fxRate } = resolveCurrency(currency, exchangeRate);
    const { computed, subtotal, taxTotal, grandTotal } = await resolveAndComputeLines(organizationId, lines, isForeign, fxRate);
    const grandTotalFc = isForeign ? round2(grandTotal / fxRate) : null;

    const count = await prisma.salesOrder.count({ where: { organizationId } });
    const soNumber = `SO-${String(count + 1).padStart(4, "0")}`;

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.salesOrder.create({
        data: {
          organizationId, branchId: resolvedBranchId, businessPartnerId,
          soNumber, soDate: new Date(soDate),
          expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : null,
          narration: narration ?? "",
          subtotal, taxTotal, grandTotal,
          currency: currencyCode, exchangeRate: fxRate, grandTotalFc,
          createdBy: req.user!.userId,
        },
      });
      await tx.salesOrderLine.createMany({
        data: computed.map((l) => ({ ...l, salesOrderId: created.id })),
      });
      return created;
    });

    logAudit({
      organizationId, actorUserId: req.user!.userId,
      action: "CREATE", entityType: "sales_order", entityId: order.id,
      summary: `Created Sales Order ${soNumber} — ${customer.name} (Draft, ${grandTotal.toFixed(2)})`,
    });
    const withDetail = await prisma.salesOrder.findUnique({ where: { id: order.id }, include: DETAIL_INCLUDE });
    res.status(201).json({ data: withDetail });
  } catch (err: any) {
    if (err?.status === 400) return res.status(400).json({ message: err.message });
    throw err;
  }
});

// PATCH /sales-orders/:id — full edit, DRAFT only. Replaces every line,
// same "replace wholesale" convention as purchaseOrders.ts.
router.patch("/:id", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const existing = await prisma.salesOrder.findFirst({ where: { id: req.params.id, organizationId } });
  if (!existing) return res.status(404).json({ message: "Sales order not found." });
  if (existing.status !== "DRAFT") {
    return res.status(400).json({ message: `Cannot edit a Sales Order in ${existing.status} status — only Draft is editable.` });
  }

  const { businessPartnerId, soDate, branchId, expectedDeliveryDate, narration, lines, currency, exchangeRate } = req.body ?? {};

  let customerId = existing.businessPartnerId;
  if (businessPartnerId && businessPartnerId !== existing.businessPartnerId) {
    const customer = await prisma.businessPartner.findFirst({ where: { id: businessPartnerId, organizationId, bpType: "CUSTOMER" } });
    if (!customer) return res.status(400).json({ message: "businessPartnerId must be an existing customer." });
    customerId = businessPartnerId;
  }

  try {
    const { currencyCode, isForeign, fxRate } = resolveCurrency(
      currency !== undefined ? currency : existing.currency,
      exchangeRate !== undefined ? exchangeRate : existing.exchangeRate
    );
    const { computed, subtotal, taxTotal, grandTotal } = await resolveAndComputeLines(organizationId, lines ?? [], isForeign, fxRate);
    const grandTotalFc = isForeign ? round2(grandTotal / fxRate) : null;

    await prisma.$transaction(async (tx) => {
      await tx.salesOrder.update({
        where: { id: existing.id },
        data: {
          businessPartnerId: customerId,
          branchId: branchId !== undefined ? branchId : existing.branchId,
          soDate: soDate ? new Date(soDate) : existing.soDate,
          expectedDeliveryDate: expectedDeliveryDate !== undefined ? (expectedDeliveryDate ? new Date(expectedDeliveryDate) : null) : existing.expectedDeliveryDate,
          narration: narration !== undefined ? narration : existing.narration,
          subtotal, taxTotal, grandTotal,
          currency: currencyCode, exchangeRate: fxRate, grandTotalFc,
        },
      });
      await tx.salesOrderLine.deleteMany({ where: { salesOrderId: existing.id } });
      await tx.salesOrderLine.createMany({
        data: computed.map((l) => ({ ...l, salesOrderId: existing.id })),
      });
    });

    logAudit({
      organizationId, actorUserId: req.user!.userId,
      action: "UPDATE", entityType: "sales_order", entityId: existing.id,
      summary: `Edited Sales Order ${existing.soNumber} (Draft)`,
    });
    const withDetail = await prisma.salesOrder.findUnique({ where: { id: existing.id }, include: DETAIL_INCLUDE });
    res.json({ data: withDetail });
  } catch (err: any) {
    if (err?.status === 400) return res.status(400).json({ message: err.message });
    throw err;
  }
});

// POST /sales-orders/:id/submit — DRAFT only. Auto-approves when the org
// has a soApprovalThreshold configured and this SO's grandTotal is
// strictly below it; otherwise goes to PENDING_APPROVAL for a
// sales.approve holder to decide. See Organization.soApprovalThreshold.
router.post("/:id/submit", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const existing = await prisma.salesOrder.findFirst({ where: { id: req.params.id, organizationId } });
  if (!existing) return res.status(404).json({ message: "Sales order not found." });
  if (existing.status !== "DRAFT") {
    return res.status(400).json({ message: `Only a Draft Sales Order can be submitted (this one is ${existing.status}).` });
  }
  const lineCount = await prisma.salesOrderLine.count({ where: { salesOrderId: existing.id } });
  if (lineCount === 0) return res.status(400).json({ message: "Add at least one line before submitting." });

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { soApprovalThreshold: true } });
  const threshold = org?.soApprovalThreshold != null ? Number(org.soApprovalThreshold) : null;
  const autoApprove = threshold !== null && Number(existing.grandTotal) < threshold;

  const now = new Date();
  const updated = await prisma.salesOrder.update({
    where: { id: existing.id },
    data: autoApprove
      ? { status: "APPROVED", submittedBy: req.user!.userId, submittedAt: now, approvedAt: now, autoApproved: true }
      : { status: "PENDING_APPROVAL", submittedBy: req.user!.userId, submittedAt: now },
    include: DETAIL_INCLUDE,
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "sales_order", entityId: existing.id,
    summary: autoApprove
      ? `Submitted Sales Order ${existing.soNumber} — auto-approved (under ₹${threshold!.toFixed(2)} threshold)`
      : `Submitted Sales Order ${existing.soNumber} for approval`,
  });
  res.json({ data: updated });
});

router.post("/:id/approve", canApprove, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const existing = await prisma.salesOrder.findFirst({ where: { id: req.params.id, organizationId } });
  if (!existing) return res.status(404).json({ message: "Sales order not found." });
  if (existing.status !== "PENDING_APPROVAL") {
    return res.status(400).json({ message: `Only a Sales Order pending approval can be approved (this one is ${existing.status}).` });
  }

  const updated = await prisma.salesOrder.update({
    where: { id: existing.id },
    data: { status: "APPROVED", approvedBy: req.user!.userId, approvedAt: new Date(), autoApproved: false },
    include: DETAIL_INCLUDE,
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "sales_order", entityId: existing.id,
    summary: `Approved Sales Order ${existing.soNumber}`,
  });
  res.json({ data: updated });
});

router.post("/:id/reject", canApprove, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const existing = await prisma.salesOrder.findFirst({ where: { id: req.params.id, organizationId } });
  if (!existing) return res.status(404).json({ message: "Sales order not found." });
  if (existing.status !== "PENDING_APPROVAL") {
    return res.status(400).json({ message: `Only a Sales Order pending approval can be rejected (this one is ${existing.status}).` });
  }
  const { reason } = req.body ?? {};
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ message: "A rejection reason is required." });
  }

  const updated = await prisma.salesOrder.update({
    where: { id: existing.id },
    data: { status: "REJECTED", rejectedBy: req.user!.userId, rejectedAt: new Date(), rejectionReason: String(reason).trim() },
    include: DETAIL_INCLUDE,
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "sales_order", entityId: existing.id,
    summary: `Rejected Sales Order ${existing.soNumber}: ${String(reason).trim()}`,
  });
  res.json({ data: updated });
});

// POST /sales-orders/:id/reopen — REJECTED -> DRAFT, editable again via
// PATCH and resubmittable. The rejection reason/who/when stays on the
// record as history rather than being cleared.
router.post("/:id/reopen", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const existing = await prisma.salesOrder.findFirst({ where: { id: req.params.id, organizationId } });
  if (!existing) return res.status(404).json({ message: "Sales order not found." });
  if (existing.status !== "REJECTED") {
    return res.status(400).json({ message: `Only a Rejected Sales Order can be reopened (this one is ${existing.status}).` });
  }

  const updated = await prisma.salesOrder.update({
    where: { id: existing.id },
    data: { status: "DRAFT" },
    include: DETAIL_INCLUDE,
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "sales_order", entityId: existing.id,
    summary: `Reopened Sales Order ${existing.soNumber} to Draft`,
  });
  res.json({ data: updated });
});

// POST /sales-orders/:id/cancel — DRAFT, PENDING_APPROVAL, or APPROVED
// (only if nothing's been delivered or billed against it yet — once a
// Delivery Note or Sales Invoice references a line, the order is a real
// commitment with actual stock/money movement behind it and can't be
// cancelled out from under it).
router.post("/:id/cancel", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const existing = await prisma.salesOrder.findFirst({
    where: { id: req.params.id, organizationId },
    include: { lines: { select: { billedQuantity: true, deliveredQuantity: true } } },
  });
  if (!existing) return res.status(404).json({ message: "Sales order not found." });
  if (!["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(existing.status)) {
    return res.status(400).json({ message: `A Sales Order in ${existing.status} status can't be cancelled.` });
  }
  const anyBilled = existing.lines.some((l) => Number(l.billedQuantity) > 0);
  if (anyBilled) {
    return res.status(400).json({ message: "Can't cancel — one or more lines already have Sales Invoices against them." });
  }
  const anyDelivered = existing.lines.some((l) => Number(l.deliveredQuantity) > 0);
  if (anyDelivered) {
    return res.status(400).json({ message: "Can't cancel — one or more lines already have Delivery Notes against them." });
  }

  const updated = await prisma.salesOrder.update({
    where: { id: existing.id },
    data: { status: "CANCELLED", cancelledBy: req.user!.userId, cancelledAt: new Date() },
    include: DETAIL_INCLUDE,
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "sales_order", entityId: existing.id,
    summary: `Cancelled Sales Order ${existing.soNumber}`,
  });
  res.json({ data: updated });
});

export default router;
