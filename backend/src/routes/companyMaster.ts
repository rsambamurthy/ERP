import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";

// Company Master data — for statutory filings (AOC-4 etc.), not used by any
// transactional posting anywhere in this app. OWNER/ADMIN only, same as
// Branches — a regular ACCOUNTANT/VIEWER has no reason to edit this.
const canManageCompany = requirePermission("company.manage");

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

const router = Router();
router.use(authenticate, requireActiveSubscription);

// GET /company-master — org's own statutory fields + directors + auditors.
router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true, name: true, cin: true, companyPan: true, companyType: true,
      incorporationDate: true, registeredOfficeAddress: true, poApprovalThreshold: true,
      priceVarianceTolerancePct: true, soApprovalThreshold: true, allowNegativeStock: true,
    },
  });
  if (!org) return res.status(404).json({ message: "Organization not found." });

  const [directors, auditors] = await Promise.all([
    prisma.director.findMany({ where: { organizationId }, orderBy: [{ isActive: "desc" }, { createdAt: "asc" }] }),
    prisma.auditor.findMany({ where: { organizationId }, orderBy: [{ isActive: "desc" }, { createdAt: "asc" }] }),
  ]);

  res.json({ data: { ...org, directors, auditors } });
});

// PATCH /company-master — update the org's own statutory fields.
router.patch("/", canManageCompany, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const {
    cin, companyPan, companyType, incorporationDate, registeredOfficeAddress,
    poApprovalThreshold, priceVarianceTolerancePct, soApprovalThreshold,
    allowNegativeStock,
  } = req.body ?? {};
  if (poApprovalThreshold !== undefined && poApprovalThreshold !== null && !(Number(poApprovalThreshold) >= 0)) {
    return res.status(400).json({ message: "poApprovalThreshold must be a non-negative number, or null." });
  }
  if (
    priceVarianceTolerancePct !== undefined && priceVarianceTolerancePct !== null &&
    !(Number(priceVarianceTolerancePct) >= 0 && Number(priceVarianceTolerancePct) <= 100)
  ) {
    return res.status(400).json({ message: "priceVarianceTolerancePct must be between 0 and 100, or null." });
  }
  if (soApprovalThreshold !== undefined && soApprovalThreshold !== null && !(Number(soApprovalThreshold) >= 0)) {
    return res.status(400).json({ message: "soApprovalThreshold must be a non-negative number, or null." });
  }
  const updated = await prisma.organization.update({
    where: { id: organizationId },
    data: {
      cin: cin ?? null,
      companyPan: companyPan ?? null,
      companyType: companyType ?? null,
      incorporationDate: incorporationDate ? new Date(incorporationDate) : null,
      registeredOfficeAddress: registeredOfficeAddress ?? null,
      // Purchase Order auto-approval threshold — see the schema comment on
      // Organization.poApprovalThreshold. Same convention as every other
      // field on this endpoint: omit it (or send null) to clear it back to
      // "always require manual approval".
      poApprovalThreshold: poApprovalThreshold != null ? Number(poApprovalThreshold) : null,
      // 3-way match price tolerance — see the schema comment on
      // Organization.priceVarianceTolerancePct. Same omit/null-clears
      // convention; null means "0% tolerance, any variance needs approval".
      priceVarianceTolerancePct: priceVarianceTolerancePct != null ? Number(priceVarianceTolerancePct) : null,
      // Sales Order auto-approval threshold — see the schema comment on
      // Organization.soApprovalThreshold. Same omit/null-clears convention
      // as poApprovalThreshold above.
      soApprovalThreshold: soApprovalThreshold != null ? Number(soApprovalThreshold) : null,
      // May a Sales Invoice sell stock the branch does not hold? See
      // migration_053. Follows this endpoint's omit-clears convention, and
      // that convention is doing real work here: forgetting to send the
      // field turns the override OFF, which is the safe direction to fail
      // in. Only an explicit true enables it.
      //
      // Enabling it grants the POSSIBILITY, never the behaviour - every
      // invoice still has to ask for the override by name and give a
      // reason, so turning this on changes nothing about what any existing
      // document does.
      allowNegativeStock: allowNegativeStock === true,
    },
    select: {
      id: true, name: true, cin: true, companyPan: true, companyType: true,
      incorporationDate: true, registeredOfficeAddress: true, poApprovalThreshold: true,
      priceVarianceTolerancePct: true, soApprovalThreshold: true, allowNegativeStock: true,
    },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "organization", entityId: organizationId,
    summary: "Updated company master data",
  });
  res.json({ data: updated });
});

