// Module-level permission catalogue for custom org roles (see
// migration_009_custom_roles.sql for why this list deliberately excludes
// team/role management and menu-visibility config).
export const PERMISSIONS = [
  "coa.manage",
  "items.manage",
  "businessPartners.manage",
  "branches.manage",
  "sales.post",
  "purchase.post",
  "purchase.approve",
  "purchase.receive",
  "sales.approve",
  "sales.deliver",
  "inventory.post",
  "journal.post",
  "company.manage",
  "currency.manage",
  "chatbot.access",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "coa.manage": "Manage Chart of Accounts",
  "items.manage": "Manage Items",
  "businessPartners.manage": "Manage Business Partners (Customers/Vendors)",
  "branches.manage": "Manage Branches",
  "sales.post": "Create Sales Orders, post Sales Invoices & Sales Returns",
  "purchase.post": "Create Purchase Orders, post Purchase Bills & Purchase Returns",
  "purchase.approve": "Approve or reject Purchase Orders & Purchase Bills held for a price variance",
  "purchase.receive": "Raise Goods Receipt Notes (receive goods against a Purchase Order)",
  "sales.approve": "Approve or reject Sales Orders pending approval",
  "sales.deliver": "Raise Delivery Notes (dispatch goods against a Sales Order)",
  "inventory.post": "Post Stock Adjustments",
  "journal.post": "Post Journal Entries",
  "company.manage": "Manage Company Master Data (CIN, directors, auditors)",
  "currency.manage": "Manage Currency Master (effective-dated exchange rates)",
  "chatbot.access": "Use the data assistant (ask questions about the company's accounts, sales, purchases, and stock)",
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
  // Deliberately no "purchase.approve" here — separation of duties: the
  // same role that creates/posts Purchase Orders and Bills shouldn't also
  // approve them by default. Owner/Admin get it (via the spread above); an
  // org that wants an ACCOUNTANT-level approver can grant "purchase.approve"
  // to a custom role instead.
  // "purchase.receive" (raising a GRN) is operational, not a financial
  // control point like "purchase.approve" — ACCOUNTANT gets it by default,
  // same as purchase.post/inventory.post which it already had.
  // Sales side mirrors the purchase side exactly: "sales.approve"
  // deliberately excluded (same separation-of-duties reasoning as
  // "purchase.approve"), "sales.deliver" (raising a Delivery Note)
  // included (operational, same reasoning as "purchase.receive").
  // "currency.manage" also deliberately excluded — master data in the same
  // family as "coa.manage"/"items.manage"/"company.manage", none of which
  // ACCOUNTANT gets by default either.
  ACCOUNTANT: ["businessPartners.manage", "sales.post", "sales.deliver", "purchase.post", "purchase.receive", "inventory.post", "journal.post"],
  VIEWER: [],
};

// Null return means "not a built-in role" — the caller should look up a
// custom role's stored permissions instead (role === "CUSTOM").
export function builtInPermissions(role: string): Permission[] | null {
  return BUILT_IN_PERMISSIONS[role] ?? null;
}
