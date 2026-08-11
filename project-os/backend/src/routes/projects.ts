import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requireRole } from "../middleware/auth";

const router = Router();
router.use(authenticate);

// GET /projects — list, scoped to the caller's organisation.
router.get("/", async (req, res) => {
  const projects = await prisma.project.findMany({
    where: { organizationId: req.user!.organizationId, deletedAt: null },
    include: { customer: true, sites: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ data: projects });
});

// GET /projects/:id
router.get("/:id", async (req, res) => {
  const project = await prisma.project.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId, deletedAt: null },
    include: { customer: true, sites: true, contract: true, team: true },
  });
  if (!project) return res.status(404).json({ message: "Project not found." });
  res.json({ data: project });
});

// POST /projects — Section 6.2. Project Manager or Super Admin create;
// everyone else is read-only per the Section 10 roles matrix.
router.post("/", requireRole("SUPER_ADMIN", "PROJECT_MANAGER"), async (req, res) => {
  const { code, name, customerId, startDate, targetEndDate, poApprovalThreshold } = req.body ?? {};
  if (!code || !name) {
    return res.status(400).json({ message: "code and name are required." });
  }

  const existing = await prisma.project.findFirst({
    where: { organizationId: req.user!.organizationId, code },
  });
  if (existing) {
    return res.status(409).json({ message: `Project code "${code}" is already in use.` });
  }

  const project = await prisma.project.create({
    data: {
      organizationId: req.user!.organizationId,
      code,
      name,
      customerId: customerId ?? null,
      startDate: startDate ? new Date(startDate) : null,
      targetEndDate: targetEndDate ? new Date(targetEndDate) : null,
      poApprovalThreshold: poApprovalThreshold ?? null,
    },
  });
  res.status(201).json({ data: project });
});

// PATCH /projects/:id — status transitions and basic field edits.
// R1 does not enforce the full lifecycle state machine (Appendix A of
// the blueprint) yet — any status value is accepted as long as the
// caller has permission. Enforcing legal transitions is a natural next
// addition once real pilot usage shows which invalid transitions
// actually happen.
router.patch("/:id", requireRole("SUPER_ADMIN", "PROJECT_MANAGER"), async (req, res) => {
  const project = await prisma.project.findFirst({
    where: { id: req.params.id, organizationId: req.user!.organizationId, deletedAt: null },
  });
  if (!project) return res.status(404).json({ message: "Project not found." });

  const { name, status, startDate, targetEndDate, poApprovalThreshold } = req.body ?? {};
  const updated = await prisma.project.update({
    where: { id: project.id },
    data: {
      name: name ?? undefined,
      status: status ?? undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      targetEndDate: targetEndDate ? new Date(targetEndDate) : undefined,
      poApprovalThreshold: poApprovalThreshold ?? undefined,
    },
  });
  res.json({ data: updated });
});

// ---------------------------------------------------------------------
// Project Sites — needed by Inventory (Section 6.5) for PROJECT_SITE
// stock locations. No dedicated update/delete route in R1; a site is
// effectively permanent once created, same as the PRD doesn't call out
// site editing as an R1 requirement.
// ---------------------------------------------------------------------

router.post("/:projectId/sites", requireRole("SUPER_ADMIN", "PROJECT_MANAGER"), async (req, res) => {
  const project = await prisma.project.findFirst({
    where: { id: req.params.projectId, organizationId: req.user!.organizationId, deletedAt: null },
  });
  if (!project) return res.status(404).json({ message: "Project not found." });

  const { name, address, stateCode } = req.body ?? {};
  if (!name) return res.status(400).json({ message: "name is required." });

  const site = await prisma.projectSite.create({
    data: { projectId: project.id, name, address: address ?? undefined, stateCode: stateCode ?? null },
  });
  res.status(201).json({ data: site });
});

router.get("/:projectId/sites", async (req, res) => {
  const project = await prisma.project.findFirst({
    where: { id: req.params.projectId, organizationId: req.user!.organizationId, deletedAt: null },
  });
  if (!project) return res.status(404).json({ message: "Project not found." });

  const sites = await prisma.projectSite.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "asc" } });
  res.json({ data: sites });
});

export default router;
