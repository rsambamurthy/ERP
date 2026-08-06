import { Request, Response, NextFunction } from "express";
import { verifyToken, AuthTokenPayload } from "../lib/jwt";
import { prisma } from "../db";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthTokenPayload;
    }
  }
}

// Applies to every accounting route. Expects `Authorization: Bearer <token>`
// issued by /auth/login or /auth/verify-otp.
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ message: "Missing or invalid Authorization header." });
  }
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired session — please log in again." });
  }
}

// Org roles, from most to least privileged:
//   OWNER      — everything, including inviting/removing users. One per org,
//                set at registration, can't be demoted or removed via the UI.
//   ADMIN      — same as OWNER except can't touch the OWNER's own access.
//   ACCOUNTANT — can post journal entries and manage business partners, but
//                not restructure the Chart of Accounts or manage users.
//   VIEWER     — read-only.
//
// A platform admin bypasses every one of these checks, everywhere — same
// pattern as SmartAppt's SUPER_USER in middleware/rbac.ts ("SUPER_USER
// bypasses all role restrictions"). It isn't a member of any org, but once
// it's targeting one (via resolveOrgId), it has the same authority any
// role in that org would have.
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.isPlatformAdmin) return next();
    if (!req.user || !req.user.role || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "You don't have permission to do that." });
    }
    next();
  };
}

// Platform-operator routes (/admin/*) — not a member of any organization,
// so this checks the flag on the token instead of an org role.
export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !req.user.isPlatformAdmin) {
    return res.status(403).json({ message: "Platform admin access required." });
  }
  next();
}

// Gives the platform-admin "manage subscriptions" toggle actual teeth —
// a SUSPENDED org's accounting endpoints stop working (reads included) until
// a platform admin flips it back. Platform admins themselves are exempt —
// same as SmartAppt's entitlement.service.ts: "SUPER_USER is exempt: they
// administer every association" and always resolve to FULL access.
export async function requireActiveSubscription(req: Request, res: Response, next: NextFunction) {
  if (req.user?.isPlatformAdmin) return next();
  if (!req.user?.organizationId) return next();
  const org = await prisma.organization.findUnique({
    where: { id: req.user.organizationId },
    select: { subscriptionStatus: true },
  });
  if (org?.subscriptionStatus === "SUSPENDED") {
    return res.status(402).json({ message: "This organization's subscription is suspended. Contact support." });
  }
  next();
}

// Every data-scoped route (accounts, business partners, journal, org users)
// normally operates on the caller's own organizationId. A platform admin
// isn't scoped to any org, so it targets one explicitly via
// ?organizationId=<id> (GET/DELETE) or organizationId in the body
// (POST/PATCH) — the same shape as SmartAppt's admin console passing
// ?association_id= into the ordinary units/users endpoints, rather than a
// separate parallel "admin view" of the data.
export function resolveOrgId(req: Request): string | null {
  if (req.user?.isPlatformAdmin) {
    const fromQuery = typeof req.query.organizationId === "string" ? req.query.organizationId : null;
    const fromBody = req.body && typeof req.body.organizationId === "string" ? req.body.organizationId : null;
    return fromQuery || fromBody || null;
  }
  return req.user?.organizationId ?? null;
}
