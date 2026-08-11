import { Router } from "express";
import { randomBytes } from "crypto";
import { prisma } from "../db";
import { authenticate, requireRole, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";

// Issues/manages the API key an org's Project OS instance presents to
// routes/integrationApi.ts. Ordinary user-JWT auth (OWNER/ADMIN only —
// generating a service credential is a security-sensitive action, same
// tier of trust as anything else org-config-level) as opposed to
// integrationApi.ts's service-key auth.
const router = Router();
router.use(authenticate, requireActiveSubscription);

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

// POST /integration/connections — (re)generates this org's Project OS API
// key. Only one live key per org — calling this again revokes whatever
// existed before and issues a new one rather than allowing several. The
// raw key is only ever returned in this response; it isn't retrievable
// again afterwards (GET below only ever shows the last 4 characters),
// same "shown once" convention as any API token issuer.
router.post("/", requireRole("OWNER", "ADMIN"), async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const { label } = req.body ?? {};

  const apiKey = randomBytes(32).toString("hex");
  const connection = await prisma.integrationConnection.upsert({
    where: { organizationId },
    create: { organizationId, apiKey, label: label ?? "Project OS", createdBy: req.user!.userId },
    update: { apiKey, label: label ?? undefined, createdBy: req.user!.userId, revokedAt: null, lastUsedAt: null },
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "CREATE", entityType: "integration_connection", entityId: connection.id,
    summary: "Generated/rotated the Project OS integration API key",
  });
  res.status(201).json({ data: { id: connection.id, apiKey, label: connection.label, createdAt: connection.createdAt } });
});

router.get("/", requireRole("OWNER", "ADMIN"), async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const connection = await prisma.integrationConnection.findUnique({ where: { organizationId } });
  if (!connection) return res.json({ data: null });
  res.json({
    data: {
      id: connection.id, label: connection.label, createdAt: connection.createdAt,
      lastUsedAt: connection.lastUsedAt, revokedAt: connection.revokedAt,
      apiKeyLast4: connection.apiKey.slice(-4),
    },
  });
});

router.delete("/", requireRole("OWNER", "ADMIN"), async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const connection = await prisma.integrationConnection.findUnique({ where: { organizationId } });
  if (!connection) return res.status(404).json({ message: "No integration connection exists for this organization." });

  await prisma.integrationConnection.update({ where: { id: connection.id }, data: { revokedAt: new Date() } });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "integration_connection", entityId: connection.id,
    summary: "Revoked the Project OS integration API key",
  });
  res.json({ data: { revoked: true } });
});

export default router;
