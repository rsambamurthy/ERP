import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { receiveStock } from "../lib/costing";
import { round2 } from "../lib/discountGst";

// Goods Receipt Note — records physical receipt of goods against an
// APPROVED Purchase Order and, unlike a Purchase Bill, actually moves
// stock (receiveStock below). Creates and posts in one step, the same UX
// as a Purchase Bill — there's no draft/approval workflow of its own,
// since that already happened at the PO stage. See the schema.prisma
// comment on GoodsReceiptNote and ROADMAP.md's "Goods Receipt Note"
// section for the full design, including why this is only meaningful in
// the PO-linked procurement path (an ad-hoc Purchase Bill with no PO
// still moves its own stock exactly as it always has).
const router = Router();
router.use(authenticate, requireActiveSubscription);
const canReceive = requirePermission("purchase.receive");

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

interface LineInput {
  purchaseOrderLineId: string;
  quantityReceived: number;
}

const DETAIL_INCLUDE = {
  businessPartner: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  purchaseOrder: { select: { id: true, poNumber: true } },
  lines: {
    include: {
      item: { select: { id: true, sku: true, name: true } },
      purchaseOrderLine: { select: { id: true, quantity: true } },
    },
  },
} as const;

router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const purchaseOrderId = typeof req.query.purchaseOrderId === "string" ? req.query.purchaseOrderId : undefined;
  const grns = await prisma.goodsReceiptNote.findMany({
    where: { organizationId, ...(purchaseOrderId ? { purchaseOrderId } : {}) },
    include: {
      businessPartner: { select: { id: true, name: true } },
      purchaseOrder: { select: { id: true, poNumber: true } },
      lines: { include: { item: { select: { id: true, sku: true, name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json({ data: grns });
});

router.get("/:id", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const grn = await prisma.goodsReceiptNote.findFirst({
    where: { id: req.params.id, organizationId },
    include: DETAIL_INCLUDE,
  });
  if (!grn) return res.status(404).json({ message: "Goods Receipt Note not found." });
  res.json({ data: grn });
});

// POST /goods-receipt-notes — create and post in one step. Requires an
// APPROVED Purchase Order; the vendor and branch are both derived from
// the PO (branch falls back to the org's Head Office if the PO didn't
// specify one), never taken from the request body, so a GRN can never
// drift from the order it's fulfilling. Each line references a
// purchaseOrderLineId — itemId and unitCost both come from that PO line,
// not the request, for the same reason.
router.post("/", canReceive, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const { purchaseOrderId, grnDate, narration, lines } = req.body ?? {};
  if (!purchaseOrderId || !grnDate || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ message: "purchaseOrderId, grnDate, and at least one line are required." });
  }

  const po = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, organizationId },
    include: { lines: { select: { id: true, itemId: true, quantity: true, rate: true, receivedQuantity: true } } },
  });
  if (!po) return res.status(400).json({ message: "purchaseOrderId is not a valid Purchase Order for this organization." });
  if (po.status !== "APPROVED") {
    return res.status(400).json({ message: `Purchase Order ${po.poNumber} is ${po.status}, not Approved — only an approved PO can receive goods.` });
  }

  let resolvedBranchId = po.branchId;
  if (!resolvedBranchId) {
    const ho = await prisma.branch.findFirst({ where: { organizationId, isHeadOffice: true } });
    resolvedBranchId = ho?.id ?? null;
  }
  if (!resolvedBranchId) return res.status(400).json({ message: "No branch found for this Purchase Order — set a delivery branch on it, or provision a Head Office branch." });

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true } });
  if (!org?.costingMethod) return res.status(422).json({ message: "Set the organization's stock costing method first." });

  const typedLines: LineInput[] = lines;
  const poLineById = new Map(po.lines.map((l) => [l.id, l]));

  // Sum quantities per PO line first — two lines on *this* GRN referencing
  // the same PO line (unusual, but not disallowed) are combined before the
  // over-receipt check, same convention as the PO-quantity check on
  // Purchase Bill.
  const receivedByLine = new Map<string, number>();
  for (const l of typedLines) {
    if (!l.purchaseOrderLineId || !(l.quantityReceived > 0)) {
      return res.status(400).json({ message: "Every line needs purchaseOrderLineId and quantityReceived > 0." });
    }
    const poLine = poLineById.get(l.purchaseOrderLineId);
    if (!poLine) {
      return res.status(400).json({ message: "One or more lines reference a purchaseOrderLineId that isn't on this Purchase Order." });
    }
    receivedByLine.set(l.purchaseOrderLineId, round2((receivedByLine.get(l.purchaseOrderLineId) ?? 0) + l.quantityReceived));
  }
  for (const [poLineId, qtyOnThisGrn] of receivedByLine) {
    const poLine = poLineById.get(poLineId)!;
    const alreadyReceived = Number(poLine.receivedQuantity);
    const ordered = Number(poLine.quantity);
    if (round2(alreadyReceived + qtyOnThisGrn) > ordered) {
      return res.status(400).json({
        message: `Receiving ${qtyOnThisGrn} against Purchase Order line ${poLineId} would exceed the ordered quantity ` +
          `(${ordered} ordered, ${alreadyReceived} already received, ${round2(ordered - alreadyReceived)} remaining).`,
      });
    }
  }

  const count = await prisma.goodsReceiptNote.count({ where: { organizationId } });
  const grnNumber = `GRN-${String(count + 1).padStart(4, "0")}`;

  const grn = await prisma.$transaction(async (tx) => {
    const created = await tx.goodsReceiptNote.create({
      data: {
        organizationId, branchId: resolvedBranchId!, businessPartnerId: po.businessPartnerId,
        purchaseOrderId: po.id, grnNumber, grnDate: new Date(grnDate), narration: narration ?? "",
        createdBy: req.user!.userId,
      },
    });

    await tx.goodsReceiptNoteLine.createMany({
      data: typedLines.map((l) => {
        const poLine = poLineById.get(l.purchaseOrderLineId)!;
        return {
          goodsReceiptNoteId: created.id, purchaseOrderLineId: l.purchaseOrderLineId,
          itemId: poLine.itemId, quantityReceived: l.quantityReceived, unitCost: poLine.rate,
        };
      }),
    });

    for (const l of typedLines) {
      const poLine = poLineById.get(l.purchaseOrderLineId)!;
      await receiveStock(tx, {
        organizationId, branchId: resolvedBranchId!, itemId: poLine.itemId,
        quantity: l.quantityReceived, unitCost: Number(poLine.rate), costingMethod: org.costingMethod!,
        movementType: "PURCHASE", referenceType: "goods_receipt_note", referenceId: created.id,
        movementDate: new Date(grnDate), narration: `GRN ${grnNumber}`,
      });
    }

    for (const [poLineId, qty] of receivedByLine) {
      await tx.purchaseOrderLine.update({
        where: { id: poLineId },
        data: { receivedQuantity: { increment: qty } },
      });
    }

    return created;
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "CREATE", entityType: "goods_receipt_note", entityId: grn.id,
    summary: `Posted Goods Receipt Note ${grnNumber} against Purchase Order ${po.poNumber}`,
  });
  const withDetail = await prisma.goodsReceiptNote.findUnique({ where: { id: grn.id }, include: DETAIL_INCLUDE });
  res.status(201).json({ data: withDetail });
});

export default router;
