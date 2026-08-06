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

// GET /org/users — current members + pending invites, for the Team settings screen.
router.get("/", canManageUsers, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const members = await prisma.orgUser.findMany({
    where: { organizationId },
    include: { user: { select: { id: true, email: true, phone: true, isVerified: true } } },
  });

  const invites = await prisma.orgInvite.findMany({
    where: { organizationId, acceptedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    data: {
      members: members.map((m) => ({
        userId: m.userId, role: m.role, branchId: m.branchId,
        email: m.user.email, phone: m.user.phone, isVerified: m.user.isVerified,
      })),
      invites: invites.map((i) => ({ id: i.id, email: i.email, phone: i.phone, role: i.role, expiresAt: i.expiresAt })),
    },
  });
});

// POST /org/users/invite — OWNER/ADMIN only.
router.post("/invite", canManageUsers, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const { email, phone, role } = req.body ?? {};

  if ((!email && !phone) || !role) {
    return res.status(400).json({ message: "email or phone, and role, are required." });
  }
  if (!ORG_ROLES.includes(role)) {
    return res.status(400).json({ message: `role must be one of ${ORG_ROLES.join(", ")}.` });
  }

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
      organizationId, email: email ?? null, phone: phone ?? null, role,
      invitedBy: req.user!.userId,
      token,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "INVITE", entityType: "org_invite", entityId: invite.id,
    summary: `Invited ${email || phone} as ${role}`,
  });

  // Dev convenience: no email/SMS provider wired up yet, so hand back the
  // accept-invite link directly (same pattern as devOtp in /auth/register).
  const exposeInviteLink = process.env.EXPOSE_DEV_OTP !== "false";
  res.status(201).json({
    data: { id: invite.id, email: invite.email, phone: invite.phone, role: invite.role, expiresAt: invite.expiresAt },
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
  const { role } = req.body ?? {};

  if (!ORG_ROLES.includes(role)) {
    return res.status(400).json({ message: `role must be one of ${ORG_ROLES.join(", ")}.` });
  }

  const member = await prisma.orgUser.findUnique({
    where: { organizationId_userId: { organizationId, userId: req.params.userId } },
  });
  if (!member) return res.status(404).json({ message: "Team member not found." });
  if (member.role === "OWNER") return res.status(403).json({ message: "The owner's role can't be changed." });

  const updated = await prisma.orgUser.update({
    where: { organizationId_userId: { organizationId, userId: member.userId } },
    data: { role },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "org_user", entityId: member.userId,
    summary: `Changed a team member's role from ${member.role} to ${role}`,
  });
  res.json({ data: { userId: updated.userId, role: updated.role } });
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
