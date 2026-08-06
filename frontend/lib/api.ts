import type {
  Account,
  BusinessPartner,
  DomainDetailsMap,
  DomainType,
  JournalEntry,
  JournalLineInput,
  LedgerResponse,
  OnboardingStatus,
  RegisterPayload,
  RegisterResponse,
  TrialBalanceResponse,
} from "./types";
import { getToken } from "./auth";

// Points at the Railway-hosted backend. Set NEXT_PUBLIC_API_URL in Vercel's
// project env vars once the backend from registration_schema_v2.sql exists
// and implements the endpoints in section 7 of the design spec.
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  const token = getToken();
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(
      "Could not reach the backend. Is NEXT_PUBLIC_API_URL set and the API running?"
    );
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message ?? `Request failed (${res.status})`, res.status);
  }
  return res.json() as Promise<T>;
}

// POST /auth/register
export function registerUser(payload: RegisterPayload) {
  return request<RegisterResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// POST /auth/verify-otp
export function verifyOtp(organizationId: string, otp: string) {
  return request<{ ok: true; token: string | null }>("/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({ organizationId, otp }),
  });
}

// POST /auth/login
export function login(payload: { email?: string; phone?: string; password: string }) {
  return request<{ token: string; organizationId: string; role: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// GET /domain-types
export function getDomainTypes() {
  return request<DomainType[]>("/domain-types");
}

// POST /onboarding/domain — upserts one or more domains for the org
export function submitDomains(organizationId: string, domains: DomainDetailsMap) {
  return request<{ ok: true }>("/onboarding/domain", {
    method: "POST",
    body: JSON.stringify({ organizationId, domains }),
  });
}

// POST /onboarding/provision
export function provisionWorkspace(organizationId: string) {
  return request<{ ok: true }>("/onboarding/provision", {
    method: "POST",
    body: JSON.stringify({ organizationId }),
  });
}

// GET /onboarding/status
export function getOnboardingStatus(organizationId: string) {
  return request<OnboardingStatus>(
    `/onboarding/status?organizationId=${encodeURIComponent(organizationId)}`
  );
}

// ── Chart of Accounts ────────────────────────────────────────────────────────

export function getAccounts() {
  return request<{ data: Account[] }>("/accounts");
}

export function createAccount(body: Partial<Account>) {
  return request<{ data: Account }>("/accounts", { method: "POST", body: JSON.stringify(body) });
}

export function updateAccount(id: string, body: Partial<Account>) {
  return request<{ data: Account }>(`/accounts/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function toggleAccount(id: string) {
  return request<{ data: Account }>(`/accounts/${id}/toggle`, { method: "PATCH" });
}

export function deleteAccount(id: string) {
  return request<{ data: { deleted: true } }>(`/accounts/${id}`, { method: "DELETE" });
}

// ── Business Partners ────────────────────────────────────────────────────────

export function getBusinessPartners(bpType?: "CUSTOMER" | "VENDOR") {
  return request<{ data: BusinessPartner[] }>(
    `/business-partners${bpType ? `?bpType=${bpType}` : ""}`
  );
}

export function createBusinessPartner(body: Partial<BusinessPartner>) {
  return request<{ data: BusinessPartner }>("/business-partners", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateBusinessPartner(id: string, body: Partial<BusinessPartner>) {
  return request<{ data: BusinessPartner }>(`/business-partners/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function toggleBusinessPartner(id: string) {
  return request<{ data: BusinessPartner }>(`/business-partners/${id}/toggle`, { method: "PATCH" });
}

export function deleteBusinessPartner(id: string) {
  return request<{ data: { deleted: true } }>(`/business-partners/${id}`, { method: "DELETE" });
}

// ── Journal Entries / Ledger / Trial Balance ────────────────────────────────

// URLSearchParams stringifies `undefined` as the literal text "undefined",
// which the backend would then read as a truthy filter — strip those first.
function cleanParams(params?: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

export function getJournalEntries(params?: { from?: string; to?: string }) {
  const qs = new URLSearchParams(cleanParams(params)).toString();
  return request<{ data: JournalEntry[] }>(`/journal${qs ? `?${qs}` : ""}`);
}

export function createJournalEntry(body: {
  entryDate: string;
  narration: string;
  voucherType?: "BV" | "CV" | "JV";
  lines: JournalLineInput[];
}) {
  return request<{ data: JournalEntry }>("/journal", { method: "POST", body: JSON.stringify(body) });
}

export function getLedger(params: { accountId: string; businessPartnerId?: string; from?: string; to?: string }) {
  const qs = new URLSearchParams(cleanParams(params)).toString();
  return request<{ data: LedgerResponse }>(`/journal/ledger?${qs}`);
}

export function getTrialBalance(params?: { asOf?: string }) {
  const qs = new URLSearchParams(cleanParams(params)).toString();
  return request<{ data: TrialBalanceResponse }>(`/journal/trial-balance${qs ? `?${qs}` : ""}`);
}
