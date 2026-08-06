// MVP session storage. A real app would use an httpOnly cookie set by the
// backend; this keeps the registration wizard and dashboard/accounting
// screens simple to wire together for now.
const TOKEN_KEY = "smarterp_token";
const ORG_KEY = "smarterp_org";

export function setSession(token: string, organizationId: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(ORG_KEY, organizationId);
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getOrganizationId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ORG_KEY);
}

export function clearSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ORG_KEY);
}

export function isLoggedIn(): boolean {
  return !!getToken();
}
