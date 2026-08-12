import { Router } from "express";
import { randomUUID } from "crypto";
import { prisma } from "../db";
import { authenticate, requireRole } from "../middleware/auth";
import { getSmartErpClient, smartErpFetch } from "../lib/smartErpClient";

const router = Router();
router.use(authenticate);

// ---------------------------------------------------------------------
// SmartERP connection + sync (Section 9.1) — the real thing task #118
// was tracking. POST /connection stores the API key generated on the
// SmartERP side (POST /integration/connections there, OWNER/ADMIN); POST
// /sync pulls Business Partners, Items, and Branches and upserts them
// into the Synced* mirror tables below by externalId.
// ---------------------------------------------------------------------

router.post("/connection", requireRole("SUPER_ADMIN"), async (req, res) => {
  const { apiBaseUrl, apiKey } = req.body ?? {};
  if (!apiBaseUrl || !apiKey) return res.status(400).json({ message: "apiBaseUrl and apiKey are required." });

  const connection = await prisma.smartErpConnection.upsert({
    where: { organizationId: req.user!.organizationId },
    create: { organizationId: req.user!.organizationId, apiBaseUrl, apiKeyCiphertext: apiKey },
    // Stored as plain text for now — same "encryption strategy not
    // decided yet" flag already on this column in schema.prisma.
    update: { apiBaseUrl, apiKeyCiphertext: apiKey, lastSyncStatus: null, lastSyncedAt: null },
  });
  res.status(201).json({ data: { organizationId: connection.organizationId, apiBaseUrl: connection.apiBaseUrl } });
});

router.get("/connection", async (req, res) => {
  const connection = await prisma.smartErpConnection.findUnique({ where: { organizationId: req.user!.organizationId } });
  if (!connection) return res.json({ data: null });
  // Never echoes the raw key back, same convention as SmartERP's own
  // GET /integration/connections.
  res.json({ data: { apiBaseUrl: connection.apiBaseUrl, lastSyncedAt: connection.lastSyncedAt, lastSyncStatus: connection.lastSyncStatus } });
});

// POST /integration/sync — full-table pull every time, not incremental;
// SmartERP's BusinessPartner/Item/Branch have no updatedAt column yet
// (flagged on SmartERP's own GET /integration/business-partners), so
// there's no cheap "changed since X" filter to use without a migration
// there. Fine at pilot volume.
//
// Known gap, not solved here: a SyncedBusinessPartner/SyncedItem created
// through the manual fallback below (POST /synced-suppliers,
// /synced-items) has a locally-generated externalId with no relationship
// to SmartERP's real one — running a sync creates *new* rows alongside
// those rather than reconciling them, exactly the "local, unlinked"
// scenario flagged in the earlier Business-Partner-creation-flow
// discussion as needing a reconciliation UI. Not built; an org that used
// the manual fallback before connecting will end up with duplicates.
router.post("/sync", requireRole("SUPER_ADMIN"), async (req, res) => {
  const organizationId = req.user!.organizationId;
  const client = await getSmartErpClient(organizationId);
  if (!client) return res.status(400).json({ message: "No SmartERP connection configured — POST /integration/connection first." });

  try {
    const [partnersRes, itemsRes, branchesRes] = await Promise.all([
      smartErpFetch(client, "/integration/business-partners"),
      smartErpFetch(client, "/integration/items"),
      smartErpFetch(client, "/integration/branches"),
    ]);

    let partnersSynced = 0, itemsSynced = 0, branchesSynced = 0;

    for (const p of partnersRes.data ?? []) {
      await prisma.syncedBusinessPartner.upsert({
        where: { organizationId_externalId: { organizationId, externalId: p.externalId } },
        create: { organizationId, externalId: p.externalId, bpType: p.bpType, name: p.name, gstin: p.gstin, phone: p.phone, email: p.email, address: p.address ?? undefined, stateCode: p.stateCode },
        update: { bpType: p.bpType, name: p.name, gstin: p.gstin, phone: p.phone, email: p.email, address: p.address ?? undefined, stateCode: p.stateCode, syncedAt: new Date() },
      });
      partnersSynced++;
    }

    for (const i of itemsRes.data ?? []) {
      await prisma.syncedItem.upsert({
        where: { organizationId_externalId: { organizationId, externalId: i.externalId } },
        create: { organizationId, externalId: i.externalId, sku: i.sku, name: i.name, uom: i.uom, hsnCode: i.hsnCode, purchaseRate: i.purchaseRate, salesRate: i.salesRate, taxRate: i.taxRate ?? 0 },
        update: { sku: i.sku, name: i.name, uom: i.uom, hsnCode: i.hsnCode, purchaseRate: i.purchaseRate, salesRate: i.salesRate, taxRate: i.taxRate ?? 0, syncedAt: new Date() },
      });
      itemsSynced++;
    }

    for (const b of branchesRes.data ?? []) {
      await prisma.syncedBranch.upsert({
        where: { organizationId_externalId: { organizationId, externalId: b.externalId } },
        create: { organizationId, externalId: b.externalId, code: b.code, name: b.name, gstin: b.gstin, stateCode: b.stateCode },
        update: { code: b.code, name: b.name, gstin: b.gstin, stateCode: b.stateCode, syncedAt: new Date() },
      });
      branchesSynced++;
    }

    await prisma.smartErpConnection.update({ where: { organizationId }, data: { lastSyncedAt: new Date(), lastSyncStatus: "SUCCESS" } });
    res.json({ data: { partnersSynced, itemsSynced, branchesSynced } });
  } catch (err: any) {
    await prisma.smartErpConnection.update({ where: { organizationId }, data: { lastSyncStatus: "FAILED" } }).catch(() => {});
    res.status(502).json({ message: `Sync failed: ${err.message}` });
  }
});

