// MVP session storage. A real app would use an httpOnly cookie set by the
// backend; this keeps the registration wizard and dashboard/accounting
// screens simple to wire together for now.
const TOKEN_KEY = "smarterp_token";
const ORG_KEY = "smarterp_org";
const ROLE_KEY = "smarterp_role";
const ADMIN_KEY = "smarterp_admin";
const NAME_KEY = "smarterp_name";
const PERMISSIONS_KEY = "smarterp_permissions";
const CUSTOM_ROLE_ID_KEY = "smarterp_custom_role_id";
// Modules this org has had WITHDRAWN, from the login response. A DENY
// list, never an allow list - see backend/src/lib/entitlements.ts. An org
// with no org_modules rows at all (one provisioned before those rows were
// written) yields [], which hides nothing, which is the point.
const DENIED_MODULES_KEY = "smarterp_denied_modules";

export function setSession(
  token: string,
  organizationId: string | null,
  role?: string | null,
  isPlatformAdmin?: boolean,
  name?: string | null,
  permissions?: string[],
  customRoleId?: string | null,
  deniedModules?: string[]
) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
  if (organizationId) localStorage.setItem(ORG_KEY, organizationId);
  else localStorage.removeItem(ORG_KEY);
  if (role) localStorage.setItem(ROLE_KEY, role);
  else localStorage.removeItem(ROLE_KEY);
  if (name) localStorage.setItem(NAME_KEY, name);
  else localStorage.removeItem(NAME_KEY);
  localStorage.setItem(ADMIN_KEY, isPlatformAdmin ? "1" : "0");
  // Only meaningful for role === "CUSTOM" — a snapshot from login, used to
  // decide what the sidebar shows. Real enforcement is always server-side.
  localStorage.setItem(PERMISSIONS_KEY, JSON.stringify(permissions ?? []));
  // Which org_roles row, when role === "CUSTOM" — lets AppShell key into
  // the "custom:<id>" menu-config entries Access Control writes for this
  // specific custom role (see accessControl.ts's customRoleKey()).
  if (customRoleId) localStorage.setItem(CUSTOM_ROLE_ID_KEY, customRoleId);
  else localStorage.removeItem(CUSTOM_ROLE_ID_KEY);
  localStorage.setItem(DENIED_MODULES_KEY, JSON.stringify(deniedModules ?? []));
}

// Which modules the sidebar must stop offering. Defaults to [] on anything
// unreadable - a corrupt value should show too much, not lock somebody out
// of their own books. The API refuses what it must regardless.
export function getDeniedModules(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(DENIED_MODULES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((m) => typeof m === "string") : [];
  } catch {
    return [];
  }
}

export function getName(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(NAME_KEY);
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getOrganizationId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ORG_KEY);
}

export function getRole(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ROLE_KEY);
}

export function isPlatformAdmin(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(ADMIN_KEY) === "1";
}

export function getCustomRoleId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(CUSTOM_ROLE_ID_KEY);
}

