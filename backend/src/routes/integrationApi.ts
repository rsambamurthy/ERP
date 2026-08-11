import { Router } from "express";
import { prisma } from "../db";
import { authenticateServiceKey } from "../middleware/serviceAuth";
import { receiveStock } from "../lib/costing";
import { round2 } from "../lib/discountGst";
import { logAudit } from "../lib/audit";

// The Project OS integration surface (PRD Section 9, prd-r1-pilot.docx):
// read-only master pulls (9.1) and the pre-approved shadow PO / GRN push
// (9.2's "Project OS owns the PO" decision). Every route here is
// service-key authenticated (middleware/serviceAuth.ts), not user-JWT —
// there's no logged-in person behind these requests, just Project OS's
// own backend calling in on the org's behalf.
const router = Router();
router.use(authenticateServiceKey);

// ---------------------------------------------------------------------
// Master data pulls (Section 9.1)
// ---------------------------------------------------------------------

// GET /integration/business-partners?bpType=CUSTOMER|VENDOR
// Full-table read every time, not incremental — BusinessPartner has no
// updatedAt column (see schema.prisma), so there's no cheap way to filter
// to "changed since X" without a migration adding one; deferred rather
// than blocking this first version. Project OS's own sync job runs this
// in full and upserts on its side by externalId (= this row's id).
router.get("/business-partners", async (req, res) => {
  const organizationId = req.serviceOrgId!;
  const bpType = typeof req.query.bpType === "string" ? req.query.bpType : undefined;
  const partners = await prisma.businessPartner.findMany({
    where: { organizationId, deletedAt: null, bpType: bpType ?? { in: ["CUSTOMER", "VENDOR"] } },
    orderBy: { name: "asc" },
  });
  res.json({
    data: partners.map((p) => ({
      externalId: p.id, bpType: p.bpType, name: p.name, gstin: p.gstin,
      phone: p.phone, email: p.email, address: p.address, stateCode: p.stateCode,
    })),
  });
});

router.get("/items", async (req, res) => {
  const organizationId = req.serviceOrgId!;
  const items = await prisma.item.findMany({ where: { organizationId, deletedAt: null }, orderBy: { name: "asc" } });
  res.json({
    data: items.map((i) => ({
      externalId: i.id, sku: i.sku, name: i.name, uom: i.uom, hsnCode: i.hsnCode,
      purchaseRate: i.purchaseRate, salesRate: i.salesRate, taxRate: i.taxRate,
    })),
  });
});

router.get("/branches", async (req, res) => {
  const organizationId = req.serviceOrgId!;
  const branches = await prisma.branch.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: [{ isHeadOffice: "desc" }, { code: "asc" }],
  });
  res.json({
    data: branches.map((b) => ({ externalId: b.id, code: b.code, name: b.name, gstin: b.gstin, stateCode: b.stateCode })),
  });
});

// ---------------------------------------------------------------------
// Shadow Purchase Order push (Section 9.2)
// ---------------------------------------------------------------------

interface ShadowPoLine {
  itemExternalId: string;
  quantity: number;
  rate: number;
  taxRate?: number;
}

