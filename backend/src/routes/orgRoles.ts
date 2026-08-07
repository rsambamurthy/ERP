import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requireRole, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { PERMISSIONS, isPermission } from "../lib/permissions";

const router = Router();
router.use(authenticate);

// Defining/editing/deleting a custom role is OWNER/ADMIN-only — deliberately
// requireRole(), not requirePermission(). Handing this out via a grantable
// permission would let a custom role holder define a more powerful role and
// assign it to themselves (assigning roles is also OWNER/ADMIN-only, in
// orgUsers.ts, for the same reason). See migration_009's note.
const canManageRoles = requireRole("OWNER", "ADMIN");

const RESERVED_NAMES = new Set(["OWNER", "ADMIN", "ACCOUNTANT", "VIEWER", "CUSTOM"]);

function validatePermissions(input: unknown): { ok: true; permissions: string[] } | { ok: false; message: string } {
  if (!Array.isArray(input)) return { ok: false, message: "permissions must be an array." };
  const bad = input.find((p) => typeof p !== "string" || !isPermission(p));
  if (bad !== undefined) {
    return { ok: false, message: `Unknown permission: ${bad}. Must be one of ${PERMISSIONS.join(", ")}.` };
  }
  return { ok: true, permissions: Array.from(new Set(input as string[])) };
}

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

// GET /org-roles — the org's custom roles, plus the fixed permission
// catalogue (so the frontend can render checkboxes without hardcoding the
// list twice).
router.get("/", canManageRoles, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const roles = await prisma.orgRole.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
  });
  res.json({ data: roles, permissionCatalogue: PERMISSIONS });
});

// POST /org-roles — create a custom role.
router.post("/", canManageRoles, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const { name, permissions } = req.body ?? {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ message: "name is required." });
  }
  if (RESERVED_NAMES.has(name.trim().toUpperCase())) {
    return res.status(400).json({ message: `"${name}" is a built-in role name and can't be reused.` });
  }
  const validated = validatePermissions(permissions ?? []);
  if (!validated.ok) return res.status(400).json({ message: validated.message });

  const existing = await prisma.orgRole.findFirst({ where: { organizationId, name: name.trim() } });
  if (existing) return res.status(409).json({ message: "A role with that name already exists." });

  const role = await prisma.orgRole.create({
    data: { organizationId, name: name.trim(), permissions: validated.permissions },
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "CREATE", entityType: "org_role", entityId: role.id,
    summary: `Created role "${role.name}" (${validated.permissions.length} permission${validated.permissions.length === 1 ? "" : "s"})`,
  });

  res.status(201).json({ data: role });
});

// PATCH /org-roles/:id — rename and/or change permissions.
router.patch("/:id", canManageRoles, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const role = await prisma.orgRole.findFirst({ where: { id: req.params.id, organizationId } });
  if (!role) return res.status(404).json({ message: "Role not found." });

  const { name, permissions } = req.body ?? {};
  const data: { name?: string; permissions?: string[] } = {};

  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) return res.status(400).json({ message: "name must be non-empty." });
    if (RESERVED_NAMES.has(name.trim().toUpperCase())) {
      return res.status(400).json({ message: `"${name}" is a built-in role name and can't be reused.` });
    }
    const clash = await prisma.orgRole.findFirst({
      where: { organizationId, name: name.trim(), id: { not: role.id } },
    });
    if (clash) return res.status(409).json({ message: "A role with that name already exists." });
    data.name = name.trim();
  }
  if (permissions !== undefined) {
    const validated = validatePermissions(permissions);
    if (!validated.ok) return res.status(400).json({ message: validated.message });
    data.permissions = validated.permissions;
  }

  const updated = await prisma.orgRole.update({ where: { id: role.id }, data });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "org_role", entityId: role.id,
    summary: `Updated role "${role.name}"${data.name && data.name !== role.name ? ` (renamed to "${data.name}")` : ""}`,
  });

  res.json({ data: updated });
});

// DELETE /org-roles/:id — refuses if any member or pending invite still
// holds this role, same "can't delete what's in use" guard the rest of the
// app uses elsewhere (e.g. an Account with postings).
router.delete("/:id", canManageRoles, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const role = await prisma.orgRole.findFirst({ where: { id: req.params.id, organizationId } });
  if (!role) return res.status(404).json({ message: "Role not found." });

  const [memberCount, inviteCount] = await Promise.all([
    prisma.orgUser.count({ where: { customRoleId: role.id } }),
    prisma.orgInvite.count({ where: { customRoleId: role.id, acceptedAt: null } }),
  ]);
  if (memberCount > 0 || inviteCount > 0) {
    return res.status(409).json({
      message: `This role is assigned to ${memberCount} member${memberCount === 1 ? "" : "s"} and ${inviteCount} pending invite${inviteCount === 1 ? "" : "s"} — reassign them first.`,
    });
  }

  await prisma.orgRole.delete({ where: { id: role.id } });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "DELETE", entityType: "org_role", entityId: role.id,
    summary: `Deleted role "${role.name}"`,
  });

  res.json({ data: { deleted: true } });
});

export default router;
