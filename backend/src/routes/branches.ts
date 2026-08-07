import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

const router = Router();
router.use(authenticate, requireActiveSubscription);

// Master-data management, same tier as coa.manage/items.manage — grantable
// to a custom role, unlike Team/Access Control (see migration_009's note
// on why those two stay hardcoded OWNER/ADMIN-only).
const canManageBranches = requirePermission("branches.manage");

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

function validateGstin(gstin: unknown): { ok: true; value: string | null } | { ok: false; message: string } {
  if (!gstin) return { ok: true, value: null };
  const cleaned = String(gstin).trim().toUpperCase();
  if (!GSTIN_RE.test(cleaned)) {
    return { ok: false, message: "GSTIN must be 15 characters in the standard format (e.g. 29ABCDE1234F1Z5)." };
  }
  return { ok: true, value: cleaned };
}

// stateCode (the 2-digit GST state code) is auto-filled from a GSTIN's
// first 2 characters when one is set, but stays independently editable —
// see migration_014's note on why (unregistered branches still have a
// state). An explicit stateCode in the request always wins over the
// GSTIN-derived one.
function resolveStateCode(stateCode: unknown, gstinValue: string | null): string | null | undefined {
  if (stateCode !== undefined) return stateCode ? String(stateCode).trim() : null;
  if (gstinValue) return gstinValue.slice(0, 2);
  return undefined;
}

// GET /branches — the caller's own org's branches (or, for a platform
// admin, whichever org ?organizationId= names). Open to any authenticated
// org member, same as the Chart of Accounts list — reads aren't gated,
// only writes are.
router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const branches = await prisma.branch.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: [{ isHeadOffice: "desc" }, { code: "asc" }],
  });
  res.json({ data: branches });
});

// POST /branches — add a location, any time (not domain-locked).
router.post("/", canManageBranches, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const { code, name, gstin, stateCode, phone, email, address, isHeadOffice } = req.body ?? {};

  if (!code || !name) {
    return res.status(400).json({ message: "code and name are required." });
  }
  const gstinResult = validateGstin(gstin);
  if (!gstinResult.ok) return res.status(400).json({ message: gstinResult.message });

  const existing = await prisma.branch.findFirst({ where: { organizationId, code, deletedAt: null } });
  if (existing) return res.status(409).json({ message: `Branch code ${code} already exists.` });

  const branch = await prisma.$transaction(async (tx) => {
    // At most one head office per org — making this one the head office
    // un-flags whichever branch had it before.
    if (isHeadOffice) {
      await tx.branch.updateMany({ where: { organizationId, isHeadOffice: true }, data: { isHeadOffice: false } });
    }
    return tx.branch.create({
      data: {
        organizationId, code, name,
        gstin: gstinResult.value, stateCode: resolveStateCode(stateCode, gstinResult.value) ?? null,
        phone: phone || null, email: email || null,
        address: address ?? undefined, isHeadOffice: !!isHeadOffice,
      },
    });
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "CREATE", entityType: "branch", entityId: branch.id,
    summary: `Created branch ${branch.code} — ${branch.name}`,
  });
  res.status(201).json({ data: branch });
});

// PATCH /branches/:id — edit any field, including reassigning head office.
router.patch("/:id", canManageBranches, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const branch = await prisma.branch.findFirst({ where: { id: req.params.id, organizationId, deletedAt: null } });
  if (!branch) return res.status(404).json({ message: "Branch not found." });

  const { code, name, gstin, stateCode, phone, email, address, isHeadOffice } = req.body ?? {};
  const data: Record<string, unknown> = {};

  if (code !== undefined) {
    if (!code) return res.status(400).json({ message: "code cannot be empty." });
    const clash = await prisma.branch.findFirst({
      where: { organizationId, code, deletedAt: null, id: { not: branch.id } },
    });
    if (clash) return res.status(409).json({ message: `Branch code ${code} already exists.` });
    data.code = code;
  }
  if (name !== undefined) {
    if (!name) return res.status(400).json({ message: "name cannot be empty." });
    data.name = name;
  }
  let gstinValue: string | null = branch.gstin;
  if (gstin !== undefined) {
    const gstinResult = validateGstin(gstin);
    if (!gstinResult.ok) return res.status(400).json({ message: gstinResult.message });
    data.gstin = gstinResult.value;
    gstinValue = gstinResult.value;
  }
  const resolvedStateCode = resolveStateCode(stateCode, gstin !== undefined ? gstinValue : null);
  if (resolvedStateCode !== undefined) data.stateCode = resolvedStateCode;
  if (phone !== undefined) data.phone = phone || null;
  if (email !== undefined) data.email = email || null;
  if (address !== undefined) data.address = address;

  const updated = await prisma.$transaction(async (tx) => {
    if (isHeadOffice !== undefined) {
      if (isHeadOffice) {
        await tx.branch.updateMany({
          where: { organizationId, isHeadOffice: true, id: { not: branch.id } },
          data: { isHeadOffice: false },
        });
      }
      data.isHeadOffice = !!isHeadOffice;
    }
    return tx.branch.update({ where: { id: branch.id }, data });
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "branch", entityId: branch.id,
    summary: `Updated branch ${updated.code} — ${updated.name}`,
  });
  res.json({ data: updated });
});

// PATCH /branches/:id/toggle — Active/Inactive (hide from pickers without
// losing history — same pattern as Chart of Accounts).
router.patch("/:id/toggle", canManageBranches, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const branch = await prisma.branch.findFirst({ where: { id: req.params.id, organizationId, deletedAt: null } });
  if (!branch) return res.status(404).json({ message: "Branch not found." });
  if (branch.isHeadOffice && branch.status === "ACTIVE") {
    return res.status(409).json({ message: "The head office branch can't be deactivated — reassign head office first." });
  }

  const updated = await prisma.branch.update({
    where: { id: branch.id },
    data: { status: branch.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "TOGGLE", entityType: "branch", entityId: branch.id,
    summary: `${updated.status === "ACTIVE" ? "Activated" : "Deactivated"} branch ${updated.code} — ${updated.name}`,
  });
  res.json({ data: updated });
});

// DELETE /branches/:id — only if nothing has ever been recorded there:
// no team member assigned, no journal entry, no stock movement. Every
// transactional document (Sales Invoice, Purchase Bill, Stock Adjustment,
// Sales/Purchase Return) always pairs a JournalEntry + StockMovement at
// the branch it posts to, so those two checks cover all of them.
router.delete("/:id", canManageBranches, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const branch = await prisma.branch.findFirst({ where: { id: req.params.id, organizationId, deletedAt: null } });
  if (!branch) return res.status(404).json({ message: "Branch not found." });
  if (branch.isHeadOffice) return res.status(409).json({ message: "The head office branch can't be deleted." });

  const [memberCount, journalCount, movementCount] = await Promise.all([
    prisma.orgUser.count({ where: { organizationId, branchId: branch.id } }),
    prisma.journalEntry.count({ where: { branchId: branch.id } }),
    prisma.stockMovement.count({ where: { branchId: branch.id } }),
  ]);
  if (memberCount > 0 || journalCount > 0 || movementCount > 0) {
    return res.status(409).json({ message: "This branch has team members or transactions and cannot be deleted — deactivate it instead." });
  }

  await prisma.branch.update({ where: { id: branch.id }, data: { deletedAt: new Date() } });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "DELETE", entityType: "branch", entityId: branch.id,
    summary: `Deleted branch ${branch.code} — ${branch.name}`,
  });
  res.json({ data: { deleted: true } });
});

export default router;
