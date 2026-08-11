import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requireRole } from "../middleware/auth";

const router = Router();
router.use(authenticate);

async function getOrgProject(projectId: string, organizationId: string) {
  return prisma.project.findFirst({ where: { id: projectId, organizationId, deletedAt: null } });
}

// GET /budget/project/:projectId — list all budget line items, every
// version, most recent first.
router.get("/project/:projectId", async (req, res) => {
  const project = await getOrgProject(req.params.projectId, req.user!.organizationId);
  if (!project) return res.status(404).json({ message: "Project not found." });

  const budgets = await prisma.budget.findMany({
    where: { projectId: project.id },
    include: { costCategory: true },
    orderBy: [{ version: "desc" }, { costCategoryId: "asc" }],
  });
  res.json({ data: budgets });
});

// POST /budget/project/:projectId/generate — Section 6.3: "Budget:
// versioned, with an approval step before it becomes the baseline."
//
// Deliberately sums *Estimate* cost components (materialCost/
// labourCost/subcontractCost/overheadCost), not BoqLine.amount.
// BoqLine.amount (quantity × rate) is the line's billing/contract
// value — what the line is worth, not what it costs to deliver. Budget
// is compared against Procurement's committed/actual spend (Section
// 6.7's "Budget vs. Committed vs. Actual"), so it has to represent
// expected *cost*, which is exactly what Estimate captures and
// BoqLine.amount does not. Using billing value here would silently
// assume zero margin on every line, which is wrong far more often than
// it's right. A line with no Estimate entered yet contributes nothing
// and is called out in the warning below, rather than being guessed at.
//
// Each generated row starts DRAFT; PATCH .../approve below is the
// separate approval step. Note: OTHER never gets a budget row from this
// path — Estimate has no "other cost" component, only the four listed
// above (matches the blueprint's own Estimate object model, Section 3).
router.post("/project/:projectId/generate", requireRole("SUPER_ADMIN", "ESTIMATOR"), async (req, res) => {
  const project = await getOrgProject(req.params.projectId, req.user!.organizationId);
  if (!project) return res.status(404).json({ message: "Project not found." });

  const approvedBoq = await prisma.boq.findFirst({ where: { projectId: project.id, status: "APPROVED" } });
  if (!approvedBoq) return res.status(409).json({ message: "This project has no approved BOQ yet — approve one before generating a budget." });

  const [lines, categories] = await Promise.all([
    prisma.boqLine.findMany({ where: { boqId: approvedBoq.id }, select: { id: true, estimate: true } }),
    prisma.costCategory.findMany({ where: { organizationId: req.user!.organizationId } }),
  ]);
  const categoryIdByName = new Map(categories.map((c) => [c.name, c.id]));

  const totals = { MATERIAL: 0, LABOUR: 0, SUBCONTRACT: 0, OVERHEAD: 0 };
  let noEstimate = 0;
  for (const line of lines) {
    if (!line.estimate) { noEstimate++; continue; }
    totals.MATERIAL += Number(line.estimate.materialCost);
    totals.LABOUR += Number(line.estimate.labourCost);
    totals.SUBCONTRACT += Number(line.estimate.subcontractCost);
    totals.OVERHEAD += Number(line.estimate.overheadCost);
  }

  const lastVersion = await prisma.budget.findFirst({ where: { projectId: project.id }, orderBy: { version: "desc" } });
  const version = (lastVersion?.version ?? 0) + 1;

  const rows = (Object.entries(totals) as [keyof typeof totals, number][])
    .filter(([, baselineAmount]) => baselineAmount > 0)
    .map(([name, baselineAmount]) => ({ costCategoryId: categoryIdByName.get(name)!, baselineAmount }))
    .filter((r) => r.costCategoryId); // defensive — categories are seeded at registration, but don't crash if one's missing

  const created = await prisma.$transaction(
    rows.map((r) => prisma.budget.create({ data: { projectId: project.id, version, ...r, status: "DRAFT" } }))
  );

  res.status(201).json({
    data: created,
    warning: noEstimate > 0 ? `${noEstimate} BOQ line(s) have no cost estimate yet and were excluded from this budget.` : undefined,
  });
});

// PATCH /budget/:budgetId/approve — Project Manager review/approve, per
// the Section 10 roles matrix. approvedAmount defaults to the generated
// baseline but can be overridden (e.g. a PM trims a category down)
// before it's locked in.
router.patch("/:budgetId/approve", requireRole("SUPER_ADMIN", "PROJECT_MANAGER"), async (req, res) => {
  const budget = await prisma.budget.findUnique({ where: { id: req.params.budgetId }, include: { project: true } });
  if (!budget || budget.project.organizationId !== req.user!.organizationId) {
    return res.status(404).json({ message: "Budget not found." });
  }
  if (budget.status === "APPROVED") return res.status(409).json({ message: "This budget line is already approved." });

  const approvedAmount = req.body?.approvedAmount != null ? Number(req.body.approvedAmount) : Number(budget.baselineAmount);
  const updated = await prisma.budget.update({
    where: { id: budget.id },
    data: { approvedAmount, status: "APPROVED" },
  });
  res.json({ data: updated });
});

export default router;
