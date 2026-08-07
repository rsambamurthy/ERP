import { randomBytes } from "crypto";
import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requireRole, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";

const router = Router();
router.use(authenticate);

const ORG_ROLES = ["ADMIN", "ACCOUNTANT", "VIEWER"]; // OWNER is never assignable — set once at registration
const canManageUsers = requireRole("OWNER", "ADMIN");

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

// A request targets either a fixed role ({role: "ADMIN"}) or a custom one
// ({role: "CUSTOM", customRoleId}). Resolves to {role, customRoleId} or an
// error message — doesn't touch the DB itself, callers check existence.
async function resolveRoleInput(
  organizationId: string,
  role: unknown,
  customRoleId: unknown
): Promise<{ ok: true; role: string; customRoleId: string | null } | { ok: false; message: string }> {
  if (role === "CUSTOM") {
    if (!customRoleId || typeof customRoleId !== "string") {
      return { ok: false, message: "customRoleId is required when role is CUSTOM." };
    }
    const found = await prisma.orgRole.findFirst({ where: { id: customRoleId, organizationId } });
    if (!found) return { ok: false, message: "Custom role not found." };
    return { ok: true, role: "CUSTOM", customRoleId };
  }
  if (typeof role !== "string" || !ORG_ROLES.includes(role)) {
    return { ok: false, message: `role must be CUSTOM (with customRoleId) or one of ${ORG_ROLES.join(", ")}.` };
  }
  return { ok: true, role, customRoleId: null };
}

// GET /org/users — current members + pending invites, for the Team settings screen.
router.get("/", canManageUsers, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const members = await prisma.orgUser.findMany({
    where: { organizationId },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true, isVerified: true } },
      customRole: { select: { id: true, name: true } },
    },
  });

  const invites = await prisma.orgInvite.findMany({
    where: { organizationId, acceptedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    include: { customRole: { select: { id: true, name: true } } },
  });

  res.json({
    data: {
      members: members.map((m) => ({
        userId: m.userId, role: m.role, branchId: m.branchId, status: m.status,
        customRoleId: m.customRoleId, customRoleName: m.customRole?.name ?? null,
        name: m.user.name, email: m.user.email, phone: m.user.phone, isVerified: m.user.isVerified,
      })),
      invites: invites.map((i) => ({
        id: i.id, email: i.email, phone: i.phone, role: i.role,
        customRoleId: i.customRoleId, customRoleName: i.customRole?.name ?? null,
        expiresAt: i.expiresAt,
      })),
    },
  });
});

// POST /org/users/invite — OWNER/ADMIN only.
router.post("/invite", canManageUsers, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const { email, phone, role, customRoleId } = req.body ?? {};

  if ((!email && !phone) || !role) {
    return res.status(400).json({ message: "email or phone, and role, are required." });
  }
  const resolved = await resolveRoleInput(organizationId, role, customRoleId);
  if (!resolved.ok) return res.status(400).json({ message: resolved.message });

  const existingUser = await prisma.user.findFirst({
    where: { OR: [email ? { email } : undefined, phone ? { phone } : undefined].filter(Boolean) as any },
  });
  if (existingUser) {
    const alreadyMember = await prisma.orgUser.findUnique({
      where: { organizationId_userId: { organizationId, userId: existingUser.id } },
    });
    if (alreadyMember) return res.status(409).json({ message: "This person is already part of the organization." });
  }

  const token = randomBytes(24).toString("hex");
  const invite = await prisma.orgInvite.create({
    data: {
      organizationId, email: email ?? null, phone: phone ?? null,
      role: resolved.role, customRoleId: resolved.customRoleId,
      invitedBy: req.user!.userId,
      token,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "INVITE", entityType: "org_invite", entityId: invite.id,
    summary: `Invited ${email || phone} as ${resolved.role}`,
  });

  // Dev convenience: no email/SMS provider wired up yet, so hand back the
  // accept-invite link directly (same pattern as devOtp in /auth/register).
  const exposeInviteLink = process.env.EXPOSE_DEV_OTP !== "false";
  res.status(201).json({
    data: {
      id: invite.id, email: invite.email, phone: invite.phone,
      role: invite.role, customRoleId: invite.customRoleId, expiresAt: invite.expiresAt,
    },
    ...(exposeInviteLink ? { devInviteToken: token } : {}),
  });
});

