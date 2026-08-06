import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requireRole, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";

const router = Router();
router.use(authenticate, requireActiveSubscription);
const canManageBp = requireRole("OWNER", "ADMIN", "ACCOUNTANT");

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

// GET /business-partners?bpType=CUSTOMER|VENDOR
router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const bpType = req.query.bpType ? String(req.query.bpType) : undefined;
  const partners = await prisma.businessPartner.findMany({
    where: {
      organizationId,
      deletedAt: null,
      ...(bpType ? { bpType } : {}),
    },
    orderBy: { name: "asc" },
  });
  res.json({ data: partners });
});

// POST /business-partners — creates a customer or vendor master record.
router.post("/", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const { bpType, name, gstin, phone, email, address, openingBalance, openingBalanceType } = req.body ?? {};
  if (!bpType || !["CUSTOMER", "VENDOR"].includes(bpType) || !name) {
    return res.status(400).json({ message: "bpType (CUSTOMER or VENDOR) and name are required." });
  }

  const partner = await prisma.businessPartner.create({
    data: {
      organizationId,
      bpType, name,
      gstin: gstin ?? null,
      phone: phone ?? null,
      email: email ?? null,
      address: address ?? null,
      openingBalance: openingBalance ?? 0,
      openingBalanceType: openingBalanceType ?? null,
    },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "CREATE", entityType: "business_partner", entityId: partner.id,
    summary: `Created ${bpType.toLowerCase()} ${partner.name}`,
  });
  res.status(201).json({ data: partner });
});

router.patch("/:id", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const partner = await prisma.businessPartner.findFirst({
    where: { id: req.params.id, organizationId },
  });
  if (!partner) return res.status(404).json({ message: "Business partner not found." });

  const updated = await prisma.businessPartner.update({
    where: { id: partner.id },
    data: req.body ?? {},
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "business_partner", entityId: partner.id,
    summary: `Updated ${partner.name}`,
  });
  res.json({ data: updated });
});

router.patch("/:id/toggle", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const partner = await prisma.businessPartner.findFirst({
    where: { id: req.params.id, organizationId },
  });
  if (!partner) return res.status(404).json({ message: "Business partner not found." });

  const updated = await prisma.businessPartner.update({
    where: { id: partner.id },
    data: { isActive: !partner.isActive },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "TOGGLE", entityType: "business_partner", entityId: partner.id,
    summary: `${updated.isActive ? "Activated" : "Deactivated"} ${partner.name}`,
  });
  res.json({ data: updated });
});

router.delete("/:id", canManageBp, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const partner = await prisma.businessPartner.findFirst({
    where: { id: req.params.id, organizationId },
  });
  if (!partner) return res.status(404).json({ message: "Business partner not found." });

  const used = await prisma.journalLine.findFirst({ where: { businessPartnerId: partner.id } });
  if (used) {
    return res.status(409).json({ message: "This business partner has journal entries and cannot be deleted." });
  }

  await prisma.businessPartner.update({ where: { id: partner.id }, data: { deletedAt: new Date() } });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "DELETE", entityType: "business_partner", entityId: partner.id,
    summary: `Deleted ${partner.name}`,
  });
  res.json({ data: { deleted: true } });
});

export default router;
