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

export function setSession(
  token: string,
  organizationId: string | null,
  role?: string | null,
  isPlatformAdmin?: boolean,
  name?: string | null,
  permissions?: string[],
  customRoleId?: string | null
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
