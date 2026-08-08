import { Router } from "express";
import type { OrgUser, User } from "@prisma/client";
import { prisma } from "../db";
import { hashPassword, verifyPassword } from "../lib/password";
import { generateOtp, otpExpiry, sendOtp } from "../lib/otp";
import { signToken } from "../lib/jwt";
import { builtInPermissions, Permission } from "../lib/permissions";

const router = Router();

// email vs. phone identifier — same "@ means email" convention the frontend
// already uses (LoginPage's identifier field).
function identifierWhere(identifier: string) {
  return identifier.includes("@") ? { email: identifier } : { phone: identifier };
}

// Thrown by buildLoginResponse for a case the caller should turn straight
// into an HTTP error, without duplicating the platform-admin/isVerified/
// suspended checks at every one of the three routes that log someone in
// (POST /login, POST /mpin/verify, POST /mpin/set).
class LoginBlocked extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function buildLoginResponse(user: User & { orgUsers: OrgUser[] }) {
  // Platform admins aren't members of any organization — they don't need
  // isVerified (they never go through the OTP wizard) and route straight to
  // the /admin area on the frontend.
  if (user.isPlatformAdmin) {
    const token = signToken({
      userId: user.id, organizationId: null, role: null, customRoleId: null, branchId: null, isPlatformAdmin: true,
    });
    return { token, organizationId: null, role: null, isPlatformAdmin: true, name: user.name };
  }

  if (!user.isVerified) throw new LoginBlocked(403, "Account not verified yet — complete OTP verification first.");

  const orgUser = user.orgUsers[0];
  if (!orgUser) throw new LoginBlocked(409, "This account isn't linked to an organization.");
  if (orgUser.status === "SUSPENDED") throw new LoginBlocked(403, "Your access has been suspended. Contact your organization admin.");

  const token = signToken({
    userId: user.id, organizationId: orgUser.organizationId, role: orgUser.role,
    customRoleId: orgUser.customRoleId, branchId: orgUser.branchId, isPlatformAdmin: false,
  });
  const permissions = await resolvePermissions(orgUser.role, orgUser.customRoleId);

  return {
    token, organizationId: orgUser.organizationId, role: orgUser.role, isPlatformAdmin: false, name: user.name,
    permissions, customRoleId: orgUser.customRoleId,
  };
}

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

  res.json({ ok: true, token, permissions, customRoleId: orgUser?.customRoleId ?? null });
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

  try {
    res.json(await buildLoginResponse(user));
  } catch (err) {
    if (err instanceof LoginBlocked) return res.status(err.status).json({ message: err.message });
    throw err;
  }
});

// ── M-PIN login (SmartAppt Gold-style: phone/email → OTP first time → set a
// 4-digit M-PIN → phone/email + M-PIN for every login after that). Fully
// additive — POST /login above keeps working exactly as it did, for anyone
// who never sets an M-PIN. See migration_016's note on why the OTP step
// reuses resetOtpCode/resetOtpExpiresAt rather than new columns.

// GET /auth/mpin/status?identifier= — lets the login screen skip straight
// to the M-PIN box for a returning user instead of always starting at OTP.
router.get("/mpin/status", async (req, res) => {
  const identifier = String(req.query.identifier ?? "");
  if (!identifier) return res.status(400).json({ message: "identifier is required." });
  const user = await prisma.user.findFirst({ where: identifierWhere(identifier) });
  res.json({ data: { hasMpin: !!user?.mpinHash } });
});

// POST /auth/mpin/request-otp { identifier }
router.post("/mpin/request-otp", async (req, res) => {
  const { identifier } = req.body ?? {};
  if (!identifier) return res.status(400).json({ message: "identifier is required." });

  const user = await prisma.user.findFirst({ where: identifierWhere(identifier) });
  if (!user) return res.status(404).json({ message: "No account found for that email/phone — register a company first." });

  const otp = generateOtp();
  await prisma.user.update({ where: { id: user.id }, data: { resetOtpCode: otp, resetOtpExpiresAt: otpExpiry() } });
  sendOtp(identifier, otp);

  const exposeDevOtp = process.env.EXPOSE_DEV_OTP !== "false";
  res.json({ data: { sent: true, ...(exposeDevOtp ? { devOtp: otp } : {}) } });
});

// POST /auth/mpin/verify { identifier, mpin } — the normal returning-user
// login once an M-PIN is set.
router.post("/mpin/verify", async (req, res) => {
  const { identifier, mpin } = req.body ?? {};
  if (!identifier || !mpin) return res.status(400).json({ message: "identifier and mpin are required." });

  const user = await prisma.user.findFirst({ where: identifierWhere(identifier), include: { orgUsers: true } });
  if (!user?.mpinHash || !(await verifyPassword(mpin, user.mpinHash))) {
    return res.status(401).json({ message: "Incorrect M-PIN." });
  }

  try {
    res.json(await buildLoginResponse(user));
  } catch (err) {
    if (err instanceof LoginBlocked) return res.status(err.status).json({ message: err.message });
    throw err;
  }
});

// POST /auth/mpin/set { identifier, otp, mpin } — verify the OTP from
// /mpin/request-otp, store the new M-PIN, and log straight in. Covers both
// "first time setting an M-PIN" and "forgot M-PIN" — both are just "prove
// you control the phone/email, then set a new PIN," so there's no need for
// two separate endpoints the way SmartAppt Gold's mobile app has (set_mpin
// vs reset_mpin) — its split exists for its own token/session plumbing,
// which SmartERP's single-JWT model doesn't need.
router.post("/mpin/set", async (req, res) => {
  const { identifier, otp, mpin } = req.body ?? {};
  if (!identifier || !otp || !mpin) {
    return res.status(400).json({ message: "identifier, otp, and mpin are required." });
  }
  if (!/^\d{4}$/.test(mpin)) {
    return res.status(400).json({ message: "M-PIN must be exactly 4 digits." });
  }

  const user = await prisma.user.findFirst({ where: identifierWhere(identifier) });
  if (!user || !user.resetOtpCode || user.resetOtpCode !== otp) {
    return res.status(400).json({ message: "Incorrect or expired code." });
  }
  if (!user.resetOtpExpiresAt || user.resetOtpExpiresAt < new Date()) {
    return res.status(400).json({ message: "Incorrect or expired code." });
  }

  const mpinHash = await hashPassword(mpin);
  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    // Proving control of the phone/email via OTP here is exactly what the
    // registration wizard's own OTP step already establishes — if this
    // account somehow reached here without having gone through that yet,
    // this satisfies the same bar, rather than leaving isVerified stuck
    // false for a user who can clearly receive the OTP.
    data: { mpinHash, resetOtpCode: null, resetOtpExpiresAt: null, isVerified: true },
    include: { orgUsers: true },
  });

  try {
    res.json(await buildLoginResponse(updatedUser));
  } catch (err) {
    if (err instanceof LoginBlocked) return res.status(err.status).json({ message: err.message });
    throw err;
  }
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

  res.json({
    token: token2, organizationId: invite.organizationId, role: invite.role, name: user.name,
    permissions, customRoleId: invite.customRoleId,
  });
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
