import { Router } from "express";
import { randomUUID } from "crypto";
import { prisma } from "../db";
import { authenticate, requireRole } from "../middleware/auth";
import { pushReceiptToSmartErp } from "../lib/smartErpPush";

const router = Router();
router.use(authenticate);

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// Sign convention for StockLedgerEntry.transactionType — the running
// balance for an item at a location is just the signed sum of its
// entries. RETURN is + (material coming back to a location, e.g. site
// returning unused stock to the warehouse), matching the PRD's Section
// 6.5 "Material return" as distinct from "Material issue".
const SIGN: Record<string, 1 | -1> = { RECEIPT: 1, TRANSFER_IN: 1, RETURN: 1, TRANSFER_OUT: -1, ISSUE: -1 };

async function stockOnHand(itemId: string, locationId: string): Promise<number> {
  const entries = await prisma.stockLedgerEntry.findMany({ where: { itemId, locationId }, select: { transactionType: true, quantity: true } });
  return round2(entries.reduce((sum, e) => sum + SIGN[e.transactionType] * Number(e.quantity), 0));
}

async function getOrgProject(projectId: string, organizationId: string) {
  return prisma.project.findFirst({ where: { id: projectId, organizationId, deletedAt: null } });
}

// ---------------------------------------------------------------------
// Stock Locations (Section 6.5)
// ---------------------------------------------------------------------

router.post("/locations", requireRole("SUPER_ADMIN", "WAREHOUSE"), async (req, res) => {
  const { type, name, projectSiteId } = req.body ?? {};
  if (!type || !["WAREHOUSE", "PROJECT_SITE"].includes(type) || !name) {
    return res.status(400).json({ message: 'type ("WAREHOUSE" or "PROJECT_SITE") and name are required.' });
  }
  if (type === "PROJECT_SITE") {
    if (!projectSiteId) return res.status(400).json({ message: "projectSiteId is required for a PROJECT_SITE location." });
    const site = await prisma.projectSite.findFirst({ where: { id: projectSiteId, project: { organizationId: req.user!.organizationId } } });
    if (!site) return res.status(404).json({ message: "Project site not found." });
  }

  const location = await prisma.stockLocation.create({
    data: { organizationId: req.user!.organizationId, type, name, projectSiteId: type === "PROJECT_SITE" ? projectSiteId : null },
  });
  res.status(201).json({ data: location });
});

router.get("/locations", async (req, res) => {
  const locations = await prisma.stockLocation.findMany({
    where: { organizationId: req.user!.organizationId }, include: { projectSite: true }, orderBy: { name: "asc" },
  });
  res.json({ data: locations });
});

// ---------------------------------------------------------------------
// Goods Receipt (Section 6.5 + Section 6.4's "Receipt/GRN handoff") —
// same over-receipt validation shape as SmartERP's own
// routes/goodsReceiptNotes.ts: sum this receipt's lines per PO line
// first, then check against what's actually still outstanding.
// ---------------------------------------------------------------------

router.post("/receipts", requireRole("SUPER_ADMIN", "WAREHOUSE"), async (req, res) => {
  const { purchaseOrderId, locationId, lines } = req.body ?? {};
  if (!purchaseOrderId || !locationId || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ message: "purchaseOrderId, locationId, and at least one line are required." });
  }

  const po = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, organizationId: req.user!.organizationId },
    include: { lines: true },
  });
  if (!po) return res.status(404).json({ message: "Purchase Order not found." });
  if (po.status !== "APPROVED" && po.status !== "PARTIALLY_RECEIVED") {
    return res.status(409).json({ message: `Purchase Order is "${po.status}" — only an Approved or Partially Received PO can receive goods.` });
  }

  const location = await prisma.stockLocation.findFirst({ where: { id: locationId, organizationId: req.user!.organizationId } });
  if (!location) return res.status(404).json({ message: "Stock location not found." });

  const poLineById = new Map(po.lines.map((l) => [l.id, l]));
  const receivedByLine = new Map<string, number>();
  for (const l of lines) {
    if (!l.purchaseOrderLineId || !(Number(l.quantity) > 0)) {
      return res.status(400).json({ message: "Every line needs purchaseOrderLineId and quantity > 0." });
    }
    const poLine = poLineById.get(l.purchaseOrderLineId);
    if (!poLine) return res.status(400).json({ message: "One or more lines reference a purchaseOrderLineId that isn't on this Purchase Order." });
    receivedByLine.set(l.purchaseOrderLineId, round2((receivedByLine.get(l.purchaseOrderLineId) ?? 0) + Number(l.quantity)));
  }
  for (const [poLineId, qtyOnThisReceipt] of receivedByLine) {
    const poLine = poLineById.get(poLineId)!;
    const remaining = round2(Number(poLine.quantity) - Number(poLine.receivedQuantity));
    if (qtyOnThisReceipt > remaining) {
      return res.status(400).json({
        message: `Receiving ${qtyOnThisReceipt} against this PO line would exceed the ordered quantity (${remaining} still remaining).`,
      });
    }
  }

  const receipt = await prisma.$transaction(async (tx) => {
    const created = await tx.receipt.create({ data: { purchaseOrderId: po.id, locationId } });

    await tx.receiptLine.createMany({
      data: lines.map((l: any) => ({ receiptId: created.id, purchaseOrderLineId: l.purchaseOrderLineId, quantity: l.quantity })),
    });

    for (const l of lines) {
      const poLine = poLineById.get(l.purchaseOrderLineId)!;
      await tx.stockLedgerEntry.create({
        data: {
          itemId: poLine.itemId, locationId, transactionType: "RECEIPT", quantity: l.quantity,
          referenceType: "RECEIPT", referenceId: created.id,
        },
      });
    }

    for (const [poLineId, qty] of receivedByLine) {
      await tx.purchaseOrderLine.update({ where: { id: poLineId }, data: { receivedQuantity: { increment: qty } } });
    }

    // Recompute PO status from all lines, not just the ones on this
    // receipt — a PO can be received across several GRNs.
    const refreshedLines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
    const fullyReceived = refreshedLines.every((l) => round2(Number(l.receivedQuantity)) >= round2(Number(l.quantity)));
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: fullyReceived ? "CLOSED" : "PARTIALLY_RECEIVED" } });

    return created;
  });

  // Shadow-GRN push (PRD Section 9.2) — best-effort, same as the PO push
  // in routes/procurement.ts. Requires the PO to have synced first (see
  // pushReceiptToSmartErp's own guard); if it hasn't, this just records
  // "SKIPPED" on the Receipt rather than failing the GRN itself, which
  // already committed locally and moved local stock regardless.
  await pushReceiptToSmartErp(receipt.id);

  const withDetail = await prisma.receipt.findUnique({
    where: { id: receipt.id }, include: { lines: { include: { purchaseOrderLine: { include: { item: true } } } }, location: true },
  });
  res.status(201).json({ data: withDetail });
});

