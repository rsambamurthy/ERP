import { Request, Response, NextFunction } from "express";
import { verifyToken, AuthTokenPayload } from "../lib/jwt";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthTokenPayload;
    }
  }
}

// Expects `Authorization: Bearer <token>` issued by POST /auth/login.
// Same shape as SmartERP's own middleware/auth.ts authenticate() — kept
// deliberately similar so the two codebases are easy to cross-reference,
// even though this is a fully separate app with its own users/orgs
// (PRD Section 13: one Project OS tenant per SmartERP tenant, separate
// logins in R1 — no SSO between them yet).
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

// Roles per PRD Section 10: SUPER_ADMIN, PROJECT_MANAGER, ESTIMATOR,
// PROCUREMENT, WAREHOUSE, SITE_ENGINEER. Any-of semantics.
// SUPER_ADMIN always passes, same "most-privileged role bypasses checks"
// convention SmartERP uses for its platform-admin flag.
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.role === "SUPER_ADMIN") return next();
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "You don't have permission to do that." });
    }
    next();
  };
}