// POST /integration/purchase-orders — accepts a Project-OS-approved
// Purchase Order and records it here already APPROVED. Project OS owns
// approval (Section 9.2) — SmartERP does not re-run its own
// poApprovalThreshold logic on these, it just records what already
// happened there. Idempotent on (organizationId, externalSystem, externalId):
// re-POSTing the same Project OS PO id returns the existing record
// instead of creating a duplicate, since a retried push after a dropped
// response is expected, not exceptional (see the @@unique on PurchaseOrder).
router.post("/purchase-orders", async (req, res) => {
  const organizationId = req.serviceOrgId!;
  const { externalId, poNumber, poDate, vendorExternalId, branchExternalId, narration, lines, approvedAt } = req.body ?? {};
  if (!externalId || !poNumber || !poDate || !vendorExternalId || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ message: "externalId, poNumber, poDate, vendorExternalId, and at least one line are required." });
  }

  const existing = await prisma.purchaseOrder.findFirst({ where: { organizationId, externalSystem: "PROJECT_OS", externalId } });
  if (existing) {
    const withDetail = await prisma.purchaseOrder.findUnique({ where: { id: existing.id }, include: { lines: true } });
    return res.status(200).json({ data: withDetail, alreadyExisted: true });
  }

  const vendor = await prisma.businessPartner.findFirst({ where: { id: vendorExternalId, organizationId, bpType: "VENDOR" } });
  if (!vendor) return res.status(400).json({ message: "vendorExternalId is not a known Vendor in this organization." });

  let resolvedBranchId: string | null = branchExternalId ?? null;
  if (resolvedBranchId) {
    const branch = await prisma.branch.findFirst({ where: { id: resolvedBranchId, organizationId } });
    if (!branch) return res.status(400).json({ message: "branchExternalId is not a known Branch in this organization." });
  } else {
    const ho = await prisma.branch.findFirst({ where: { organizationId, isHeadOffice: true } });
    resolvedBranchId = ho?.id ?? null;
  }

  const typedLines: ShadowPoLine[] = lines;
  const itemIds = [...new Set(typedLines.map((l) => l.itemExternalId))];
  const items = await prisma.item.findMany({ where: { id: { in: itemIds }, organizationId, deletedAt: null } });
  if (items.length !== itemIds.length) {
    return res.status(400).json({ message: "One or more lines reference an itemExternalId that isn't a known Item in this organization." });
  }
  for (const l of typedLines) {
    if (!l.itemExternalId || !(l.quantity > 0) || !(l.rate >= 0)) {
      return res.status(400).json({ message: "Every line needs itemExternalId, quantity > 0, and rate >= 0." });
    }
  }

  let subtotal = 0, taxTotal = 0;
  const computed = typedLines.map((l) => {
    const lineSubtotal = round2(l.quantity * l.rate);
    const taxAmount = round2(lineSubtotal * (l.taxRate ?? 0) / 100);
    const lineTotal = round2(lineSubtotal + taxAmount);
    subtotal += lineSubtotal; taxTotal += taxAmount;
    return { itemId: l.itemExternalId, quantity: l.quantity, rate: l.rate, taxRate: l.taxRate ?? 0, lineSubtotal, taxAmount, lineTotal };
  });
  const grandTotal = round2(subtotal + taxTotal);

  // poNumber is SmartERP's own sequence on every *native* PO
  // (routes/purchaseOrders.ts: "PO-0001"); a pushed shadow PO instead
  // carries Project OS's own number verbatim in a prefixed form so the
  // two sequences never collide and either side's number is
  // recognisable — at a glance — as having come from Project OS.
  const smartErpPoNumber = `EXT-${poNumber}`;

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.purchaseOrder.create({
      data: {
        organizationId, branchId: resolvedBranchId, businessPartnerId: vendor.id,
        poNumber: smartErpPoNumber, poDate: new Date(poDate), narration: narration ?? "",
        status: "APPROVED", subtotal: round2(subtotal), taxTotal: round2(taxTotal), grandTotal,
        approvedAt: approvedAt ? new Date(approvedAt) : new Date(), autoApproved: false,
        source: "PROJECT_OS", externalSystem: "PROJECT_OS", externalId,
      },
    });
    await tx.purchaseOrderLine.createMany({ data: computed.map((l) => ({ ...l, purchaseOrderId: created.id })) });
    return created;
  });

  logAudit({
    organizationId, action: "CREATE", entityType: "purchase_order", entityId: order.id,
    summary: `Received shadow Purchase Order ${smartErpPoNumber} from Project OS (${vendor.name}, ${grandTotal.toFixed(2)})`,
  });
  const withDetail = await prisma.purchaseOrder.findUnique({ where: { id: order.id }, include: { lines: true } });
  res.status(201).json({ data: withDetail, alreadyExisted: false });
});

// ---------------------------------------------------------------------
// Shadow Goods Receipt Note push (Section 9.2)
// ---------------------------------------------------------------------

interface ShadowGrnLine {
  purchaseOrderLineExternalId: string;
  quantityReceived: number;
}