// ---------------------------------------------------------------------
// Manual master-data fallback (Section 9.1's "if a customer runs the
// Project OS without SmartERP, manual entry is the fallback" path).
// The real sync job (task #118) doesn't exist yet, and Procurement
// can't function at all without at least one Supplier and one Item to
// reference — so this exists to unblock everything downstream, not as
// a permanent feature. `externalId` is a freshly generated UUID here,
// not a real SmartERP ID — there is nothing to reconcile these against
// yet (see the earlier Business-Partner-creation-flow discussion: this
// is the "local, unlinked" path, minus the flag/reconciliation UI that
// diagram called for, which isn't built).
// ---------------------------------------------------------------------

router.post("/synced-suppliers", requireRole("SUPER_ADMIN"), async (req, res) => {
  const { name, gstin, phone, email, stateCode } = req.body ?? {};
  if (!name) return res.status(400).json({ message: "name is required." });
  const supplier = await prisma.syncedBusinessPartner.create({
    data: {
      organizationId: req.user!.organizationId,
      externalId: randomUUID(),
      bpType: "VENDOR",
      name, gstin: gstin ?? null, phone: phone ?? null, email: email ?? null, stateCode: stateCode ?? null,
    },
  });
  res.status(201).json({ data: supplier });
});

router.get("/synced-suppliers", async (req, res) => {
  const suppliers = await prisma.syncedBusinessPartner.findMany({
    where: { organizationId: req.user!.organizationId, bpType: "VENDOR" },
    orderBy: { name: "asc" },
  });
  res.json({ data: suppliers });
});

// GET /integration/synced-customers — same shape as /synced-suppliers,
// filtered to bpType=CUSTOMER. Added for the Project creation form's
// Customer picker; there was previously no read route for customers at
// all, only suppliers (Procurement needed suppliers first).
router.get("/synced-customers", async (req, res) => {
  const customers = await prisma.syncedBusinessPartner.findMany({
    where: { organizationId: req.user!.organizationId, bpType: "CUSTOMER" },
    orderBy: { name: "asc" },
  });
  res.json({ data: customers });
});

router.post("/synced-items", requireRole("SUPER_ADMIN"), async (req, res) => {
  const { sku, name, uom, hsnCode, purchaseRate } = req.body ?? {};
  if (!sku || !name || !uom) return res.status(400).json({ message: "sku, name and uom are required." });
  const item = await prisma.syncedItem.create({
    data: {
      organizationId: req.user!.organizationId,
      externalId: randomUUID(),
      sku, name, uom, hsnCode: hsnCode ?? null, purchaseRate: purchaseRate ?? null,
    },
  });
  res.status(201).json({ data: item });
});

router.get("/synced-items", async (req, res) => {
  const items = await prisma.syncedItem.findMany({
    where: { organizationId: req.user!.organizationId },
    orderBy: { sku: "asc" },
  });
  res.json({ data: items });
});

// Sync (9.1) and the shadow-PO/GRN push (9.2) are both built now — see
// POST /connection, /sync above, and lib/smartErpPush.ts (called from
// routes/procurement.ts and routes/inventory.ts, not routed through here
// directly). Kept as a 501 for any other path under this router rather
// than silently 404ing.
router.all("*", (_req, res) => {
  res.status(501).json({
    message: "Not implemented — see PRD Section 9. POST /integration/connection + /integration/sync (master sync), and the shadow-PO/GRN push triggered automatically on PO approval / GRN creation, are the built parts of this integration.",
  });
});

export default router;