// ── Directors ────────────────────────────────────────────────────────────

router.post("/directors", canManageCompany, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const { name, din, designation, appointmentDate } = req.body ?? {};
  if (!name) return res.status(400).json({ message: "name is required." });

  const director = await prisma.director.create({
    data: {
      organizationId, name, din: din ?? null, designation: designation ?? null,
      appointmentDate: appointmentDate ? new Date(appointmentDate) : null,
    },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "CREATE", entityType: "director", entityId: director.id,
    summary: `Added director ${director.name}`,
  });
  res.status(201).json({ data: director });
});

router.patch("/directors/:id", canManageCompany, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const existing = await prisma.director.findFirst({ where: { id: req.params.id, organizationId } });
  if (!existing) return res.status(404).json({ message: "Director not found." });

  const { name, din, designation, appointmentDate, cessationDate, isActive } = req.body ?? {};
  const director = await prisma.director.update({
    where: { id: existing.id },
    data: {
      name: name ?? existing.name,
      din: din === undefined ? existing.din : din,
      designation: designation === undefined ? existing.designation : designation,
      appointmentDate: appointmentDate === undefined ? existing.appointmentDate : appointmentDate ? new Date(appointmentDate) : null,
      cessationDate: cessationDate === undefined ? existing.cessationDate : cessationDate ? new Date(cessationDate) : null,
      isActive: isActive === undefined ? existing.isActive : !!isActive,
    },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "director", entityId: director.id,
    summary: `Updated director ${director.name}`,
  });
  res.json({ data: director });
});

router.delete("/directors/:id", canManageCompany, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const existing = await prisma.director.findFirst({ where: { id: req.params.id, organizationId } });
  if (!existing) return res.status(404).json({ message: "Director not found." });

  await prisma.director.delete({ where: { id: existing.id } });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "DELETE", entityType: "director", entityId: existing.id,
    summary: `Removed director ${existing.name}`,
  });
  res.json({ data: { deleted: true } });
});

// ── Auditors ─────────────────────────────────────────────────────────────

router.post("/auditors", canManageCompany, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const { name, membershipNumber, firmRegistrationNumber, appointmentDate } = req.body ?? {};
  if (!name) return res.status(400).json({ message: "name is required." });

  const auditor = await prisma.auditor.create({
    data: {
      organizationId, name, membershipNumber: membershipNumber ?? null, firmRegistrationNumber: firmRegistrationNumber ?? null,
      appointmentDate: appointmentDate ? new Date(appointmentDate) : null,
    },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "CREATE", entityType: "auditor", entityId: auditor.id,
    summary: `Added auditor ${auditor.name}`,
  });
  res.status(201).json({ data: auditor });
});

router.patch("/auditors/:id", canManageCompany, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const existing = await prisma.auditor.findFirst({ where: { id: req.params.id, organizationId } });
  if (!existing) return res.status(404).json({ message: "Auditor not found." });

  const { name, membershipNumber, firmRegistrationNumber, appointmentDate, tenureEndDate, isActive } = req.body ?? {};
  const auditor = await prisma.auditor.update({
    where: { id: existing.id },
    data: {
      name: name ?? existing.name,
      membershipNumber: membershipNumber === undefined ? existing.membershipNumber : membershipNumber,
      firmRegistrationNumber: firmRegistrationNumber === undefined ? existing.firmRegistrationNumber : firmRegistrationNumber,
      appointmentDate: appointmentDate === undefined ? existing.appointmentDate : appointmentDate ? new Date(appointmentDate) : null,
      tenureEndDate: tenureEndDate === undefined ? existing.tenureEndDate : tenureEndDate ? new Date(tenureEndDate) : null,
      isActive: isActive === undefined ? existing.isActive : !!isActive,
    },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "auditor", entityId: auditor.id,
    summary: `Updated auditor ${auditor.name}`,
  });
  res.json({ data: auditor });
});

router.delete("/auditors/:id", canManageCompany, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const existing = await prisma.auditor.findFirst({ where: { id: req.params.id, organizationId } });
  if (!existing) return res.status(404).json({ message: "Auditor not found." });

  await prisma.auditor.delete({ where: { id: existing.id } });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "DELETE", entityType: "auditor", entityId: existing.id,
    summary: `Removed auditor ${existing.name}`,
  });
  res.json({ data: { deleted: true } });
});

export default router;
