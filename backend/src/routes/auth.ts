import { Router } from "express";
import { prisma } from "../db";
import { hashPassword, verifyPassword } from "../lib/password";
import { generateOtp, otpExpiry, sendOtp } from "../lib/otp";
import { signToken } from "../lib/jwt";
import { builtInPermissions, Permission } from "../lib/permissions";

const router = Router();

// Resolves the permission list to hand back in the login/verify/accept
// response — built-in roles resolve locally, a "CUSTOM" role needs its
// org_roles row. The frontend stores this alongside role/name (see
// lib/auth.ts) purely to decide what to show in the sidebar; the backend
// re-checks the real thing on every write via requirePermission().
async function resolvePermissions(role: string | null, customRoleId: string | null): Promise<Permission[]> {
  if (!role) return [];
  const builtIn = builtInPermissions(role);
  if (builtIn !== null) return builtIn;
  if (role === "CUSTOM" && customRoleId) {
    const customRole = await prisma.orgRole.findUnique({ where: { id: customRoleId } });
    return (customRole?.permissions as Permission[] | undefined) ?? [];
  }
  return [];
}

// POST /auth/register — create user + org shell (status PENDING_VERIFICATION)
router.post("/register", async (req, res) => {
  const { businessName, name, email, phone, password } = req.body ?? {};
  if (!businessName || !name || !password || (!email && !phone)) {
    return res.status(400).json({
      message: "businessName, name, password, and at least one of email/phone are required.",
    });
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [email ? { email } : undefined, phone ? { phone } : undefined].filter(Boolean) as any },
  });
  if (existing) {
    return res.status(409).json({ message: "An account with that email or phone already exists." });
  }

  const passwordHash = await hashPassword(password);
  const otp = generateOtp();

  const result = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name: businessName, status: "PENDING_VERIFICATION" },
    });
    const user = await tx.user.create({
      data: { name, email: email || null, phone: phone || null, passwordHash },
    });
    await tx.orgUser.create({
      data: { organizationId: organization.id, userId: user.id, role: "OWNER" },
    });
    await tx.onboardingState.create({
      data: {
        organizationId: organization.id,
        step: "SIGNUP",
        otpCode: otp,
        otpExpiresAt: otpExpiry(),
      },
    });
    return { organization, user };
  });

  sendOtp(email || phone, otp);

  // Dev convenience: no email/SMS provider is wired up yet, so surface the
  // OTP directly in the response until a real provider is in place. Set
  // EXPOSE_DEV_OTP=false in Railway to turn this off (e.g. before going live).
  const exposeDevOtp = process.env.EXPOSE_DEV_OTP !== "false";

  res.status(201).json({
    organizationId: result.organization.id,
    userId: result.user.id,
    ...(exposeDevOtp ? { devOtp: otp } : {}),
  });
});

// POST /auth/verify-otp
router.post("/verify-otp", async (req, res) => {
  const { organizationId, otp } = req.body ?? {};
  if (!organizationId || !otp) {
    return res.status(400).json({ message: "organizationId and otp are required." });
  }

  const state = await prisma.onboardingState.findUnique({ where: { organizationId } });
  if (!state) return res.status(404).json({ message: "Organization not found." });
  if (!state.otpCode || state.otpCode !== otp) {
    return res.status(400).json({ message: "Incorrect OTP." });
  }
  if (!state.otpExpiresAt || state.otpExpiresAt < new Date()) {
    return res.status(400).json({ message: "OTP expired — request a new one." });
  }

  await prisma.$transaction([
    prisma.organization.update({
      where: { id: organizationId },
      data: { status: "PENDING_DOMAIN" },
    }),
    prisma.onboardingState.update({
      where: { organizationId },
      data: { step: "VERIFIED", otpCode: null, otpExpiresAt: null },
    }),
    prisma.user.updateMany({
      where: { orgUsers: { some: { organizationId } } },
      data: { isVerified: true },
    }),
  ]);

  // Log the owner straight in — the rest of the wizard (domain selection,
  // provisioning) and the dashboard/accounting screens that follow all need
  // an authenticated session.
  const orgUser = await prisma.orgUser.findFirst({ where: { organizationId } });
  const token = orgUser
    ? signToken({
        userId: orgUser.userId,
        organizationId,
        role: orgUser.role,
        customRoleId: orgUser.customRoleId,
        branchId: orgUser.branchId,
        isPlatformAdmin: false,
      })
    : null;
  const permissions = orgUser ? await resolvePermissions(orgUser.role, orgUser.customRoleId) : [];

  res.json({ ok: true, token, permissions });
});