// Only populated (and only meaningful) for role === "CUSTOM" — the
// permission list resolved at login time. See setSession()'s note.
export function getPermissions(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(PERMISSIONS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

// OWNER/ADMIN can manage the Chart of Accounts, business partners, and
// team. ACCOUNTANT can post transactions. VIEWER is read-only. A CUSTOM
// role falls back to its granted permissions. Mirrors the backend's
// requirePermission() gates — this is UI-only convenience (hide buttons the
// API would reject anyway), not the actual enforcement.
export function canManageCoa(): boolean {
  const role = getRole() ?? "";
  if (role === "CUSTOM") return getPermissions().includes("coa.manage");
  return ["OWNER", "ADMIN"].includes(role);
}
export function canPostTransactions(): boolean {
  const role = getRole() ?? "";
  if (role === "CUSTOM") {
    return getPermissions().some((p) => ["sales.post", "purchase.post", "inventory.post", "journal.post"].includes(p));
  }
  return ["OWNER", "ADMIN", "ACCOUNTANT"].includes(role);
}
export function canManageTeam(): boolean {
  return ["OWNER", "ADMIN"].includes(getRole() ?? "");
}
// Purchase Order approve/reject — Owner/Admin by default (see the
// separation-of-duties note on backend/src/lib/permissions.ts's
// BUILT_IN_PERMISSIONS.ACCOUNTANT: it deliberately excludes
// "purchase.approve"). A CUSTOM role needs it explicitly granted.
export function canApprovePurchaseOrders(): boolean {
  const role = getRole() ?? "";
  if (role === "CUSTOM") return getPermissions().includes("purchase.approve");
  return ["OWNER", "ADMIN"].includes(role);
}

export function canReceiveGoods(): boolean {
  const role = getRole() ?? "";
  if (role === "CUSTOM") return getPermissions().includes("purchase.receive");
  return ["OWNER", "ADMIN", "ACCOUNTANT"].includes(role);
}

// Sales Order approve/reject — the exact sales-side mirror of
// canApprovePurchaseOrders: Owner/Admin by default (separation of duties —
// see BUILT_IN_PERMISSIONS.ACCOUNTANT's deliberate exclusion of
// "sales.approve"). A CUSTOM role needs it explicitly granted.
export function canApproveSalesOrders(): boolean {
  const role = getRole() ?? "";
  if (role === "CUSTOM") return getPermissions().includes("sales.approve");
  return ["OWNER", "ADMIN"].includes(role);
}

export function canDeliverGoods(): boolean {
  const role = getRole() ?? "";
  if (role === "CUSTOM") return getPermissions().includes("sales.deliver");
  return ["OWNER", "ADMIN", "ACCOUNTANT"].includes(role);
}

// Data assistant (chatbot) — Owner/Admin by default (see
// BUILT_IN_PERMISSIONS.OWNER/ADMIN in backend/src/lib/permissions.ts, which
// both spread the full PERMISSIONS list). A CUSTOM role needs it explicitly
// granted; ACCOUNTANT/VIEWER don't get it by default.
export function canUseChatbot(): boolean {
  const role = getRole() ?? "";
  if (role === "CUSTOM") return getPermissions().includes("chatbot.access");
  return ["OWNER", "ADMIN"].includes(role);
}

// Vendor Management (Phase 1) reuses businessPartners.manage — same gate as
// the underlying create/edit/toggle Business Partner routes. Owner/Admin/
// Accountant get it by default (see BUILT_IN_PERMISSIONS.ACCOUNTANT); a
// CUSTOM role needs it explicitly granted. This is the placeholder a future
// generic Workflow/User Management module would take over.
export function canManageBusinessPartners(): boolean {
  const role = getRole() ?? "";
  if (role === "CUSTOM") return getPermissions().includes("businessPartners.manage");
  return ["OWNER", "ADMIN", "ACCOUNTANT"].includes(role);
}

// Mirrors the backend's requirePermission("items.manage") on the item
// create/edit/toggle/delete routes.
//
// NOT the same role set as canManageBusinessPartners above: ACCOUNTANT
// deliberately does not get "items.manage" by default — permissions.ts
// groups it with "coa.manage"/"company.manage" as master-data setup rather
// than day-to-day posting. An org that wants an accountant maintaining the
// item master grants it through a CUSTOM role.
export function canManageItems(): boolean {
  const role = getRole() ?? "";
  if (role === "CUSTOM") return getPermissions().includes("items.manage");
  return ["OWNER", "ADMIN"].includes(role);
}

export function clearSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ORG_KEY);
  localStorage.removeItem(ROLE_KEY);
  localStorage.removeItem(ADMIN_KEY);
  localStorage.removeItem(NAME_KEY);
  localStorage.removeItem(PERMISSIONS_KEY);
  localStorage.removeItem(CUSTOM_ROLE_ID_KEY);
}

export function isLoggedIn(): boolean {
  return !!getToken();
}
