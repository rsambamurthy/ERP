import jwt from "jsonwebtoken";

export interface AuthTokenPayload {
  userId: string;
  orgUserId: string; // OrgUser.id, not User.id — the row "who did this" audit fields actually reference
  organizationId: string;
  role: string;
}

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set.");
  return s;
}

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, secret(), { expiresIn: "12h" });
}

export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, secret()) as AuthTokenPayload;
}
