import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { round2 } from "../lib/discountGst";
import { buildPurchaseOrderPdf } from "../lib/purchaseOrderPdf";
import { isSupportedCurrency } from "../lib/currencies";

// A Purchase Order never touches the journal or stock — it's a
// pre-commitment/approval document only. See the schema.prisma comment on
// the PurchaseOrder model for the full status state machine, and
// routes/purchaseBills.ts for how an APPROVED PO turns into real postings.
const router = Router();
router.use(authenticate, requireActiveSubscription);
const canPost = requirePermission("purchase.post");
const canApprove = requirePermission("purchase.approve");

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
  // Foreign-currency POs only — the unit rate as entered, in the PO's
  // currency. When present (isForeign), it — not `rate` — is authoritative:
  // rate gets overwritten server-side as round2(rateFc * exchangeRate)
  // before anything else runs. Same convention as purchaseBills.ts.
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
    throw Object.assign(new Error("exchangeRate must be greater than 0 for a non-INR Purchase Order."), { status: 400 });
  }
  return { currencyCode, isForeign, fxRate };
}

const DETAIL_INCLUDE = {
  businessPartner: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  lines: { include: { item: { select: { id: true, sku: true, name: true } } } },
  purchaseBills: { select: { id: true, billNumber: true, billDate: true, grandTotal: true } },
  goodsReceiptNotes: { select: { id: true, grnNumber: true, grnDate: true } },
} as const;

router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const businessPartnerId = typeof req.query.businessPartnerId === "string" ? req.query.businessPartnerId : undefined;
  const orders = await prisma.purchaseOrder.findMany({
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
  const order = await prisma.purchaseOrder.findFirst({
    where: { id: req.params.id, organizationId },
    include: DETAIL_INCLUDE,
  });
  if (!order) return res.status(404).json({ message: "Purchase order not found." });
  res.json({ data: order });
});

// GET /purchase-orders/:id/pdf — the same information already on the
// detail screen, rendered as a downloadable document to actually send to
// the vendor. No extra permission beyond viewing the PO itself (this is a
// read/export action, not a workflow transition). See lib/purchaseOrderPdf.ts.
router.get("/:id/pdf", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const order = await prisma.purchaseOrder.findFirst({
    where: { id: req.params.id, organizationId },
    include: {
      businessPartner: { select: { name: true, gstin: true, address: true, phone: true, email: true } },
      branch: { select: { name: true, gstin: true, address: true, phone: true, email: true } },
      lines: { include: { item: { select: { sku: true, name: true, hsnCode: true, uom: true } } } },
    },
  });
  if (!order) return res.status(404).json({ message: "Purchase order not found." });

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, registeredOfficeAddress: true, cin: true },
  });
  if (!organization) return res.status(404).json({ message: "Organization not found." });

  const buffer = await buildPurchaseOrderPdf({
    poNumber: order.poNumber,
    poDate: order.poDate,
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
    vendor: {
      name: order.businessPartner.name, gstin: order.businessPartner.gstin,
      address: order.businessPartner.address, phone: order.businessPartner.phone, email: order.businessPartner.email,
    },
    lines: order.lines.map((l) => ({
      itemSku: l.item.sku, itemName: l.item.name, hsnCode: l.item.hsnCode, uom: l.item.uom,
      quantity: Number(l.quantity), rate: Number(l.rate), taxRate: Number(l.taxRate), lineTotal: Number(l.lineTotal),
    })),
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${order.poNumber}.pdf"`);
  res.send(buffer);
});

// Shared by POST / and PATCH /:id — validates + computes lines. Throws
// {status:400} on bad input, same convention as purchaseBills.ts. isForeign/
// fxRate come from resolveCurrency above — when isForeign, every line's
// rateFc (not rate) is authoritative, overwritten into an INR `rate` before
// any of the existing subtotal/tax math runs, so everything downstream
// (GRN unitCost, the approval threshold, PDF totals) keeps reading a plain
// INR `rate`/`grandTotal` exactly as it always has.
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

