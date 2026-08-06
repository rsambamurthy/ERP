import jwt from "jsonwebtoken";

export interface AuthTokenPayload {
  userId: string;
  // Platform admins aren't a member of any organization.
  organizationId: string | null;
  role: string | null;
  branchId: string | null;
  isPlatformAdmin: boolean;
}

// MVP: shared secret from env. Rotate via JWT_SECRET in Railway if it ever
// leaks — every existing token invalidates immediately, which is fine at
// this stage (users just log in again).
const SECRET = process.env.JWT_SECRET || "dev-only-insecure-secret-change-me";

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: "30d" });
}

export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, SECRET) as AuthTokenPayload;
}