// POST /inventory/receipts/:id/push-to-smarterp — manual retry, same
// reasoning as procurement.ts's PO retry route.
router.post("/receipts/:id/push-to-smarterp", requireRole("SUPER_ADMIN", "WAREHOUSE"), async (req, res) => {
  const receipt = await prisma.receipt.findUnique({ where: { id: req.params.id }, include: { purchaseOrder: true } });
  if (!receipt || receipt.purchaseOrder.organizationId !== req.user!.organizationId) {
    return res.status(404).json({ message: "Receipt not found." });
  }
  await pushReceiptToSmartErp(receipt.id);
  const updated = await prisma.receipt.findUnique({ where: { id: receipt.id }, include: { lines: true, location: true } });
  res.json({ data: updated });
});

router.get("/receipts/project/:projectId", async (req, res) => {
  const project = await getOrgProject(req.params.projectId, req.user!.organizationId);
  if (!project) return res.status(404).json({ message: "Project not found." });
  const receipts = await prisma.receipt.findMany({
    where: { purchaseOrder: { projectId: project.id } },
    include: { purchaseOrder: { select: { id: true, poNumber: true } }, location: true, lines: true },
    orderBy: { receivedAt: "desc" },
  });
  res.json({ data: receipts });
});

router.get("/receipts/:id", async (req, res) => {
  const receipt = await prisma.receipt.findUnique({
    where: { id: req.params.id },
    include: { purchaseOrder: { include: { project: true } }, location: true, lines: { include: { purchaseOrderLine: { include: { item: true } } } } },
  });
  if (!receipt || receipt.purchaseOrder.project.organizationId !== req.user!.organizationId) {
    return res.status(404).json({ message: "Receipt not found." });
  }
  res.json({ data: receipt });
});

// ---------------------------------------------------------------------
// Stock on hand, Transfer, Issue, Return (Section 6.5)
// ---------------------------------------------------------------------

router.get("/stock", async (req, res) => {
  const { locationId, itemId } = req.query as { locationId?: string; itemId?: string };
  const where: any = { location: { organizationId: req.user!.organizationId } };
  if (locationId) where.locationId = locationId;
  if (itemId) where.itemId = itemId;

  const entries = await prisma.stockLedgerEntry.findMany({ where, include: { item: true, location: true } });
  const balances = new Map<string, { itemId: string; itemSku: string; itemName: string; locationId: string; locationName: string; quantity: number }>();
  for (const e of entries) {
    const key = `${e.itemId}|${e.locationId}`;
    const existing = balances.get(key) ?? { itemId: e.itemId, itemSku: e.item.sku, itemName: e.item.name, locationId: e.locationId, locationName: e.location.name, quantity: 0 };
    existing.quantity = round2(existing.quantity + SIGN[e.transactionType] * Number(e.quantity));
    balances.set(key, existing);
  }
  res.json({ data: Array.from(balances.values()) });
});

