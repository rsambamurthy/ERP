import { Router } from "express";
import { prisma } from "../db";
import { authenticate } from "../middleware/auth";
import { verifyPassword, hashPassword } from "../lib/password";
import { logAudit } from "../lib/audit";

const router = Router();
router.use(authenticate);

// GET /me — your own profile. Works for platform admins too (no orgUser row).
router.get("/", async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { id: true, name: true, email: true, phone: true, isPlatformAdmin: true, createdAt: true },
  });
  if (!user) return res.status(404).json({ message: "User not found." });
  res.json({ data: user });
});

// PATCH /me — update your own name/email/phone. Anyone can change their own
// name; email/phone changes are checked for uniqueness the same way
// register/invite already are.
router.patch("/", async (req, res) => {
  const current = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!current) return res.status(404).json({ message: "User not found." });

  const { name, email, phone } = req.body ?? {};
  const data: { name?: string; email?: string | null; phone?: string | null } = {};

  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) return res.status(400).json({ message: "name must be non-empty." });
    data.name = name.trim();
  }
  if (email !== undefined) {
    if (email) {
      const clash = await prisma.user.findFirst({ where: { email, id: { not: req.user!.userId } } });
      if (clash) return res.status(409).json({ message: "Another account already uses that email." });
    }
    data.email = email || null;
  }
  if (phone !== undefined) {
    if (phone) {
      const clash = await prisma.user.findFirst({ where: { phone, id: { not: req.user!.userId } } });
      if (clash) return res.status(409).json({ message: "Another account already uses that phone number." });
    }
    data.phone = phone || null;
  }

  // Checked against the row the update would produce, before writing
  // anything — register/invite both require at least one contact method,
  // profile edits shouldn't be able to leave an account with neither.
  const resultingEmail = data.email !== undefined ? data.email : current.email;
  const resultingPhone = data.phone !== undefined ? data.phone : current.phone;
  if (!resultingEmail && !resultingPhone) {
    return res.status(400).json({ message: "At least one of email or phone is required." });
  }

  const updated = await prisma.user.update({
    where: { id: req.user!.userId },
    data,
    select: { id: true, name: true, email: true, phone: true },
  });

  logAudit({
    organizationId: req.user!.organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "user_profile", entityId: req.user!.userId,
    summary: "Updated own profile",
  });

  res.json({ data: updated });
});

// POST /me/change-password — requires the current password. Distinct from
// /auth/reset-password (the logged-out "forgot password" OTP flow below).
router.post("/change-password", async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: "currentPassword and newPassword are required." });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ message: "New password must be at least 8 characters." });
  }

  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) return res.status(404).json({ message: "User not found." });

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) return res.status(401).json({ message: "Current password is incorrect." });

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });

  logAudit({
    organizationId: req.user!.organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "user_password", entityId: req.user!.userId,
    summary: "Changed own password",
  });

  res.json({ data: { ok: true } });
});

export default router;