// POST /purchase-orders — always creates as DRAFT, freely editable from
// here via PATCH until it's submitted. No journal, no stock — purely a
// record until it's turned into a Purchase Bill after approval.
router.post("/", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const { businessPartnerId, poDate, branchId, expectedDeliveryDate, narration, lines, currency, exchangeRate } = req.body ?? {};
  if (!businessPartnerId || !poDate) {
    return res.status(400).json({ message: "businessPartnerId and poDate are required." });
  }

  const vendor = await prisma.businessPartner.findFirst({ where: { id: businessPartnerId, organizationId, bpType: "VENDOR" } });
  if (!vendor) return res.status(400).json({ message: "businessPartnerId must be an existing vendor." });
  if (vendor.approvalStatus !== "APPROVED") {
    return res.status(400).json({ message: `This vendor is ${vendor.approvalStatus === "PENDING_APPROVAL" ? "pending approval" : "rejected"} — approve it under Business Partners before raising a Purchase Order.` });
  }

  let resolvedBranchId: string | null = branchId ?? null;
  if (!resolvedBranchId) {
    const ho = await prisma.branch.findFirst({ where: { organizationId, isHeadOffice: true } });
    resolvedBranchId = ho?.id ?? null;
  }

  try {
    const { currencyCode, isForeign, fxRate } = resolveCurrency(currency, exchangeRate);
    const { computed, subtotal, taxTotal, grandTotal } = await resolveAndComputeLines(organizationId, lines, isForeign, fxRate);
    const grandTotalFc = isForeign ? round2(grandTotal / fxRate) : null;

    const count = await prisma.purchaseOrder.count({ where: { organizationId } });
    const poNumber = `PO-${String(count + 1).padStart(4, "0")}`;

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.purchaseOrder.create({
        data: {
          organizationId, branchId: resolvedBranchId, businessPartnerId,
          poNumber, poDate: new Date(poDate),
          expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : null,
          narration: narration ?? "",
          subtotal, taxTotal, grandTotal,
          currency: currencyCode, exchangeRate: fxRate, grandTotalFc,
          createdBy: req.user!.userId,
        },
      });
      await tx.purchaseOrderLine.createMany({
        data: computed.map((l) => ({ ...l, purchaseOrderId: created.id })),
      });
      return created;
    });

    logAudit({
      organizationId, actorUserId: req.user!.userId,
      action: "CREATE", entityType: "purchase_order", entityId: order.id,
      summary: `Created Purchase Order ${poNumber} — ${vendor.name} (Draft, ${grandTotal.toFixed(2)})`,
    });
    const withDetail = await prisma.purchaseOrder.findUnique({ where: { id: order.id }, include: DETAIL_INCLUDE });
    res.status(201).json({ data: withDetail });
  } catch (err: any) {
    if (err?.status === 400) return res.status(400).json({ message: err.message });
    throw err;
  }
});

