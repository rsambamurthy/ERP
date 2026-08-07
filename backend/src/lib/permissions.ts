// Module-level permission catalogue for custom org roles (see
// migration_009_custom_roles.sql for why this list deliberately excludes
// team/role management and menu-visibility config).
export const PERMISSIONS = [
  "coa.manage",
  "items.manage",
  "businessPartners.manage",
  "sales.post",
  "purchase.post",
  "inventory.post",
  "journal.post",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "coa.manage": "Manage Chart of Accounts",
  "items.manage": "Manage Items",
  "businessPartners.manage": "Manage Business Partners (Customers/Vendors)",
  "sales.post": "Post Sales Invoices & Sales Returns",
  "purchase.post": "Post Purchase Bills & Purchase Returns",
  "inventory.post": "Post Stock Adjustments",
  "journal.post": "Post Journal Entries",
};

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

// Fixed permission sets for the four built-in roles — not stored in the DB,
// not editable via the custom-roles UI. Mirrors exactly what requireRole()
// checks enforced before requirePermission() replaced them, so this is a
// re-expression of existing behavior, not a behavior change.
const BUILT_IN_PERMISSIONS: Record<string, Permission[]> = {
  OWNER: [...PERMISSIONS],
  ADMIN: [...PERMISSIONS],
  ACCOUNTANT: ["businessPartners.manage", "sales.post", "purchase.post", "inventory.post", "journal.post"],
  VIEWER: [],
};

// Null return means "not a built-in role" — the caller should look up a
// custom role's stored permissions instead (role === "CUSTOM").
export function builtInPermissions(role: string): Permission[] | null {
  return BUILT_IN_PERMISSIONS[role] ?? null;
}
