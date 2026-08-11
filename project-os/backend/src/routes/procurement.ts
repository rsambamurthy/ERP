import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requireRole } from "../middleware/auth";
import { pushPurchaseOrderToSmartErp } from "../lib/smartErpPush";

const router = Router();
router.use(authenticate);

async function getOrgProject(projectId: string, organizationId: string) {
  return prisma.project.findFirst({ where: { id: projectId, organizationId, deletedAt: null } });
}

// ---------------------------------------------------------------------
// Material Request (Section 6.4)
// Role matrix (PRD Section 10): create = Project Manager or Site
// Engineer; approve = Project Manager. Procurement role is read-only
// on MRs — its work starts at RFQ.
// ---------------------------------------------------------------------

router.post("/material-requests", requireRole("SUPER_ADMIN", "PROJECT_MANAGER", "SITE_ENGINEER"), async (req, res) => {
  const { projectId, boqLineId, quantity } = req.body ?? {};
  const project = await getOrgProject(projectId, req.user!.organizationId);
  if (!project) return res.status(404).json({ message: "Project not found." });
  if (quantity == null || Number(quantity) <= 0) return res.status(400).json({ message: "quantity is required and must be greater than 0." });

  if (boqLineId) {
    const line = await prisma.boqLine.findFirst({ where: { id: boqLineId, boq: { projectId: project.id } } });
    if (!line) return res.status(404).json({ message: "BOQ line not found on this project." });
  }

  // Created straight into SUBMITTED — R1 collapses the Draft step, same
  // simplification used for BOQ (Draft -> Imported on first write).
  const mr = await prisma.materialRequest.create({
    data: { projectId: project.id, boqLineId: boqLineId ?? null, quantity, status: "SUBMITTED", requestedByOrgUserId: req.user!.orgUserId },
  });
  res.status(201).json({ data: mr });
});

router.get("/material-requests/project/:projectId", async (req, res) => {
  const project = await getOrgProject(req.params.projectId, req.user!.organizationId);
  if (!project) return res.status(404).json({ message: "Project not found." });
  const mrs = await prisma.materialRequest.findMany({
    where: { projectId: project.id }, orderBy: { createdAt: "desc" }, include: { boqLine: true },
  });
  res.json({ data: mrs });
});

router.patch("/material-requests/:id/approve", requireRole("SUPER_ADMIN", "PROJECT_MANAGER"), async (req, res) => {
  const mr = await prisma.materialRequest.findUnique({ where: { id: req.params.id }, include: { project: true } });
  if (!mr || mr.project.organizationId !== req.user!.organizationId) return res.status(404).json({ message: "Material Request not found." });
  if (mr.status !== "SUBMITTED") return res.status(409).json({ message: `Cannot approve a Material Request in "${mr.status}" status.` });

  const updated = await prisma.materialRequest.update({ where: { id: mr.id }, data: { status: "APPROVED" } });
  res.json({ data: updated });
});

// ---------------------------------------------------------------------
// RFQ + Supplier Quotation (Section 6.4)
// Create/Edit = Procurement role. Project Manager is view-only here.
// ---------------------------------------------------------------------

router.post("/rfq", requireRole("SUPER_ADMIN", "PROCUREMENT"), async (req, res) => {
  const { materialRequestId, supplierIds } = req.body ?? {};
  const mr = await prisma.materialRequest.findUnique({ where: { id: materialRequestId }, include: { project: true } });
  if (!mr || mr.project.organizationId !== req.user!.organizationId) return res.status(404).json({ message: "Material Request not found." });
  if (mr.status !== "APPROVED") return res.status(409).json({ message: "The Material Request must be Approved before an RFQ can be raised against it." });
  if (!Array.isArray(supplierIds) || supplierIds.length === 0) return res.status(400).json({ message: "supplierIds must be a non-empty array." });

  const suppliers = await prisma.syncedBusinessPartner.findMany({
    where: { id: { in: supplierIds }, organizationId: req.user!.organizationId, bpType: "VENDOR" },
  });
  if (suppliers.length !== supplierIds.length) return res.status(400).json({ message: "One or more supplierIds are invalid." });

  const rfq = await prisma.rfq.create({
    data: {
      materialRequestId: mr.id,
      status: "ISSUED", // R1 collapses Draft -> Issued into one step, same as MR/BOQ
      suppliers: { create: supplierIds.map((supplierId: string) => ({ supplierId })) },
    },
    include: { suppliers: { include: { supplier: true } } },
  });
  res.status(201).json({ data: rfq });
});

router.get("/rfq/:id", async (req, res) => {
  const rfq = await prisma.rfq.findUnique({
    where: { id: req.params.id },
    include: {
      materialRequest: { include: { project: true, boqLine: true } },
      suppliers: { include: { supplier: true } },
      quotations: { include: { supplier: true } },
    },
  });
  if (!rfq || rfq.materialRequest.project.organizationId !== req.user!.organizationId) {
    return res.status(404).json({ message: "RFQ not found." });
  }
  res.json({ data: rfq });
});