// PATCH /purchase-orders/:id — full edit, DRAFT only. Replaces every line
// (this app has no per-line diffing anywhere else either — Stock
// Adjustment/Journal Entry lines work the same "replace wholesale" way
// when they're editable at all).
router.patch("/:id", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const existing = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, organizationId } });
  if (!existing) return res.status(404).json({ message: "Purchase order not found." });
  if (existing.status !== "DRAFT") {
    return res.status(400).json({ message: `Cannot edit a Purchase Order in ${existing.status} status — only Draft is editable.` });
  }

  const { businessPartnerId, poDate, branchId, expectedDeliveryDate, narration, lines, currency, exchangeRate } = req.body ?? {};

  let vendorId = existing.businessPartnerId;
  if (businessPartnerId && businessPartnerId !== existing.businessPartnerId) {
    const vendor = await prisma.businessPartner.findFirst({ where: { id: businessPartnerId, organizationId, bpType: "VENDOR" } });
    if (!vendor) return res.status(400).json({ message: "businessPartnerId must be an existing vendor." });
    if (vendor.approvalStatus !== "APPROVED") {
      return res.status(400).json({ message: `This vendor is ${vendor.approvalStatus === "PENDING_APPROVAL" ? "pending approval" : "rejected"} — approve it under Business Partners before raising a Purchase Order.` });
    }
    vendorId = businessPartnerId;
  }

  try {
    const { currencyCode, isForeign, fxRate } = resolveCurrency(
      currency !== undefined ? currency : existing.currency,
      exchangeRate !== undefined ? exchangeRate : existing.exchangeRate
    );
    const { computed, subtotal, taxTotal, grandTotal } = await resolveAndComputeLines(organizationId, lines ?? [], isForeign, fxRate);
    const grandTotalFc = isForeign ? round2(grandTotal / fxRate) : null;

    await prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id: existing.id },
        data: {
          businessPartnerId: vendorId,
          branchId: branchId !== undefined ? branchId : existing.branchId,
          poDate: poDate ? new Date(poDate) : existing.poDate,
          expectedDeliveryDate: expectedDeliveryDate !== undefined ? (expectedDeliveryDate ? new Date(expectedDeliveryDate) : null) : existing.expectedDeliveryDate,
          narration: narration !== undefined ? narration : existing.narration,
          subtotal, taxTotal, grandTotal,
          currency: currencyCode, exchangeRate: fxRate, grandTotalFc,
        },
      });
      await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: existing.id } });
      await tx.purchaseOrderLine.createMany({
        data: computed.map((l) => ({ ...l, purchaseOrderId: existing.id })),
      });
    });

    logAudit({
      organizationId, actorUserId: req.user!.userId,
      action: "UPDATE", entityType: "purchase_order", entityId: existing.id,
      summary: `Edited Purchase Order ${existing.poNumber} (Draft)`,
    });
    const withDetail = await prisma.purchaseOrder.findUnique({ where: { id: existing.id }, include: DETAIL_INCLUDE });
    res.json({ data: withDetail });
  } catch (err: any) {
    if (err?.status === 400) return res.status(400).json({ message: err.message });
    throw err;
  }
});

// POST /purchase-orders/:id/submit — DRAFT only. Auto-approves when the
// org has a poApprovalThreshold configured and this PO's grandTotal is
// strictly below it; otherwise goes to PENDING_APPROVAL for a
// purchase.approve holder to decide. See Organization.poApprovalThreshold.
router.post("/:id/submit", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const existing = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, organizationId } });
  if (!existing) return res.status(404).json({ message: "Purchase order not found." });
  if (existing.status !== "DRAFT") {
    return res.status(400).json({ message: `Only a Draft Purchase Order can be submitted (this one is ${existing.status}).` });
  }
  const lineCount = await prisma.purchaseOrderLine.count({ where: { purchaseOrderId: existing.id } });
  if (lineCount === 0) return res.status(400).json({ message: "Add at least one line before submitting." });

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { poApprovalThreshold: true } });
  const threshold = org?.poApprovalThreshold != null ? Number(org.poApprovalThreshold) : null;
  const autoApprove = threshold !== null && Number(existing.grandTotal) < threshold;

  const now = new Date();
  const updated = await prisma.purchaseOrder.update({
    where: { id: existing.id },
    data: autoApprove
      ? { status: "APPROVED", submittedBy: req.user!.userId, submittedAt: now, approvedAt: now, autoApproved: true }
      : { status: "PENDING_APPROVAL", submittedBy: req.user!.userId, submittedAt: now },
    include: DETAIL_INCLUDE,
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "purchase_order", entityId: existing.id,
    summary: autoApprove
      ? `Submitted Purchase Order ${existing.poNumber} — auto-approved (under ₹${threshold!.toFixed(2)} threshold)`
      : `Submitted Purchase Order ${existing.poNumber} for approval`,
  });
  res.json({ data: updated });
});

