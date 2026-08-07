import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePlatformAdmin } from "../middleware/auth";
import { logAudit } from "../lib/audit";

const router = Router();
router.use(authenticate, requirePlatformAdmin);

// GET /admin/organizations?q= — every org on the platform. `q` matches name
// (case-insensitive contains), same shape as SmartAppt's association search.
router.get("/organizations", async (req, res) => {
  const q = req.query.q ? String(req.query.q).trim() : "";
  const orgs = await prisma.organization.findMany({
    where: {
      deletedAt: null,
      ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      orgDomains: { include: { domainType: true } },
      branches: { select: { id: true } },
      orgUsers: { select: { userId: true } },
      orgModules: { include: { module: true } },
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
      modules: o.orgModules.map((m) => ({ code: m.module.code, name: m.module.name, status: m.status, expiresOn: m.expiresOn })),
      createdAt: o.createdAt,
    })),
  });
});

// GET /admin/organizations/:id — full detail for the drill-in screen: who's
// on the team, what's provisioned, what modules are active. This is the
// platform-admin equivalent of SmartAppt's AssociationDetailPage — from
// here the admin can then call the ordinary /accounts, /business-partners,
// /journal, /org/users endpoints with ?organizationId=:id to actually work
// inside this org, the same way SUPER_USER passes ?association_id=.
router.get("/organizations/:id", async (req, res) => {
  const org = await prisma.organization.findFirst({
    where: { id: req.params.id, deletedAt: null },
    include: {
      orgDomains: { include: { domainType: true } },
      branches: true,
      orgUsers: {
        include: {
          user: { select: { id: true, email: true, phone: true, isVerified: true } },
          customRole: { select: { name: true } },
        },
      },
      orgModules: { include: { module: true } },
      _count: { select: { journalEntries: true, accounts: true, businessPartners: true } },
    },
  });
  if (!org) return res.status(404).json({ message: "Organization not found." });

  res.json({
    data: {
      id: org.id,
      name: org.name,
      status: org.status,
      subscriptionStatus: org.subscriptionStatus,
      createdAt: org.createdAt,
      domains: org.orgDomains.map((d) => ({ code: d.domainType.code, name: d.domainType.name, addedAt: d.addedAt })),
      branches: org.branches.map((b) => ({ id: b.id, code: b.code, name: b.name, isHeadOffice: b.isHeadOffice, status: b.status })),
      users: org.orgUsers.map((u) => ({
        userId: u.userId, role: u.role, customRoleName: u.customRole?.name ?? null,
        email: u.user.email, phone: u.user.phone, isVerified: u.user.isVerified,
      })),
      modules: org.orgModules.map((m) => ({
        code: m.module.code, name: m.module.name, status: m.status,
        startsOn: m.startsOn, expiresOn: m.expiresOn, amount: m.amount,
      })),
      counts: {
        journalEntries: org._count.journalEntries,
        accounts: org._count.accounts,
        businessPartners: org._count.businessPartners,
      },
    },
  });
});

// PATCH /admin/organizations/:id — SmartAppt-style association edit: name/
// contact-ish fields. SmartERP doesn't carry address/contact on Organization
// today, so this is deliberately narrow — it exists so the shape matches
// (and future contact fields can be added here without a new endpoint).
router.patch("/organizations/:id", async (req, res) => {
  const { name } = req.body ?? {};
  const org = await prisma.organization.findFirst({ where: { id: req.params.id, deletedAt: null } });
  if (!org) return res.status(404).json({ message: "Organization not found." });

  const updated = await prisma.organization.update({
    where: { id: org.id },
    data: { ...(name ? { name } : {}) },
  });
  logAudit({
    organizationId: org.id, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "organization", entityId: org.id,
    summary: `Platform admin updated ${org.name}`,
  });
  res.json({ data: { id: updated.id, name: updated.name } });
});

// PATCH /admin/organizations/:id/subscription — { status: "ACTIVE" | "SUSPENDED" }
// The org-wide kill switch: a SUSPENDED org's accounting endpoints 402 for
// everyone but a platform admin (requireActiveSubscription). Separate from
// the per-module console below — this is "is this org allowed in at all",
// the modules console is "which parts of the product does it have".
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

