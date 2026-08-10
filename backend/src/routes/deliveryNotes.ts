import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { consumeStock, InsufficientStockError } from "../lib/costing";
import { round2 } from "../lib/discountGst";

// Delivery Note — records physical dispatch of goods against an APPROVED
// Sales Order and, unlike a Sales Invoice, actually moves stock
// (consumeStock below). Creates and posts in one step, the same UX as a
// Sales Invoice — there's no draft/approval workflow of its own, since
// that already happened at the SO stage. See the schema.prisma comment on
// DeliveryNote and ROADMAP.md's "Delivery Note" section for the full
// design, including why this is only meaningful in the SO-linked sales
// path — an ad-hoc Sales Invoice with no SO is entirely unaffected and
// still moves its own stock exactly as it always has.
const router = Router();
router.use(authenticate, requireActiveSubscription);
const canDeliver = requirePermission("sales.deliver");

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

interface LineInput {
  salesOrderLineId: string;
  quantityDelivered: number;
}

const DETAIL_INCLUDE = {
  businessPartner: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  salesOrder: { select: { id: true, soNumber: true } },
  lines: {
    include: {
      item: { select: { id: true, sku: true, name: true } },
      salesOrderLine: { select: { id: true, quantity: true } },
    },
  },
} as const;

router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const salesOrderId = typeof req.query.salesOrderId === "string" ? req.query.salesOrderId : undefined;
  const notes = await prisma.deliveryNote.findMany({
    where: { organizationId, ...(salesOrderId ? { salesOrderId } : {}) },
    include: {
      businessPartner: { select: { id: true, name: true } },
      salesOrder: { select: { id: true, soNumber: true } },
      lines: { include: { item: { select: { id: true, sku: true, name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json({ data: notes });
});

router.get("/:id", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const note = await prisma.deliveryNote.findFirst({
    where: { id: req.params.id, organizationId },
    include: DETAIL_INCLUDE,
  });
  if (!note) return res.status(404).json({ message: "Delivery Note not found." });
  res.json({ data: note });
});

// POST /delivery-notes — create and post in one step. Requires an APPROVED
// Sales Order; the customer and branch are both derived from the SO
// (branch falls back to the org's Head Office if the SO didn't specify
// one), never taken from the request body, so a Delivery Note can never
// drift from the order it's fulfilling. Each line references a
// salesOrderLineId — itemId and the descriptive rate both come from that
// SO line, not the request, for the same reason.
router.post("/", canDeliver, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const { salesOrderId, dnDate, narration, lines } = req.body ?? {};
  if (!salesOrderId || !dnDate || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ message: "salesOrderId, dnDate, and at least one line are required." });
  }

  const so = await prisma.salesOrder.findFirst({
    where: { id: salesOrderId, organizationId },
    include: { lines: { select: { id: true, itemId: true, quantity: true, rate: true, deliveredQuantity: true } } },
  });
  if (!so) return res.status(400).json({ message: "salesOrderId is not a valid Sales Order for this organization." });
  if (so.status !== "APPROVED") {
    return res.status(400).json({ message: `Sales Order ${so.soNumber} is ${so.status}, not Approved — only an approved SO can be delivered against.` });
  }

  let resolvedBranchId = so.branchId;
  if (!resolvedBranchId) {
    const ho = await prisma.branch.findFirst({ where: { organizationId, isHeadOffice: true } });
    resolvedBranchId = ho?.id ?? null;
  }
  if (!resolvedBranchId) return res.status(400).json({ message: "No branch found for this Sales Order — set a dispatch branch on it, or provision a Head Office branch." });

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true } });
  if (!org?.costingMethod) return res.status(422).json({ message: "Set the organization's stock costing method first." });

  const typedLines: LineInput[] = lines;
  const soLineById = new Map(so.lines.map((l) => [l.id, l]));

  // Sum quantities per SO line first — two lines on *this* Delivery Note
  // referencing the same SO line (unusual, but not disallowed) are
  // combined before the over-delivery check, same convention as the
  // GRN-quantity check on Goods Receipt Note.
  const deliveredByLine = new Map<string, number>();
  for (const l of typedLines) {
    if (!l.salesOrderLineId || !(l.quantityDelivered > 0)) {
      return res.status(400).json({ message: "Every line needs salesOrderLineId and quantityDelivered > 0." });
    }
    const soLine = soLineById.get(l.salesOrderLineId);
    if (!soLine) {
      return res.status(400).json({ message: "One or more lines reference a salesOrderLineId that isn't on this Sales Order." });
    }
    deliveredByLine.set(l.salesOrderLineId, round2((deliveredByLine.get(l.salesOrderLineId) ?? 0) + l.quantityDelivered));
  }
  for (const [soLineId, qtyOnThisNote] of deliveredByLine) {
    const soLine = soLineById.get(soLineId)!;
    const alreadyDelivered = Number(soLine.deliveredQuantity);
    const ordered = Number(soLine.quantity);
    if (round2(alreadyDelivered + qtyOnThisNote) > ordered) {
      return res.status(400).json({
        message: `Delivering ${qtyOnThisNote} against Sales Order line ${soLineId} would exceed the ordered quantity ` +
          `(${ordered} ordered, ${alreadyDelivered} already delivered, ${round2(ordered - alreadyDelivered)} remaining).`,
      });
    }
  }

  const count = await prisma.deliveryNote.count({ where: { organizationId } });
  const dnNumber = `DN-${String(count + 1).padStart(4, "0")}`;

  try {
    const note = await prisma.$transaction(async (tx) => {
      const created = await tx.deliveryNote.create({
        data: {
          organizationId, branchId: resolvedBranchId!, businessPartnerId: so.businessPartnerId,
          salesOrderId: so.id, dnNumber, dnDate: new Date(dnDate), narration: narration ?? "",
          createdBy: req.user!.userId,
        },
      });

      // consumeStock first (needs to run per-line, before the line rows
      // exist, so each line's captured unitCost can go straight into the
      // createMany below) — same "cost before create" ordering
      // salesInvoices.ts uses.
      const lineRows = [];
      for (const l of typedLines) {
        const soLine = soLineById.get(l.salesOrderLineId)!;
        const { unitCost } = await consumeStock(tx, {
          organizationId, branchId: resolvedBranchId!, itemId: soLine.itemId,
          quantity: l.quantityDelivered, costingMethod: org.costingMethod!,
          movementType: "SALE", referenceType: "delivery_note", referenceId: created.id,
          movementDate: new Date(dnDate), narration: `Delivery Note ${dnNumber}`,
        });
        lineRows.push({
          deliveryNoteId: created.id, salesOrderLineId: l.salesOrderLineId,
          itemId: soLine.itemId, quantityDelivered: l.quantityDelivered,
          rate: soLine.rate, unitCost,
        });
      }
      await tx.deliveryNoteLine.createMany({ data: lineRows });

      for (const [soLineId, qty] of deliveredByLine) {
        await tx.salesOrderLine.update({
          where: { id: soLineId },
          data: { deliveredQuantity: { increment: qty } },
        });
      }

      return created;
    });

    logAudit({
      organizationId, actorUserId: req.user!.userId,
      action: "CREATE", entityType: "delivery_note", entityId: note.id,
      summary: `Posted Delivery Note ${dnNumber} against Sales Order ${so.soNumber}`,
    });
    const withDetail = await prisma.deliveryNote.findUnique({ where: { id: note.id }, include: DETAIL_INCLUDE });
    res.status(201).json({ data: withDetail });
  } catch (err: any) {
    if (err instanceof InsufficientStockError) return res.status(409).json({ message: err.message });
    throw err;
  }
});

export default router;
