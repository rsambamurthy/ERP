import { Request, Response, NextFunction } from "express";
import { prisma } from "../db";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      serviceOrgId?: string;
    }
  }
}

// Service-to-service auth for the /integration/* routes (routes/integrationApi.ts)
// — Project OS (or any future external system) presents a per-organization
// API key via the X-Api-Key header, generated through POST
// /integration/connections (a normal user-authenticated route, OWNER/ADMIN
// only — see routes/integrationConnections.ts). This is deliberately
// separate from middleware/auth.ts's `authenticate`: there's no logged-in
// user or org role on these requests, just an org-scoped machine
// credential, so the organization is resolved from the key itself rather
// than a JWT payload.
export async function authenticateServiceKey(req: Request, res: Response, next: NextFunction) {
  const key = req.header("X-Api-Key");
  if (!key) {
    return res.status(401).json({ message: "Missing X-Api-Key header." });
  }

  const connection = await prisma.integrationConnection.findUnique({ where: { apiKey: key } });
  if (!connection || connection.revokedAt) {
    return res.status(401).json({ message: "Invalid or revoked API key." });
  }

  req.serviceOrgId = connection.organizationId;
  // Best-effort, not awaited — a failed timestamp update shouldn't block
  // the actual request, same fire-and-forget convention as lib/audit.ts.
  prisma.integrationConnection
    .update({ where: { id: connection.id }, data: { lastUsedAt: new Date() } })
    .catch((err) => console.error("integration connection lastUsedAt update failed", err));

  next();
}
