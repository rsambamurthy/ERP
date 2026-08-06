import jwt from "jsonwebtoken";

export interface AuthTokenPayload {
  userId: string;
  organizationId: string;
  role: string;
  branchId: string | null;
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
