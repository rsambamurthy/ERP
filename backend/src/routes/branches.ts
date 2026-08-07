import { Router } from "express";
import { prisma } from "../db";
import { authenticate, resolveOrgId } from "../middleware/auth";

const router = Router();

// GET /branches — the caller's own org's branches (or, for a platform
// admin, whichever org ?organizationId= names). Authenticated, unlike
// POST below — this is for post-login screens (e.g. assigning a team
// member to a branch), not the onboarding wizard.
router.get("/", authenticate, async (req, res) => {
  const organizationId = resolveOrgId(req);
  if (!organizationId) return res.status(400).json({ message: "organizationId is required." });

  const branches = await prisma.branch.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { isHeadOffice: "desc" },
    select: { id: true, code: true, name: true, isHeadOffice: true },
  });
  res.json({ data: branches });
});

// POST /branches — available any time, not domain-locked (opening a new
// location doesn't touch the chart of accounts). Pre-existing route, not
// currently called from any frontend screen — left as-is (unauthenticated,
// trusts a body-supplied organizationId) rather than changed as a side
// effect of this pass; if a "New Branch" screen gets built, it should
// probably go through `authenticate` + `resolveOrgId` like GET / above.
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
