import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requireRole, editableRolesFor, scopeOrgId, ORG_ROLES } from "../middleware/auth";
import { logAudit } from "../lib/audit";

const router = Router();
router.use(authenticate);

const canConfigure = requireRole("OWNER", "ADMIN");

// A custom role's org_menu_config rows are keyed "custom:<org_roles.id>" —
// distinct from the four fixed role-name keys, stable across a rename
// (unlike keying by name), and readable by the same generic string-keyed
// map loadConfig() already builds. See migration_011's note on why the
// column had to widen for this.
function customRoleKey(id: string): string {
  return `custom:${id}`;
}

const FIXED_ROLE_LABELS: Record<string, string> = {
  OWNER: "Owner", ADMIN: "Admin", ACCOUNTANT: "Accountant", VIEWER: "Viewer",
};

type ConfigMap = Record<string, Record<string, boolean>>; // role -> itemId -> enabled

async function loadConfig(organizationId: string): Promise<ConfigMap> {
  const rows = await prisma.orgMenuConfig.findMany({ where: { organizationId } });
  const config: ConfigMap = {};
  for (const r of rows) {
    if (!config[r.role]) config[r.role] = {};
    config[r.role][r.itemId] = r.enabled;
  }
  return config;
}

// Every role this caller may configure the menu for, as {value, label}
// options — the four fixed roles editableRolesFor() already allows, plus
// every custom role the org has defined (always fully editable by
// OWNER/ADMIN; there's no self-lock concern for a custom role the way
// there is for "your own fixed role", since ADMIN/OWNER are never
// themselves a custom role).
async function editableRoleOptions(req: import("express").Request, organizationId: string) {
  const fixed = editableRolesFor(req).map((r) => ({ value: r, label: FIXED_ROLE_LABELS[r] ?? r, permissions: null as string[] | null }));
  const customRoles = await prisma.orgRole.findMany({ where: { organizationId }, orderBy: { name: "asc" } });
  const custom = customRoles.map((r) => ({ value: customRoleKey(r.id), label: r.name, permissions: r.permissions }));
  return [...fixed, ...custom];
}

// GET /access-control/menu — the caller's own org's full override map, every
// role included. Any authenticated org member reads this (not just
// OWNER/ADMIN) — AppShell needs it to filter the sidebar for whatever role
// the caller actually has. Same as SmartAppt's bare GET /system/menu-config.
router.get("/menu", async (req, res) => {
  if (!req.user?.organizationId) {
    return res.status(400).json({ message: "This account isn't a member of an organization." });
  }
  const data = await loadConfig(req.user.organizationId);
  res.json({ data });
});

// GET /access-control/menu/:organizationId — the configuration screen: full
// matrix plus which roles this caller is actually allowed to edit (the four
// fixed roles, minus OWNER and the caller's own role, plus every custom
// role the org has defined).
router.get("/menu/:organizationId", canConfigure, async (req, res) => {
  const organizationId = scopeOrgId(req);
  if (!organizationId) return res.status(400).json({ message: "organizationId is required." });

  const data = await loadConfig(organizationId);
  const editableRoles = await editableRoleOptions(req, organizationId);
  res.json({ data, organizationId, editableRoles, allRoles: ORG_ROLES });
});

// PUT /access-control/menu/:organizationId — replace this caller's editable
// roles' overrides wholesale. The frontend sends only the cells that depart
// from a role's default visibility for each item — fixed roles default from
// navGroups.ts's `roles` list, custom roles default from whether the role
// holds the item's `permission` — it owns that logic, so it's the only side
// that can tell what counts as a departure. Anything absent for an editable
// role is dropped, which is how "reset this role to defaults" works without
// a dedicated endpoint.
router.put("/menu/:organizationId", canConfigure, async (req, res) => {
  const organizationId = scopeOrgId(req);
  if (!organizationId) return res.status(400).json({ message: "organizationId is required." });

  const items = (req.body?.items ?? []) as Array<{ itemId: string; role: string; enabled: boolean }>;
  const editable = (await editableRoleOptions(req, organizationId)).map((o) => o.value);

  const rejected = items.find((i) => !editable.includes(i.role));
  if (rejected) {
    return res.status(403).json({ message: `You cannot change what the ${rejected.role} role sees.` });
  }

  await prisma.$transaction([
    // Only the roles this caller may touch are cleared, so an ADMIN's save
    // can't wipe overrides a platform admin set on OWNER.
    prisma.orgMenuConfig.deleteMany({ where: { organizationId, role: { in: editable } } }),
    ...(items.length
      ? [
          prisma.orgMenuConfig.createMany({
            data: items.map((i) => ({ organizationId, itemId: i.itemId, role: i.role, enabled: i.enabled })),
          }),
        ]
      : []),
  ]);

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "menu_config",
    summary: `Updated menu visibility permissions (${items.length} override${items.length === 1 ? "" : "s"})`,
  });

  const data = await loadConfig(organizationId);
  res.json({ data });
});

export default router;