router.post("/transfers", requireRole("SUPER_ADMIN", "WAREHOUSE"), async (req, res) => {
  const { itemId, fromLocationId, toLocationId, quantity } = req.body ?? {};
  if (!itemId || !fromLocationId || !toLocationId || !(Number(quantity) > 0)) {
    return res.status(400).json({ message: "itemId, fromLocationId, toLocationId and quantity (> 0) are required." });
  }
  if (fromLocationId === toLocationId) return res.status(400).json({ message: "fromLocationId and toLocationId must be different." });

  const [item, fromLoc, toLoc] = await Promise.all([
    prisma.syncedItem.findFirst({ where: { id: itemId, organizationId: req.user!.organizationId } }),
    prisma.stockLocation.findFirst({ where: { id: fromLocationId, organizationId: req.user!.organizationId } }),
    prisma.stockLocation.findFirst({ where: { id: toLocationId, organizationId: req.user!.organizationId } }),
  ]);
  if (!item) return res.status(404).json({ message: "Item not found." });
  if (!fromLoc || !toLoc) return res.status(404).json({ message: "One or both stock locations were not found." });

  const available = await stockOnHand(itemId, fromLocationId);
  if (Number(quantity) > available) {
    return res.status(409).json({ message: `Only ${available} of this item is on hand at the source location — cannot transfer ${quantity}.` });
  }

  const referenceId = randomUUID(); // links the paired TRANSFER_OUT/TRANSFER_IN entries
  await prisma.$transaction([
    prisma.stockLedgerEntry.create({ data: { itemId, locationId: fromLocationId, transactionType: "TRANSFER_OUT", quantity, referenceType: "TRANSFER", referenceId } }),
    prisma.stockLedgerEntry.create({ data: { itemId, locationId: toLocationId, transactionType: "TRANSFER_IN", quantity, referenceType: "TRANSFER", referenceId } }),
  ]);
  res.status(201).json({ data: { itemId, fromLocationId, toLocationId, quantity, referenceId } });
});

// Issue also creates a MaterialConsumption row when linked to an
// Activity — the blueprint's own "one entry, many outcomes" design
// principle (Section 3): a single issue-to-site action should update
// both stock and site consumption, not require two separate entries.
router.post("/issues", requireRole("SUPER_ADMIN", "WAREHOUSE"), async (req, res) => {
  const { itemId, locationId, quantity, activityId } = req.body ?? {};
  if (!itemId || !locationId || !(Number(quantity) > 0)) {
    return res.status(400).json({ message: "itemId, locationId and quantity (> 0) are required." });
  }

  const [item, location] = await Promise.all([
    prisma.syncedItem.findFirst({ where: { id: itemId, organizationId: req.user!.organizationId } }),
    prisma.stockLocation.findFirst({ where: { id: locationId, organizationId: req.user!.organizationId } }),
  ]);
  if (!item) return res.status(404).json({ message: "Item not found." });
  if (!location) return res.status(404).json({ message: "Stock location not found." });

  let activity = null;
  if (activityId) {
    activity = await prisma.activity.findFirst({ where: { id: activityId, project: { organizationId: req.user!.organizationId } } });
    if (!activity) return res.status(404).json({ message: "Activity not found." });
  }

  const available = await stockOnHand(itemId, locationId);
  if (Number(quantity) > available) {
    return res.status(409).json({ message: `Only ${available} of this item is on hand at this location — cannot issue ${quantity}.` });
  }

  const [entry] = await prisma.$transaction([
    prisma.stockLedgerEntry.create({
      data: { itemId, locationId, transactionType: "ISSUE", quantity, referenceType: activityId ? "ACTIVITY" : "MANUAL_ISSUE", referenceId: activityId ?? null },
    }),
    ...(activityId ? [prisma.materialConsumption.create({ data: { activityId, itemId, quantity } })] : []),
  ]);
  res.status(201).json({ data: entry });
});

router.post("/returns", requireRole("SUPER_ADMIN", "WAREHOUSE"), async (req, res) => {
  const { itemId, locationId, quantity } = req.body ?? {};
  if (!itemId || !locationId || !(Number(quantity) > 0)) {
    return res.status(400).json({ message: "itemId, locationId and quantity (> 0) are required." });
  }
  const [item, location] = await Promise.all([
    prisma.syncedItem.findFirst({ where: { id: itemId, organizationId: req.user!.organizationId } }),
    prisma.stockLocation.findFirst({ where: { id: locationId, organizationId: req.user!.organizationId } }),
  ]);
  if (!item) return res.status(404).json({ message: "Item not found." });
  if (!location) return res.status(404).json({ message: "Stock location not found." });

  // No "was this actually issued before" check — R1 doesn't track
  // per-issue returnable balances, just the net ledger. A return with no
  // prior issue simply increases stock, same as a positive adjustment
  // would; that's a known simplification, not an oversight.
  const entry = await prisma.stockLedgerEntry.create({
    data: { itemId, locationId, transactionType: "RETURN", quantity, referenceType: "MANUAL_RETURN", referenceId: null },
  });
  res.status(201).json({ data: entry });
});

export default router;
