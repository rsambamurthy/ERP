import type {
  DomainDetailsMap,
  DomainType,
  OnboardingStatus,
  RegisterPayload,
  RegisterResponse,
} from "./types";

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
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
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
  return request<{ ok: true }>("/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({ organizationId, otp }),
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
