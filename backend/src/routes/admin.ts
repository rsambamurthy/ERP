import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePlatformAdmin } from "../middleware/auth";
import { logAudit } from "../lib/audit";

const router = Router();
router.use(authenticate, requirePlatformAdmin);

// GET /admin/organizations — every org on the platform, for the superuser's
// monitoring screen.
router.get("/organizations", async (_req, res) => {
  const orgs = await prisma.organization.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      orgDomains: { include: { domainType: true } },
      branches: { select: { id: true } },
      orgUsers: { select: { id: true } },
      _count: { select: { journalEntries: true } },
    },
  });

  res.json({
    data: orgs.map((o) => ({
      id: o.id,
      name: o.name,
      status: o.status,
      subscriptionStatus: o.subscriptionStatus,
      domains: o.orgDomains.map((d) => d.domainType.code),
      branchCount: o.branches.length,
      userCount: o.orgUsers.length,
      journalEntryCount: o._count.journalEntries,
      createdAt: o.createdAt,
    })),
  });
});

// PATCH /admin/organizations/:id/subscription — { status: "ACTIVE" | "SUSPENDED" }
router.patch("/organizations/:id/subscription", async (req, res) => {
  const { status } = req.body ?? {};
  if (!["ACTIVE", "SUSPENDED"].includes(status)) {
    return res.status(400).json({ message: "status must be ACTIVE or SUSPENDED." });
  }

  const org = await prisma.organization.findUnique({ where: { id: req.params.id } });
  if (!org) return res.status(404).json({ message: "Organization not found." });

  const updated = await prisma.organization.update({
    where: { id: org.id },
    data: { subscriptionStatus: status },
  });

  logAudit({
    organizationId: org.id, actorUserId: req.user!.userId,
    action: status === "SUSPENDED" ? "SUSPEND" : "REACTIVATE", entityType: "organization", entityId: org.id,
    summary: `Platform admin set ${org.name}'s subscription to ${status}`,
  });

  res.json({ data: { id: updated.id, subscriptionStatus: updated.subscriptionStatus } });
});

// GET /admin/audit-logs?organizationId=&limit=
router.get("/audit-logs", async (req, res) => {
  const { organizationId } = req.query;
  const logs = await prisma.auditLog.findMany({
    where: organizationId ? { organizationId: String(organizationId) } : {},
    include: {
      organization: { select: { id: true, name: true } },
      actor: { select: { id: true, email: true, phone: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json({ data: logs });
});

export default router;
