import { Router } from "express";
import { prisma } from "../db";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate);

// GET /business-partners?bpType=CUSTOMER|VENDOR
router.get("/", async (req, res) => {
  const bpType = req.query.bpType ? String(req.query.bpType) : undefined;
  const partners = await prisma.businessPartner.findMany({
    where: {
      organizationId: req.user!.organizationId,
      deletedAt: null,
      ...(bpType ? { bpType } : {}),
    },
    orderBy: { name: "asc" },
  });
  res.json({ data: partners });
});

// POST /business-partners — creates a customer or vendor master record.
router.post("/", async (req, res) => {
  const { bpType, name, gstin, phone, email, address, openingBalance, openingBalanceType } = req.body ?? {};
  if (!bpType || !["CUSTOMER", "VENDOR"].includes(bpType) || !name) {
    return res.status(400).json({ message: "bpType (CUSTOMER or VENDOR) and name are required." });
  }

  const partner = await prisma.businessPartner.create({
    data: {
      organizationId: req.user!.organizationId,
      bpType, name,
      gstin: gstin ?? null,
      phone: phone ?? null,
      email: email ?? null,
      address: address ?? null,
      openingBalance: openingBalance ?? 0,
      openingBalanceType: openingBalanceType ?? null,
    },
  });
  res.status(201).json({ data: partner });
});

router.patch("/:id", async (req, res) => {
  const partner = await prisma.businessPartner.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
  });
  if (!partner) return res.status(404).json({ message: "Business partner not found." });

  const updated = await prisma.businessPartner.update({
    where: { id: partner.id },
    data: req.body ?? {},
  });
  res.json({ data: updated });
});

router.patch("/:id/toggle", async (req, res) => {
  const partner = await prisma.businessPartner.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
  });
  if (!partner) return res.status(404).json({ message: "Business partner not found." });

  const updated = await prisma.businessPartner.update({
    where: { id: partner.id },
    data: { isActive: !partner.isActive },
  });
  res.json({ data: updated });
});

router.delete("/:id", async (req, res) => {
  const partner = await prisma.businessPartner.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId },
  });
  if (!partner) return res.status(404).json({ message: "Business partner not found." });

  const used = await prisma.journalLine.findFirst({ where: { businessPartnerId: partner.id } });
  if (used) {
    return res.status(409).json({ message: "This business partner has journal entries and cannot be deleted." });
  }

  await prisma.businessPartner.update({ where: { id: partner.id }, data: { deletedAt: new Date() } });
  res.json({ data: { deleted: true } });
});

export default router;