// DELETE /admin/organizations/:id — permanently removes an organization and
// everything in it. Mirrors SmartAppt's hardDelete guardrails: must already
// be SUSPENDED, and must have no posted transactions (the accounting
// equivalent of "no units left") — the real off-ramp for that data is an
// export, not this endpoint, so it deliberately refuses rather than silently
// destroying financial history.
router.delete("/organizations/:id", async (req, res) => {
  const org = await prisma.organization.findFirst({
    where: { id: req.params.id, deletedAt: null },
    include: { _count: { select: { journalEntries: true } } },
  });
  if (!org) return res.status(404).json({ message: "Organization not found." });

  if (org.subscriptionStatus !== "SUSPENDED") {
    return res.status(422).json({ message: "Organization must be suspended before it can be permanently deleted." });
  }
  if (org._count.journalEntries > 0) {
    return res.status(422).json({
      message: `Cannot delete: this organization has ${org._count.journalEntries} posted journal entr${org._count.journalEntries === 1 ? "y" : "ies"}. Export its books first.`,
    });
  }

  const id = org.id;
  await prisma.$transaction(async (tx) => {
    await tx.journalLine.deleteMany({ where: { journalEntry: { organizationId: id } } });
    await tx.journalEntry.deleteMany({ where: { organizationId: id } });
    await tx.itemStock.deleteMany({ where: { item: { organizationId: id } } });
    await tx.bomLine.deleteMany({ where: { organizationId: id } });
    await tx.item.deleteMany({ where: { organizationId: id } });
    // Children first, then parents — accounts can self-reference via parentId.
    await tx.account.deleteMany({ where: { organizationId: id, parentId: { not: null } } });
    await tx.account.deleteMany({ where: { organizationId: id } });
    await tx.businessPartner.deleteMany({ where: { organizationId: id } });
    await tx.orgInvite.deleteMany({ where: { organizationId: id } });
    await tx.auditLog.deleteMany({ where: { organizationId: id } });
    await tx.orgUser.deleteMany({ where: { organizationId: id } });
    await tx.orgModule.deleteMany({ where: { organizationId: id } });
    await tx.onboardingState.deleteMany({ where: { organizationId: id } });
    await tx.branch.deleteMany({ where: { organizationId: id } });
    await tx.orgDomain.deleteMany({ where: { organizationId: id } });
    await tx.organization.delete({ where: { id } });
  });

  // Not scoped to the org being deleted — logged against no organization so
  // it survives in the platform-wide trail.
  logAudit({
    organizationId: null, actorUserId: req.user!.userId,
    action: "HARD_DELETE", entityType: "organization", entityId: id,
    summary: `Platform admin permanently deleted ${org.name}`,
  });

  res.json({ data: { deleted: true } });
});

// ── Per-module subscription console ─────────────────────────────────────────
// GET /admin/subscriptions?q=&filter=ALL|EXPIRING|LAPSED|TRIAL|UNSUBSCRIBED
// Mirrors SmartAppt's subscriptions.routes.ts: one row per org, one column
// per module, so a platform admin can see and manage entitlement at a
// glance instead of guessing from the org list.
router.get("/subscriptions", async (req, res) => {
  const q = req.query.q ? String(req.query.q).trim() : "";
  const filter = String(req.query.filter ?? "ALL").toUpperCase();
  const today = new Date();
  const soon = new Date();
  soon.setDate(soon.getDate() + 14);

  const moduleFilter: Record<string, object> = {
    ALL: {},
    EXPIRING: { orgModules: { some: { status: "ACTIVE", expiresOn: { not: null, gte: today, lte: soon } } } },
    LAPSED: { OR: [{ orgModules: { some: { status: "CANCELLED" } } }, { orgModules: { some: { expiresOn: { not: null, lt: today } } } }] },
    TRIAL: { orgModules: { some: { status: "TRIAL" } } },
    UNSUBSCRIBED: { orgModules: { none: {} } },
  };

  const orgs = await prisma.organization.findMany({
    where: {
      deletedAt: null,
      ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
      ...(moduleFilter[filter] ?? {}),
    },
    orderBy: { name: "asc" },
    include: { orgModules: { include: { module: true } } },
  });

  const allModules = await prisma.module.findMany({ orderBy: { name: "asc" } });

  res.json({
    data: orgs.map((o) => ({
      id: o.id,
      name: o.name,
      modules: o.orgModules.map((m) => ({
        code: m.module.code, name: m.module.name, status: m.status,
        startsOn: m.startsOn, expiresOn: m.expiresOn, amount: m.amount,
      })),
    })),
    catalog: allModules.map((m) => ({ code: m.code, name: m.name })),
  });
});

