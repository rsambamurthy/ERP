import { Router } from "express";
import { prisma } from "../db";

const router = Router();

// POST /branches — available any time, not domain-locked (opening a new
// location doesn't touch the chart of accounts).
router.post("/", async (req, res) => {
  const { organizationId, code, name, gstin, address } = req.body ?? {};
  if (!organizationId || !code || !name) {
    return res.status(400).json({ message: "organizationId, code, and name are required." });
  }

  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) return res.status(404).json({ message: "Organization not found." });

  const branch = await prisma.branch.create({
    data: { organizationId, code, name, gstin, address },
  });

  res.status(201).json({ id: branch.id, code: branch.code, name: branch.name });
});

export default router;
