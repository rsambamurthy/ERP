// MVP session storage. A real app would use an httpOnly cookie set by the
// backend; this keeps the registration wizard and dashboard/accounting
// screens simple to wire together for now.
const TOKEN_KEY = "smarterp_token";
const ORG_KEY = "smarterp_org";
const ROLE_KEY = "smarterp_role";
const ADMIN_KEY = "smarterp_admin";
const NAME_KEY = "smarterp_name";

export function setSession(
  token: string,
  organizationId: string | null,
  role?: string | null,
  isPlatformAdmin?: boolean,
  name?: string | null
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

// OWNER/ADMIN can manage the Chart of Accounts, business partners, and
// team. ACCOUNTANT can post transactions. VIEWER is read-only. Mirrors the
// backend's requireRole() gates — this is UI-only convenience (hide buttons
// the API would reject anyway), not the actual enforcement.
export function canManageCoa(): boolean {
  return ["OWNER", "ADMIN"].includes(getRole() ?? "");
}
export function canPostTransactions(): boolean {
  return ["OWNER", "ADMIN", "ACCOUNTANT"].includes(getRole() ?? "");
}
export function canManageTeam(): boolean {
  return ["OWNER", "ADMIN"].includes(getRole() ?? "");
}

export function clearSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ORG_KEY);
  localStorage.removeItem(ROLE_KEY);
  localStorage.removeItem(ADMIN_KEY);
  localStorage.removeItem(NAME_KEY);
}

export function isLoggedIn(): boolean {
  return !!getToken();
}