router.post("/:id/approve", canApprove, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const existing = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, organizationId } });
  if (!existing) return res.status(404).json({ message: "Purchase order not found." });
  if (existing.status !== "PENDING_APPROVAL") {
    return res.status(400).json({ message: `Only a Purchase Order pending approval can be approved (this one is ${existing.status}).` });
  }

  const updated = await prisma.purchaseOrder.update({
    where: { id: existing.id },
    data: { status: "APPROVED", approvedBy: req.user!.userId, approvedAt: new Date(), autoApproved: false },
    include: DETAIL_INCLUDE,
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "purchase_order", entityId: existing.id,
    summary: `Approved Purchase Order ${existing.poNumber}`,
  });
  res.json({ data: updated });
});

router.post("/:id/reject", canApprove, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const existing = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, organizationId } });
  if (!existing) return res.status(404).json({ message: "Purchase order not found." });
  if (existing.status !== "PENDING_APPROVAL") {
    return res.status(400).json({ message: `Only a Purchase Order pending approval can be rejected (this one is ${existing.status}).` });
  }
  const { reason } = req.body ?? {};
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ message: "A rejection reason is required." });
  }

  const updated = await prisma.purchaseOrder.update({
    where: { id: existing.id },
    data: { status: "REJECTED", rejectedBy: req.user!.userId, rejectedAt: new Date(), rejectionReason: String(reason).trim() },
    include: DETAIL_INCLUDE,
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "purchase_order", entityId: existing.id,
    summary: `Rejected Purchase Order ${existing.poNumber}: ${String(reason).trim()}`,
  });
  res.json({ data: updated });
});

// POST /purchase-orders/:id/reopen — REJECTED -> DRAFT, editable again via
// PATCH and resubmittable. The rejection reason/who/when stays on the
// record as history rather than being cleared.
router.post("/:id/reopen", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const existing = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, organizationId } });
  if (!existing) return res.status(404).json({ message: "Purchase order not found." });
  if (existing.status !== "REJECTED") {
    return res.status(400).json({ message: `Only a Rejected Purchase Order can be reopened (this one is ${existing.status}).` });
  }

  const updated = await prisma.purchaseOrder.update({
    where: { id: existing.id },
    data: { status: "DRAFT" },
    include: DETAIL_INCLUDE,
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "purchase_order", entityId: existing.id,
    summary: `Reopened Purchase Order ${existing.poNumber} to Draft`,
  });
  res.json({ data: updated });
});

// POST /purchase-orders/:id/cancel — DRAFT, PENDING_APPROVAL, or APPROVED
// (only if nothing's been received or billed against it yet — once a
// Goods Receipt Note or Purchase Bill references a line, the order is a
// real commitment with actual stock/money movement behind it and can't be
// cancelled out from under it).
router.post("/:id/cancel", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const existing = await prisma.purchaseOrder.findFirst({
    where: { id: req.params.id, organizationId },
    include: { lines: { select: { billedQuantity: true, receivedQuantity: true } } },
  });
  if (!existing) return res.status(404).json({ message: "Purchase order not found." });
  if (!["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(existing.status)) {
    return res.status(400).json({ message: `A Purchase Order in ${existing.status} status can't be cancelled.` });
  }
  const anyBilled = existing.lines.some((l) => Number(l.billedQuantity) > 0);
  if (anyBilled) {
    return res.status(400).json({ message: "Can't cancel — one or more lines already have Purchase Bills against them." });
  }
  const anyReceived = existing.lines.some((l) => Number(l.receivedQuantity) > 0);
  if (anyReceived) {
    return res.status(400).json({ message: "Can't cancel — one or more lines already have Goods Receipt Notes against them." });
  }

  const updated = await prisma.purchaseOrder.update({
    where: { id: existing.id },
    data: { status: "CANCELLED", cancelledBy: req.user!.userId, cancelledAt: new Date() },
    include: DETAIL_INCLUDE,
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "purchase_order", entityId: existing.id,
    summary: `Cancelled Purchase Order ${existing.poNumber}`,
  });
  res.json({ data: updated });
});

export default router;
