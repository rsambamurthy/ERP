import crypto from "crypto";
import { Router } from "express";
import type { OrgUser, User } from "@prisma/client";
import { prisma } from "../db";
import { hashPassword, verifyPassword } from "../lib/password";
import { generateOtp, otpExpiry, sendOtp } from "../lib/otp";
import { signToken } from "../lib/jwt";
import { builtInPermissions, Permission } from "../lib/permissions";
import { deniedModuleCodes } from "../lib/entitlements";
import { applyDomainSelection, DomainSelectionError, provisionOrganization } from "../lib/provisioning";

// 24h — the window a signup has to click the verification link before the
// PendingRegistration is treated as expired and a fresh /register call is
// needed to get a new one. Confirmed with the user as an acceptable expiry.
const PENDING_REGISTRATION_TTL_MS = 24 * 60 * 60 * 1000;

function generateVerificationToken() {
  // 32 random bytes -> 64 hex chars, matching pending_registrations.token
  // VARCHAR(64). Unguessable (256 bits of entropy) since this token alone —
  // no password, no OTP — is what proves the email inbox was reached.
  return crypto.randomBytes(32).toString("hex");
}

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
  // Modules this organisation has had WITHDRAWN — a deny list, never an
  // allow list. See lib/entitlements.ts for why round that way. The sidebar
  // uses it to stop offering screens the organisation no longer subscribes
  // to; requireModule() is what actually refuses them, exactly as
  // `permissions` above is a snapshot for the sidebar and requirePermission()
  // is the enforcement.
  //
  // A SNAPSHOT, like permissions: cancelling a module while somebody is
  // logged in does not change their menu until they next log in. The API
  // refuses them from the moment it is cancelled, so the worst case is a
  // menu item that returns a clear 402 rather than a screen they should not
  // have reached.
  const deniedModules = await deniedModuleCodes(orgUser.organizationId);

  return {
    token, organizationId: orgUser.organizationId, role: orgUser.role, isPlatformAdmin: false, name: user.name,
    permissions, customRoleId: orgUser.customRoleId, deniedModules,
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

// Looks up the (single) OWNER user created for an organization, with the
// orgUsers include buildLoginResponse needs. Used by /verify-email for both
// the first-click and the idempotent-replay path below.
async function userForOrganization(organizationId: string) {
  const orgUser = await prisma.orgUser.findFirst({ where: { organizationId } });
  if (!orgUser) return null;
  return prisma.user.findUnique({ where: { id: orgUser.userId }, include: { orgUsers: true } });
}

// POST /auth/register — stage a signup as a PendingRegistration. No
// Organization/User row is created here — that only happens once the
// emailed verification link is clicked (POST /auth/verify-email) after
// domain selection (POST /onboarding/domain). Both email and phone are
// mandatory: email because the verification link has to go somewhere,
// phone because the user asked for it to be required contact info even
// though nothing is ever sent to it (no SMS gateway) or verified against
// it — it's a plain mandatory field, not a second verification channel.
router.post("/register", async (req, res) => {
  const { businessName, name, email, phone, password, confirmPassword } = req.body ?? {};
  if (!businessName || !name || !email || !phone || !password) {
    return res.status(400).json({
      message: "businessName, name, email, phone, and password are required.",
    });
  }
  if (confirmPassword !== undefined && password !== confirmPassword) {
    return res.status(400).json({ message: "Password and confirm password do not match." });
  }
  if (password.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters." });
  }

  const existingUser = await prisma.user.findFirst({
    where: { OR: [{ email }, { phone }] },
  });
  if (existingUser) {
    return res.status(409).json({ message: "An account with that email or phone already exists." });
  }

  const passwordHash = await hashPassword(password);
  const token = generateVerificationToken();
  const expiresAt = new Date(Date.now() + PENDING_REGISTRATION_TTL_MS);

  // A signup that never finished (or never checked their inbox) may retry
  // with the same email — invalidate their earlier unconsumed link rather
  // than leaving two live tokens for the same address, then issue this
  // fresh one.
  await prisma.pendingRegistration.deleteMany({
    where: { email, consumedAt: null },
  });

  const pending = await prisma.pendingRegistration.create({
    data: { businessName, name, email, phone, passwordHash, token, expiresAt },
  });

  res.status(201).json({ pendingRegistrationId: pending.id });
});

// POST /auth/verify-email — click-through target for the link sent by
// POST /onboarding/domain. Creates the real Organization/User/OrgUser rows
// from the staged PendingRegistration, applies the domain selection it
// staged, runs provisionOrganization(), and logs the new owner straight in.
// Idempotent: a second hit on the same token (double-click, an email
// client's link-prefetch, the user going back) finds consumedAt already set
// and just re-derives the same login response from createdOrganizationId
// instead of erroring or provisioning twice.
router.post("/verify-email", async (req, res) => {
  const { token } = req.body ?? {};
  if (!token) return res.status(400).json({ message: "token is required." });

  const pending = await prisma.pendingRegistration.findUnique({ where: { token } });
  if (!pending) return res.status(404).json({ message: "Verification link not found." });

  if (pending.consumedAt) {
    if (!pending.createdOrganizationId) {
      return res.status(409).json({ message: "This link has already been used." });
    }
    const user = await userForOrganization(pending.createdOrganizationId);
    if (!user) return res.status(409).json({ message: "This link has already been used." });
    try {
      return res.json(await buildLoginResponse(user));
    } catch (err) {
      if (err instanceof LoginBlocked) return res.status(err.status).json({ message: err.message });
      throw err;
    }
  }

  if (pending.expiresAt < new Date()) {
    return res.status(410).json({ message: "This verification link has expired — please sign up again." });
  }

  const domains = pending.domains as Record<string, unknown>;
  if (!domains || Object.keys(domains).length === 0) {
    return res.status(400).json({ message: "Domain selection is incomplete — please sign up again." });
  }

  const { organization } = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name: pending.businessName, status: "PENDING_DOMAIN" },
    });
    const user = await tx.user.create({
      data: {
        name: pending.name, email: pending.email, phone: pending.phone,
        passwordHash: pending.passwordHash, isVerified: true,
      },
    });
    await tx.orgUser.create({
      data: { organizationId: organization.id, userId: user.id, role: "OWNER" },
    });
    await tx.onboardingState.create({
      data: { organizationId: organization.id, step: "VERIFIED" },
    });
    await tx.pendingRegistration.update({
      where: { id: pending.id },
      data: { consumedAt: new Date(), createdOrganizationId: organization.id },
    });
    return { organization, user };
  });

  try {
    await applyDomainSelection(organization.id, domains);
    await provisionOrganization(organization.id);
  } catch (err) {
    // The organization/user/token bookkeeping above already committed, so
    // this isn't retried automatically — logged for follow-up, and the
    // owner still gets a working (if unprovisioned) login below rather than
    // a dead-end error after their link is already spent.
    console.error("[verify-email] domain/provisioning step failed:", err instanceof DomainSelectionError ? err.message : err);
  }

  const user = await userForOrganization(organization.id);
  if (!user) return res.status(500).json({ message: "Verification succeeded but sign-in failed — try logging in." });

  try {
    res.json(await buildLoginResponse(user));
  } catch (err) {
    if (err instanceof LoginBlocked) return res.status(err.status).json({ message: err.message });
    throw err;
  }
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
// their login and org membership in one step. `mpin` is optional — when
// given, it's set straight away with no separate OTP round-trip: the
// invite token itself (unguessable, sent by an OWNER/ADMIN who already
// knows this person) is the proof of identity that the M-PIN OTP step
// exists to establish elsewhere (see /mpin/set above) — SmartERP is
// invite-only today, there's no open self-registration path this could
// leak into. Only takes effect "first time" — an existingUser who already
// has an mpinHash keeps it; accept-invite never overwrites one.
router.post("/accept-invite", async (req, res) => {
  const { token, name, password, mpin } = req.body ?? {};
  if (!token || !name || !password) {
    return res.status(400).json({ message: "token, name, and password are required." });
  }
  if (mpin && !/^\d{4}$/.test(mpin)) {
    return res.status(400).json({ message: "M-PIN must be exactly 4 digits." });
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
  const mpinHash = mpin ? await hashPassword(mpin) : null;

  const user = await prisma.$transaction(async (tx) => {
    let u;
    if (existingUser) {
      const patch: { name?: string; mpinHash?: string } = {};
      if (!existingUser.name) patch.name = name;
      if (mpinHash && !existingUser.mpinHash) patch.mpinHash = mpinHash;
      u = Object.keys(patch).length > 0
        ? await tx.user.update({ where: { id: existingUser.id }, data: patch })
        : existingUser;
    } else {
      u = await tx.user.create({
        data: {
          name, email: invite.email, phone: invite.phone, passwordHash, isVerified: true,
          ...(mpinHash ? { mpinHash } : {}),
        },
      });
    }
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