router.post("/rfq/:id/quotations", requireRole("SUPER_ADMIN", "PROCUREMENT"), async (req, res) => {
  const rfq = await prisma.rfq.findUnique({ where: { id: req.params.id }, include: { materialRequest: { include: { project: true } } } });
  if (!rfq || rfq.materialRequest.project.organizationId !== req.user!.organizationId) return res.status(404).json({ message: "RFQ not found." });

  const { supplierId, price, freight, tax, deliveryDays, paymentTerms } = req.body ?? {};
  if (!supplierId || price == null) return res.status(400).json({ message: "supplierId and price are required." });
  const onPanel = await prisma.rfqSupplier.findUnique({ where: { rfqId_supplierId: { rfqId: rfq.id, supplierId } } });
  if (!onPanel) return res.status(400).json({ message: "This supplier is not on the RFQ's supplier panel." });

  const quotation = await prisma.supplierQuotation.create({
    data: { rfqId: rfq.id, supplierId, price, freight: freight ?? 0, tax: tax ?? 0, deliveryDays: deliveryDays ?? null, paymentTerms: paymentTerms ?? null },
  });
  if (rfq.status === "ISSUED") await prisma.rfq.update({ where: { id: rfq.id }, data: { status: "RESPONSES_RECEIVED" } });
  res.status(201).json({ data: quotation });
});

// Comparison table is a read derived from GET /rfq/:id's quotations —
// no separate endpoint; the frontend renders the comparison from that.
router.patch("/quotations/:id/select", requireRole("SUPER_ADMIN", "PROCUREMENT"), async (req, res) => {
  const quotation = await prisma.supplierQuotation.findUnique({
    where: { id: req.params.id }, include: { rfq: { include: { materialRequest: { include: { project: true } } } } },
  });
  if (!quotation || quotation.rfq.materialRequest.project.organizationId !== req.user!.organizationId) {
    return res.status(404).json({ message: "Quotation not found." });
  }

  await prisma.$transaction([
    prisma.supplierQuotation.updateMany({ where: { rfqId: quotation.rfqId }, data: { selected: false } }),
    prisma.supplierQuotation.update({ where: { id: quotation.id }, data: { selected: true } }),
    prisma.rfq.update({ where: { id: quotation.rfqId }, data: { status: "EVALUATED" } }),
  ]);
  res.json({ data: { id: quotation.id, selected: true } });
});

// ---------------------------------------------------------------------
// Purchase Order (Section 6.4) — Project OS owns the PO (PRD Section
// 9.2 decision). Create = Procurement role. Approve = Project Manager,
// within the project's poApprovalThreshold (Section 6.2) — same
// auto-approve-below-threshold convention SmartERP's own PO workflow
// uses (Organization.poApprovalThreshold in that codebase).
// ---------------------------------------------------------------------

