import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requireRole } from "../middleware/auth";

const router = Router();
router.use(authenticate);

// Progress entry and material-consumption reporting (PRD Section 6.6)
// are genuinely not built yet — see the 501 catch-all below. Activity
// create/list is pulled forward out of that scope because Inventory's
// issue endpoint (POST /inventory/issues) can optionally link an issue
// to an activityId, and there was no way to create one to test that
// against. This is the minimum needed for that, not the full Section
// 6.6 feature set.

router.post("/activities", requireRole("SUPER_ADMIN", "PROJECT_MANAGER", "SITE_ENGINEER"), async (req, res) => {
  const { projectId, boqLineId, name } = req.body ?? {};
  if (!projectId || !name) return res.status(400).json({ message: "projectId and name are required." });

  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: req.user!.organizationId, deletedAt: null } });
  if (!project) return res.status(404).json({ message: "Project not found." });

  const activity = await prisma.activity.create({ data: { projectId, boqLineId: boqLineId ?? null, name } });
  res.status(201).json({ data: activity });
});

router.get("/activities/project/:projectId", async (req, res) => {
  const project = await prisma.project.findFirst({ where: { id: req.params.projectId, organizationId: req.user!.organizationId, deletedAt: null } });
  if (!project) return res.status(404).json({ message: "Project not found." });

  const activities = await prisma.activity.findMany({ where: { projectId: project.id }, orderBy: { name: "asc" } });
  res.json({ data: activities });
});

router.all("*", (_req, res) => {
  res.status(501).json({
    message: "Progress entry and material-consumption reporting are not implemented yet — see PRD Section 6.6. Activity create/list is available (POST/GET /execution/activities) since Inventory's issue endpoint links to it.",
  });
});

export default router;