// POST /integration/goods-receipt-notes — mirrors routes/goodsReceiptNotes.ts
// exactly (same over-receipt guard, same receiveStock() call to actually
// move stock); the only differences are organizationId/auth coming from
// the service key, and the PO must be one this endpoint itself created
// (externalSystem=PROJECT_OS) — a GRN push can't reference a
// natively-created SmartERP PO, since Project OS doesn't own approval on
// those. Idempotent the same way the PO push above is.
router.post("/goods-receipt-notes", async (req, res) => {
  const organizationId = req.serviceOrgId!;
  const { externalId, purchaseOrderExternalId, grnDate, narration, lines } = req.body ?? {};
  if (!externalId || !purchaseOrderExternalId || !grnDate || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ message: "externalId, purchaseOrderExternalId, grnDate, and at least one line are required." });
  }

  const existing = await prisma.goodsReceiptNote.findFirst({ where: { organizationId, externalSystem: "PROJECT_OS", externalId } });
  if (existing) {
    const withDetail = await prisma.goodsReceiptNote.findUnique({ where: { id: existing.id }, include: { lines: true } });
    return res.status(200).json({ data: withDetail, alreadyExisted: true });
  }

  const po = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderExternalId, organizationId, externalSystem: "PROJECT_OS" },
    include: { lines: true },
  });
  if (!po) return res.status(400).json({ message: "purchaseOrderExternalId is not a known Project-OS-sourced Purchase Order in this organization." });
  if (po.status !== "APPROVED") {
    return res.status(400).json({ message: `Purchase Order ${po.poNumber} is ${po.status}, not Approved — only an approved PO can receive goods.` });
  }

  let resolvedBranchId = po.branchId;
  if (!resolvedBranchId) {
    const ho = await prisma.branch.findFirst({ where: { organizationId, isHeadOffice: true } });
    resolvedBranchId = ho?.id ?? null;
  }
  if (!resolvedBranchId) {
    return res.status(400).json({ message: "No branch found for this Purchase Order — set a delivery branch on it, or provision a Head Office branch." });
  }

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true } });
  if (!org?.costingMethod) return res.status(422).json({ message: "Set the organization's stock costing method first." });

  const typedLines: ShadowGrnLine[] = lines;
  const poLineById = new Map(po.lines.map((l) => [l.id, l]));
  const receivedByLine = new Map<string, number>();
  for (const l of typedLines) {
    if (!l.purchaseOrderLineExternalId || !(l.quantityReceived > 0)) {
      return res.status(400).json({ message: "Every line needs purchaseOrderLineExternalId and quantityReceived > 0." });
    }
    const poLine = poLineById.get(l.purchaseOrderLineExternalId);
    if (!poLine) return res.status(400).json({ message: "One or more lines reference a purchaseOrderLineExternalId that isn't on this Purchase Order." });
    receivedByLine.set(l.purchaseOrderLineExternalId, round2((receivedByLine.get(l.purchaseOrderLineExternalId) ?? 0) + l.quantityReceived));
  }
  for (const [poLineId, qty] of receivedByLine) {
    const poLine = poLineById.get(poLineId)!;
    const alreadyReceived = Number(poLine.receivedQuantity);
    const ordered = Number(poLine.quantity);
    if (round2(alreadyReceived + qty) > ordered) {
      return res.status(400).json({
        message: `Receiving ${qty} against Purchase Order line ${poLineId} would exceed the ordered quantity ` +
          `(${ordered} ordered, ${alreadyReceived} already received, ${round2(ordered - alreadyReceived)} remaining).`,
      });
    }
  }

  const count = await prisma.goodsReceiptNote.count({ where: { organizationId } });
  const grnNumber = `EXT-GRN-${String(count + 1).padStart(4, "0")}`;

  const grn = await prisma.$transaction(async (tx) => {
    const created = await tx.goodsReceiptNote.create({
      data: {
        organizationId, branchId: resolvedBranchId!, businessPartnerId: po.businessPartnerId,
        purchaseOrderId: po.id, grnNumber, grnDate: new Date(grnDate), narration: narration ?? "",
        source: "PROJECT_OS", externalSystem: "PROJECT_OS", externalId,
      },
    });
    await tx.goodsReceiptNoteLine.createMany({
      data: typedLines.map((l) => {
        const poLine = poLineById.get(l.purchaseOrderLineExternalId)!;
        return {
          goodsReceiptNoteId: created.id, purchaseOrderLineId: l.purchaseOrderLineExternalId,
          itemId: poLine.itemId, quantityReceived: l.quantityReceived, unitCost: poLine.rate,
        };
      }),
    });
    for (const l of typedLines) {
      const poLine = poLineById.get(l.purchaseOrderLineExternalId)!;
      await receiveStock(tx, {
        organizationId, branchId: resolvedBranchId!, itemId: poLine.itemId,
        quantity: l.quantityReceived, unitCost: Number(poLine.rate), costingMethod: org.costingMethod!,
        movementType: "PURCHASE", referenceType: "goods_receipt_note", referenceId: created.id,
        movementDate: new Date(grnDate), narration: `GRN ${grnNumber} (via Project OS)`,
      });
    }
    for (const [poLineId, qty] of receivedByLine) {
      await tx.purchaseOrderLine.update({ where: { id: poLineId }, data: { receivedQuantity: { increment: qty } } });
    }
    return created;
  });

  logAudit({
    organizationId, action: "CREATE", entityType: "goods_receipt_note", entityId: grn.id,
    summary: `Received shadow GRN ${grnNumber} from Project OS against Purchase Order ${po.poNumber}`,
  });
  const withDetail = await prisma.goodsReceiptNote.findUnique({ where: { id: grn.id }, include: { lines: true } });
  res.status(201).json({ data: withDetail, alreadyExisted: false });
});

export default router;