// POST /admin/subscriptions/:organizationId/:moduleCode — grant or renew.
// An open-ended paid grant is almost always a slip, so expiresOn must be
// explicit — pass null for perpetual access, same rule SmartAppt enforces.
router.post("/subscriptions/:organizationId/:moduleCode", async (req, res) => {
  const { organizationId, moduleCode } = req.params;
  const { status, expiresOn, startsOn, amount, reference, note } = req.body ?? {};

  if (expiresOn === undefined) {
    return res.status(422).json({ message: "Set expiresOn, or pass expiresOn: null for perpetual access." });
  }
  if (status && !["ACTIVE", "TRIAL"].includes(status)) {
    return res.status(400).json({ message: "status must be ACTIVE or TRIAL." });
  }

  const [org, mod] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId } }),
    prisma.module.findUnique({ where: { code: moduleCode } }),
  ]);
  if (!org) return res.status(404).json({ message: "Organization not found." });
  if (!mod) return res.status(404).json({ message: "Unknown module." });

  const record = await prisma.orgModule.upsert({
    where: { organizationId_moduleId: { organizationId, moduleId: mod.id } },
    create: {
      organizationId, moduleId: mod.id,
      status: status ?? "ACTIVE",
      startsOn: startsOn ? new Date(startsOn) : new Date(),
      expiresOn: expiresOn === null ? null : new Date(expiresOn),
      amount: amount === undefined || amount === null || amount === "" ? null : Number(amount),
      reference: reference ?? null,
      note: note ?? null,
      grantedBy: req.user!.userId,
    },
    update: {
      status: status ?? "ACTIVE",
      ...(startsOn ? { startsOn: new Date(startsOn) } : {}),
      expiresOn: expiresOn === null ? null : new Date(expiresOn),
      amount: amount === undefined || amount === null || amount === "" ? null : Number(amount),
      reference: reference ?? null,
      note: note ?? null,
      grantedBy: req.user!.userId,
    },
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "GRANT_MODULE", entityType: "org_module", entityId: record.moduleId,
    summary: `${mod.name} set to ${record.status} for ${org.name}` + (record.expiresOn ? ` until ${record.expiresOn.toISOString().slice(0, 10)}` : " (perpetual)"),
  });

  res.json({ data: record });
});

// DELETE /admin/subscriptions/:organizationId/:moduleCode — cancel. The row
// is kept (status CANCELLED) rather than removed, so the org's history and
// billing reference survive.
router.delete("/subscriptions/:organizationId/:moduleCode", async (req, res) => {
  const { organizationId, moduleCode } = req.params;
  const mod = await prisma.module.findUnique({ where: { code: moduleCode } });
  if (!mod) return res.status(404).json({ message: "Unknown module." });

  const existing = await prisma.orgModule.findUnique({
    where: { organizationId_moduleId: { organizationId, moduleId: mod.id } },
  });
  if (!existing) return res.status(404).json({ message: "This org was never granted that module." });

  const record = await prisma.orgModule.update({
    where: { organizationId_moduleId: { organizationId, moduleId: mod.id } },
    data: { status: "CANCELLED" },
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "CANCEL_MODULE", entityType: "org_module", entityId: mod.id,
    summary: `${mod.name} cancelled for this organization`,
  });

  res.json({ data: record });
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
