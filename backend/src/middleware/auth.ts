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
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
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
// a platform admin flips it back.
export async function requireActiveSubscription(req: Request, res: Response, next: NextFunction) {
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
