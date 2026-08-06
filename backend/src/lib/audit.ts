import { prisma } from "../db";

// Fire-and-forget by design — an audit-log write failing should never break
// the actual request. Called from the mutation endpoints that matter:
// accounts, business partners, journal entries, user management,
// subscription changes.
export function logAudit(entry: {
  organizationId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string;
}) {
  prisma.auditLog
    .create({
      data: {
        organizationId: entry.organizationId ?? null,
        actorUserId: entry.actorUserId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        summary: entry.summary ?? null,
      },
    })
    .catch((err) => console.error("audit log write failed", err));
}
