import { OrgRole } from "./types";

// MVP session storage — plain localStorage, same simplification SmartERP
// frontend's lib/auth.ts uses (a real app would use an httpOnly cookie set
// by the backend). Project OS's JWT carries organizationId itself and
// every backend route scopes off req.user!.organizationId server-side, so
// — unlike SmartERP, which has a platform-admin concept that needs an
// explicit organizationId on some requests — this frontend never needs to
// store or pass one at all.
const TOKEN_KEY = "projectos_token";
const ROLE_KEY = "projectos_role";
const NAME_KEY = "projectos_name";
const EMAIL_KEY = "projectos_email";

export function setSession(token: string, role: string, name: string, email: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(ROLE_KEY, role);
  localStorage.setItem(NAME_KEY, name);
  localStorage.setItem(EMAIL_KEY, email);
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getRole(): OrgRole | null {
  if (typeof window === "undefined") return null;
  return (localStorage.getItem(ROLE_KEY) as OrgRole | null) ?? null;
}

export function getName(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(NAME_KEY);
}

export function getEmail(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(EMAIL_KEY);
}

export function clearSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ROLE_KEY);
  localStorage.removeItem(NAME_KEY);
  localStorage.removeItem(EMAIL_KEY);
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

// Role-gate helpers — UI-only convenience (hide buttons/nav items the API
// would reject anyway with a 403); the backend's requireRole(...) in
// project-os/backend/src/middleware/auth.ts is the real enforcement.
// SUPER_ADMIN bypasses every one of these on the backend too, so it's
// included in every allow-list here for consistency.

export function canManageProjects(): boolean {
  return ["SUPER_ADMIN", "PROJECT_MANAGER"].includes(getRole() ?? "");
}
export function canManageBoq(): boolean {
  return ["SUPER_ADMIN", "ESTIMATOR"].includes(getRole() ?? "");
}
export function canApproveBoqOrBudget(): boolean {
  return ["SUPER_ADMIN", "PROJECT_MANAGER"].includes(getRole() ?? "");
}
export function canManageProcurement(): boolean {
  return ["SUPER_ADMIN", "PROCUREMENT"].includes(getRole() ?? "");
}
export function canReceiveGoods(): boolean {
  return ["SUPER_ADMIN", "WAREHOUSE"].includes(getRole() ?? "");
}
// Matches the backend's requireRole("SUPER_ADMIN") on POST
// /integration/connection and /integration/sync — connecting to
// SmartERP and triggering a sync is an org-level admin action, not
// something every role should see or attempt.
export function canManageIntegration(): boolean {
  return getRole() === "SUPER_ADMIN";
}
