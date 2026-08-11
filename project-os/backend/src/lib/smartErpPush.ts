import { prisma } from "../db";
import { getSmartErpClient, smartErpFetch } from "./smartErpClient";

// Pushes an APPROVED Purchase Order to SmartERP as a pre-approved shadow
// PO (PRD Section 9.2 — Project OS owns approval, SmartERP just records
// it). Best-effort and non-blocking by design: called right after a PO's
// approval commits locally (routes/procurement.ts, both the
// auto-approve-below-threshold path and the manual approve route), but a
// push failure never rolls back or blocks that approval — the PO is
// already valid and approved inside Project OS regardless of whether
// SmartERP is reachable right now. Failures are recorded on the PO
// itself (smartErpSyncStatus/smartErpSyncError) and retryable via POST
// /procurement/purchase-orders/:id/push-to-smarterp.
export async function pushPurchaseOrderToSmartErp(purchaseOrderId: string): Promise<void> {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { lines: { include: { item: true } }, supplier: true, project: true },
  });
  if (!po || po.status !== "APPROVED") return;

  const client = await getSmartErpClient(po.organizationId);
  if (!client) {
    await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { smartErpSyncStatus: "SKIPPED", smartErpSyncError: "No SmartERP connection configured for this organization — see POST /integration/connection." },
    });
    return;
  }

  try {
    // supplier/item externalIds only resolve to something SmartERP
    // recognises if they came from a real sync (POST /integration/sync);
    // a manually-entered SyncedBusinessPartner/SyncedItem (the #118-less
    // fallback) carries a locally-generated placeholder externalId, and
    // SmartERP will correctly 400 on it as "not a known Vendor/Item" —
    // surfaced as-is below rather than guessed around.
    const body = await smartErpFetch(client, "/integration/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        externalId: po.id,
        poNumber: po.poNumber,
        poDate: po.createdAt.toISOString(),
        vendorExternalId: po.supplier.externalId,
        narration: `Project OS ${po.poNumber}${po.project ? ` — ${po.project.name}` : ""}`,
        approvedAt: po.approvedAt?.toISOString(),
        lines: po.lines.map((l) => ({ itemExternalId: l.item.externalId, quantity: Number(l.quantity), rate: Number(l.rate) })),
      }),
    });

    // Match returned SmartERP lines back to ours by item externalId, so
    // a later Receipt push knows which SmartERP PurchaseOrderLine to
    // reference (see pushReceiptToSmartErp below). Degrades to
    // "last match wins" if the same item appears twice on one PO — a
    // known simplification, not handled specially.
    const smartErpLineByItemExternalId = new Map<string, string>(
      (body.data.lines ?? []).map((l: any) => [l.itemId, l.id])
    );
    await prisma.$transaction([
      prisma.purchaseOrder.update({
        where: { id: po.id },
        data: { smartErpExternalId: body.data.id, smartErpSyncStatus: "SYNCED", smartErpSyncError: null },
      }),
      ...po.lines.map((l) =>
        prisma.purchaseOrderLine.update({
          where: { id: l.id },
          data: { smartErpExternalId: smartErpLineByItemExternalId.get(l.item.externalId) ?? null },
        })
      ),
    ]);
  } catch (err: any) {
    await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { smartErpSyncStatus: "FAILED", smartErpSyncError: String(err.message).slice(0, 500) },
    });
  }
}

// Pushes a Receipt (GRN) to SmartERP once its Purchase Order has already
// synced there (smartErpExternalId set) — a receipt can't be pushed
// ahead of its PO, since SmartERP's GRN push requires
// purchaseOrderExternalId to already exist as a Project-OS-sourced PO on
// that side. Same best-effort/non-blocking design as the PO push above.
export async function pushReceiptToSmartErp(receiptId: string): Promise<void> {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    include: { purchaseOrder: true, lines: { include: { purchaseOrderLine: true } } },
  });
  if (!receipt) return;

  const client = await getSmartErpClient(receipt.purchaseOrder.organizationId);
  if (!client) {
    await prisma.receipt.update({
      where: { id: receipt.id },
      data: { smartErpSyncStatus: "SKIPPED", smartErpSyncError: "No SmartERP connection configured for this organization — see POST /integration/connection." },
    });
    return;
  }
  if (!receipt.purchaseOrder.smartErpExternalId) {
    await prisma.receipt.update({
      where: { id: receipt.id },
      data: { smartErpSyncStatus: "SKIPPED", smartErpSyncError: "This Purchase Order hasn't synced to SmartERP yet — retry the PO push first, then retry this Receipt." },
    });
    return;
  }
  const missingLine = receipt.lines.find((l) => !l.purchaseOrderLine.smartErpExternalId);
  if (missingLine) {
    await prisma.receipt.update({
      where: { id: receipt.id },
      data: { smartErpSyncStatus: "FAILED", smartErpSyncError: "One or more lines' Purchase Order line never got a SmartERP id from the PO push — retry the PO push first." },
    });
    return;
  }

  try {
    const body = await smartErpFetch(client, "/integration/goods-receipt-notes", {
      method: "POST",
      body: JSON.stringify({
        externalId: receipt.id,
        purchaseOrderExternalId: receipt.purchaseOrder.smartErpExternalId,
        grnDate: receipt.receivedAt.toISOString(),
        lines: receipt.lines.map((l) => ({
          purchaseOrderLineExternalId: l.purchaseOrderLine.smartErpExternalId,
          quantityReceived: Number(l.quantity),
        })),
      }),
    });
    await prisma.receipt.update({
      where: { id: receipt.id },
      data: { smartErpExternalId: body.data.id, smartErpSyncStatus: "SYNCED", smartErpSyncError: null },
    });
  } catch (err: any) {
    await prisma.receipt.update({
      where: { id: receipt.id },
      data: { smartErpSyncStatus: "FAILED", smartErpSyncError: String(err.message).slice(0, 500) },
    });
  }
}