router.post("/purchase-orders", requireRole("SUPER_ADMIN", "PROCUREMENT"), async (req, res) => {
  const { projectId, quotationId, supplierId: rawSupplierId, lines } = req.body ?? {};
  const project = await getOrgProject(projectId, req.user!.organizationId);
  if (!project) return res.status(404).json({ message: "Project not found." });
  if (!Array.isArray(lines) || lines.length === 0) return res.status(400).json({ message: "lines must be a non-empty array of { itemId, quantity, rate }." });

  let supplierId = rawSupplierId as string | undefined;
  let boqLineIdForWarning: string | null = null;
  if (quotationId) {
    const quotation = await prisma.supplierQuotation.findUnique({
      where: { id: quotationId },
      include: { rfq: { include: { materialRequest: { include: { project: true } } } } },
    });
    if (!quotation || quotation.rfq.materialRequest.project.id !== project.id) return res.status(404).json({ message: "Quotation not found on this project." });
    supplierId = quotation.supplierId;
    boqLineIdForWarning = quotation.rfq.materialRequest.boqLineId;
  }
  if (!supplierId) return res.status(400).json({ message: "supplierId is required when not creating from a quotation." });

  const supplier = await prisma.syncedBusinessPartner.findFirst({ where: { id: supplierId, organizationId: req.user!.organizationId, bpType: "VENDOR" } });
  if (!supplier) return res.status(404).json({ message: "Supplier not found." });

  const itemIds = lines.map((l: any) => l.itemId);
  const items = await prisma.syncedItem.findMany({ where: { id: { in: itemIds }, organizationId: req.user!.organizationId } });
  if (items.length !== new Set(itemIds).size) {
    return res.status(400).json({
      message: "One or more items were not found. No items are synced from SmartERP yet (task #118) — use POST /integration/synced-items to add one manually for testing.",
    });
  }

  const grandTotal = lines.reduce((sum: number, l: any) => sum + Number(l.quantity) * Number(l.rate), 0);
  const lastPo = await prisma.purchaseOrder.findFirst({ where: { projectId: project.id }, orderBy: { createdAt: "desc" } });
  const poNumber = `PO-${project.code}-${String((lastPo ? Number(lastPo.poNumber.split("-").pop()) : 0) + 1).padStart(4, "0")}`;

  // Auto-approve below threshold, same convention as SmartERP's own PO
  // workflow. Null threshold (Section 6.2) means "always require manual
  // approval" — the safe default.
  const threshold = project.poApprovalThreshold != null ? Number(project.poApprovalThreshold) : null;
  const autoApprove = threshold != null && grandTotal < threshold;

  const po = await prisma.purchaseOrder.create({
    data: {
      organizationId: req.user!.organizationId, projectId: project.id, quotationId: quotationId ?? null, supplierId,
      poNumber, grandTotal, status: autoApprove ? "APPROVED" : "PENDING_APPROVAL",
      approvedAt: autoApprove ? new Date() : null,
      lines: { create: lines.map((l: any) => ({ itemId: l.itemId, quantity: l.quantity, rate: l.rate, amount: Number(l.quantity) * Number(l.rate) })) },
    },
    include: { lines: true, supplier: true },
  });

  // Procurement Risk Control (Section 6.4.1): "PO quantity exceeds
  // remaining project requirement" — non-blocking warning, not enforced
  // as a hard stop in R1 (no override-with-reason UI to attach the
  // override to yet). Only checked when the PO traces back to a BOQ
  // line via its quotation's RFQ's Material Request.
  let warnings: string[] = [];
  if (boqLineIdForWarning) {
    const boqLine = await prisma.boqLine.findUnique({ where: { id: boqLineIdForWarning } });
    const orderedQty = lines.reduce((sum: number, l: any) => sum + Number(l.quantity), 0);
    if (boqLine && orderedQty > Number(boqLine.quantity)) {
      warnings.push(`Ordered quantity (${orderedQty}) exceeds the BOQ line's requirement (${boqLine.quantity}).`);
    }
  }

  // Fire the shadow-PO push now if this PO landed straight in APPROVED
  // (auto-approve-below-threshold) — same push used by the manual
  // /approve route below. Awaited so the response reflects sync status,
  // but pushPurchaseOrderToSmartErp never throws — a SmartERP outage
  // doesn't block the PO approval that already committed locally.
  if (po.status === "APPROVED") await pushPurchaseOrderToSmartErp(po.id);

  const withSyncStatus = await prisma.purchaseOrder.findUnique({ where: { id: po.id }, include: { lines: true, supplier: true } });
  res.status(201).json({ data: withSyncStatus, warnings: warnings.length ? warnings : undefined });
});

router.get("/purchase-orders/project/:projectId", async (req, res) => {
  const project = await getOrgProject(req.params.projectId, req.user!.organizationId);
  if (!project) return res.status(404).json({ message: "Project not found." });
  const pos = await prisma.purchaseOrder.findMany({
    where: { projectId: project.id }, orderBy: { createdAt: "desc" }, include: { supplier: true, lines: true },
  });
  res.json({ data: pos });
});

router.get("/purchase-orders/:id", async (req, res) => {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: req.params.id }, include: { supplier: true, lines: { include: { item: true } }, project: true },
  });
  if (!po || po.project.organizationId !== req.user!.organizationId) return res.status(404).json({ message: "Purchase Order not found." });
  res.json({ data: po });
});

router.patch("/purchase-orders/:id/approve", requireRole("SUPER_ADMIN", "PROJECT_MANAGER"), async (req, res) => {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id }, include: { project: true } });
  if (!po || po.project.organizationId !== req.user!.organizationId) return res.status(404).json({ message: "Purchase Order not found." });
  if (po.status !== "PENDING_APPROVAL") return res.status(409).json({ message: `Cannot approve a Purchase Order in "${po.status}" status.` });

  await prisma.purchaseOrder.update({
    where: { id: po.id }, data: { status: "APPROVED", approvedAt: new Date(), approvedByOrgUserId: req.user!.orgUserId },
  });

  await pushPurchaseOrderToSmartErp(po.id);

  const withSyncStatus = await prisma.purchaseOrder.findUnique({ where: { id: po.id }, include: { lines: true, supplier: true } });
  res.json({ data: withSyncStatus });
});

// POST /purchase-orders/:id/push-to-smarterp — manual retry for a PO
// whose shadow push failed or was skipped (no SmartERP connection
// configured at the time, item/vendor not yet a real synced master,
// SmartERP briefly unreachable, etc.). Same role tier as approving the
// PO, since this is really "finish what approval started."
router.post("/purchase-orders/:id/push-to-smarterp", requireRole("SUPER_ADMIN", "PROJECT_MANAGER"), async (req, res) => {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id }, include: { project: true } });
  if (!po || po.project.organizationId !== req.user!.organizationId) return res.status(404).json({ message: "Purchase Order not found." });
  if (po.status !== "APPROVED") return res.status(409).json({ message: `Only an Approved Purchase Order can be pushed to SmartERP (this one is "${po.status}").` });

  await pushPurchaseOrderToSmartErp(po.id);
  const updated = await prisma.purchaseOrder.findUnique({ where: { id: po.id }, include: { lines: true, supplier: true } });
  res.json({ data: updated });
});

export default router;