// DELETE /org/invites/:id — cancel a pending invite.
router.delete("/invites/:id", canManageUsers, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const invite = await prisma.orgInvite.findFirst({
    where: { id: req.params.id, organizationId },
  });
  if (!invite) return res.status(404).json({ message: "Invite not found." });
  if (invite.acceptedAt) return res.status(409).json({ message: "This invite was already accepted." });

  await prisma.orgInvite.delete({ where: { id: invite.id } });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "REVOKE", entityType: "org_invite", entityId: invite.id,
    summary: `Cancelled invite to ${invite.email || invite.phone}`,
  });
  res.json({ data: { deleted: true } });
});

// PATCH /org/users/:userId/role — change a teammate's role. Can't touch the
// OWNER (there's exactly one, set at registration) or promote to OWNER.
router.patch("/:userId/role", canManageUsers, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const { role, customRoleId } = req.body ?? {};

  const resolved = await resolveRoleInput(organizationId, role, customRoleId);
  if (!resolved.ok) return res.status(400).json({ message: resolved.message });

  const member = await prisma.orgUser.findUnique({
    where: { organizationId_userId: { organizationId, userId: req.params.userId } },
  });
  if (!member) return res.status(404).json({ message: "Team member not found." });
  if (member.role === "OWNER") return res.status(403).json({ message: "The owner's role can't be changed." });

  const updated = await prisma.orgUser.update({
    where: { organizationId_userId: { organizationId, userId: member.userId } },
    data: { role: resolved.role, customRoleId: resolved.customRoleId },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "org_user", entityId: member.userId,
    summary: `Changed a team member's role from ${member.role} to ${resolved.role}`,
  });
  res.json({ data: { userId: updated.userId, role: updated.role, customRoleId: updated.customRoleId } });
});

// PATCH /org/users/:userId/branch — assign/clear which branch a member
// belongs to. null clears it (org-wide access, the default for everyone
// today since nothing enforced branch scoping before this).
router.patch("/:userId/branch", canManageUsers, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const { branchId } = req.body ?? {};

  if (branchId) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) return res.status(404).json({ message: "Branch not found." });
  }

  const member = await prisma.orgUser.findUnique({
    where: { organizationId_userId: { organizationId, userId: req.params.userId } },
  });
  if (!member) return res.status(404).json({ message: "Team member not found." });

  const updated = await prisma.orgUser.update({
    where: { organizationId_userId: { organizationId, userId: member.userId } },
    data: { branchId: branchId || null },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "org_user", entityId: member.userId,
    summary: branchId ? "Assigned a team member to a branch" : "Cleared a team member's branch assignment",
  });
  res.json({ data: { userId: updated.userId, branchId: updated.branchId } });
});

// PATCH /org/users/:userId/status — suspend/reactivate a member without
// removing them (see migration_010's note: distinct from DELETE, which
// drops org_users entirely). Can't touch the OWNER or yourself — the same
// self-lock concern as role changes, but sharper here since suspending
// yourself with no other OWNER/ADMIN around would be unrecoverable without
// a platform admin.
router.patch("/:userId/status", canManageUsers, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const { status } = req.body ?? {};

  if (status !== "ACTIVE" && status !== "SUSPENDED") {
    return res.status(400).json({ message: "status must be ACTIVE or SUSPENDED." });
  }

  const member = await prisma.orgUser.findUnique({
    where: { organizationId_userId: { organizationId, userId: req.params.userId } },
  });
  if (!member) return res.status(404).json({ message: "Team member not found." });
  if (member.role === "OWNER") return res.status(403).json({ message: "The owner can't be suspended." });
  if (member.userId === req.user!.userId) return res.status(400).json({ message: "You can't suspend your own access." });

  const updated = await prisma.orgUser.update({
    where: { organizationId_userId: { organizationId, userId: member.userId } },
    data: { status },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "org_user", entityId: member.userId,
    summary: status === "SUSPENDED" ? "Suspended a team member's access" : "Reactivated a team member's access",
  });
  res.json({ data: { userId: updated.userId, status: updated.status } });
});

// DELETE /org/users/:userId — revoke access. Can't remove the OWNER, or
// yourself.
router.delete("/:userId", canManageUsers, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const member = await prisma.orgUser.findUnique({
    where: { organizationId_userId: { organizationId, userId: req.params.userId } },
  });
  if (!member) return res.status(404).json({ message: "Team member not found." });
  if (member.role === "OWNER") return res.status(403).json({ message: "The owner can't be removed." });
  if (member.userId === req.user!.userId) return res.status(400).json({ message: "You can't remove your own access." });

  await prisma.orgUser.delete({ where: { organizationId_userId: { organizationId, userId: member.userId } } });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "REVOKE", entityType: "org_user", entityId: member.userId,
    summary: "Removed a team member's access",
  });
  res.json({ data: { deleted: true } });
});

export default router;