// POST /auth/login — for returning users (registration already happened).
router.post("/login", async (req, res) => {
  const { email, phone, password } = req.body ?? {};
  if (!password || (!email && !phone)) {
    return res.status(400).json({ message: "password and email or phone are required." });
  }

  const user = await prisma.user.findFirst({
    where: { OR: [email ? { email } : undefined, phone ? { phone } : undefined].filter(Boolean) as any },
    include: { orgUsers: true },
  });
  if (!user) return res.status(401).json({ message: "Incorrect email/phone or password." });

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return res.status(401).json({ message: "Incorrect email/phone or password." });

  // Platform admins aren't members of any organization — they don't need
  // isVerified (they never go through the OTP wizard) and route straight to
  // the /admin area on the frontend.
  if (user.isPlatformAdmin) {
    const token = signToken({
      userId: user.id,
      organizationId: null,
      role: null,
      customRoleId: null,
      branchId: null,
      isPlatformAdmin: true,
    });
    return res.json({ token, organizationId: null, role: null, isPlatformAdmin: true, name: user.name });
  }

  if (!user.isVerified) {
    return res.status(403).json({ message: "Account not verified yet — complete OTP verification first." });
  }

  const orgUser = user.orgUsers[0];
  if (!orgUser) return res.status(409).json({ message: "This account isn't linked to an organization." });
  if (orgUser.status === "SUSPENDED") {
    return res.status(403).json({ message: "Your access has been suspended. Contact your organization admin." });
  }

  const token = signToken({
    userId: user.id,
    organizationId: orgUser.organizationId,
    role: orgUser.role,
    customRoleId: orgUser.customRoleId,
    branchId: orgUser.branchId,
    isPlatformAdmin: false,
  });
  const permissions = await resolvePermissions(orgUser.role, orgUser.customRoleId);

  res.json({
    token, organizationId: orgUser.organizationId, role: orgUser.role, isPlatformAdmin: false, name: user.name,
    permissions,
  });
});

// POST /auth/accept-invite — the link an invited teammate gets. Creates
// their login and org membership in one step.
router.post("/accept-invite", async (req, res) => {
  const { token, name, password } = req.body ?? {};
  if (!token || !name || !password) {
    return res.status(400).json({ message: "token, name, and password are required." });
  }

  const invite = await prisma.orgInvite.findUnique({ where: { token } });
  if (!invite) return res.status(404).json({ message: "Invite not found." });
  if (invite.acceptedAt) return res.status(409).json({ message: "This invite has already been used." });
  if (invite.expiresAt < new Date()) return res.status(410).json({ message: "This invite has expired — ask for a new one." });

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [invite.email ? { email: invite.email } : undefined, invite.phone ? { phone: invite.phone } : undefined].filter(Boolean) as any,
    },
  });

  if (existingUser) {
    const alreadyMember = await prisma.orgUser.findUnique({
      where: { organizationId_userId: { organizationId: invite.organizationId, userId: existingUser.id } },
    });
    if (alreadyMember) {
      return res.status(409).json({ message: "This person is already part of the organization." });
    }
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.$transaction(async (tx) => {
    const u = existingUser
      ? (existingUser.name ? existingUser : await tx.user.update({ where: { id: existingUser.id }, data: { name } }))
      : await tx.user.create({
          data: { name, email: invite.email, phone: invite.phone, passwordHash, isVerified: true },
        });
    await tx.orgUser.create({
      data: {
        organizationId: invite.organizationId, userId: u.id,
        role: invite.role, customRoleId: invite.customRoleId,
      },
    });
    await tx.orgInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    return u;
  });

  const token2 = signToken({
    userId: user.id,
    organizationId: invite.organizationId,
    role: invite.role,
    customRoleId: invite.customRoleId,
    branchId: null,
    isPlatformAdmin: false,
  });
  const permissions = await resolvePermissions(invite.role, invite.customRoleId);

  res.json({ token: token2, organizationId: invite.organizationId, role: invite.role, name: user.name, permissions });
});

// POST /auth/forgot-password — logged-out password reset, step 1. Always
// returns the same generic message regardless of whether the account
// exists, so this can't be used to enumerate registered emails/phones (the
// OTP itself is only ever generated/sent — or exposed as devOtp — when a
// matching account is actually found).
router.post("/forgot-password", async (req, res) => {
  const { email, phone } = req.body ?? {};
  if (!email && !phone) return res.status(400).json({ message: "email or phone is required." });

  const user = await prisma.user.findFirst({
    where: { OR: [email ? { email } : undefined, phone ? { phone } : undefined].filter(Boolean) as any },
  });

  const exposeDevOtp = process.env.EXPOSE_DEV_OTP !== "false";
  let devOtp: string | undefined;

  if (user) {
    const otp = generateOtp();
    await prisma.user.update({
      where: { id: user.id },
      data: { resetOtpCode: otp, resetOtpExpiresAt: otpExpiry() },
    });
    sendOtp(email || phone, otp);
    if (exposeDevOtp) devOtp = otp;
  }

  res.json({
    message: "If an account exists, a reset code has been sent.",
    ...(devOtp ? { devOtp } : {}),
  });
});

// POST /auth/reset-password — logged-out password reset, step 2.
router.post("/reset-password", async (req, res) => {
  const { email, phone, otp, newPassword } = req.body ?? {};
  if ((!email && !phone) || !otp || !newPassword) {
    return res.status(400).json({ message: "email or phone, otp, and newPassword are required." });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ message: "New password must be at least 8 characters." });
  }

  const user = await prisma.user.findFirst({
    where: { OR: [email ? { email } : undefined, phone ? { phone } : undefined].filter(Boolean) as any },
  });
  if (!user || !user.resetOtpCode || user.resetOtpCode !== otp) {
    return res.status(400).json({ message: "Incorrect or expired code." });
  }
  if (!user.resetOtpExpiresAt || user.resetOtpExpiresAt < new Date()) {
    return res.status(400).json({ message: "Incorrect or expired code." });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(newPassword),
      resetOtpCode: null,
      resetOtpExpiresAt: null,
    },
  });

  res.json({ data: { ok: true } });
});

export default router;
