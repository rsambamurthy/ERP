import type {
  ApiItemResponse,
  ApiListResponse,
  Boq,
  BoqImportPreviewRow,
  BoqLine,
  Budget,
  CostCategory,
  Estimate,
  LoginResponse,
  Project,
  ProjectSite,
  RegisterPayload,
  RegisterResponse,
  SmartErpConnectionStatus,
  SyncedBusinessPartner,
  SyncedItem,
  SyncResult,
} from "./types";
import { getToken } from "./auth";

// Points at project-os/backend (NOT SmartERP's own backend — a separate
// app, separate API, separate database). See .env.example.
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";

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
    throw new ApiError("Could not reach Project OS's backend. Is NEXT_PUBLIC_API_URL set and the API running?");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message ?? `Request failed (${res.status})`, res.status);
  }
  return res.json() as Promise<T>;
}

// Real file downloads (not JSON) bypass request<T>() the same way
// SmartERP frontend's own downloadFile() does — and for the same reason
// that fix was needed here: a plain <a href> pointing at a route behind
// authenticate() never sends the Bearer token (browsers don't attach
// custom headers to link navigations), so it silently 401s. Fetching
// with the header, then turning the response into a Blob and clicking a
// throwaway <a download> on an object URL, is the fix.
async function downloadFile(path: string, filename: string): Promise<void> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    throw new ApiError("Could not reach Project OS's backend to download the file.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message ?? `Could not download the file (${res.status}).`, res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Auth ──────────────────────────────────────────────────────────────

export function registerOrg(payload: RegisterPayload) {
  return request<ApiItemResponse<RegisterResponse>>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function login(payload: { email: string; password: string }) {
  return request<ApiItemResponse<LoginResponse>>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ── Projects (Section 6.2) ───────────────────────────────────────────

export function getProjects() {
  return request<ApiListResponse<Project>>("/projects");
}
export function getProject(id: string) {
  return request<ApiItemResponse<Project>>(`/projects/${id}`);
}
export function createProject(body: {
  code: string;
  name: string;
  customerId?: string | null;
  startDate?: string | null;
  targetEndDate?: string | null;
  poApprovalThreshold?: number | null;
}) {
  return request<ApiItemResponse<Project>>("/projects", { method: "POST", body: JSON.stringify(body) });
}
export function updateProject(id: string, body: Partial<{
  name: string; status: string; startDate: string | null; targetEndDate: string | null; poApprovalThreshold: number | null;
}>) {
  return request<ApiItemResponse<Project>>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function getProjectSites(projectId: string) {
  return request<ApiListResponse<ProjectSite>>(`/projects/${projectId}/sites`);
}
export function createProjectSite(projectId: string, body: { name: string; address?: unknown; stateCode?: string | null }) {
  return request<ApiItemResponse<ProjectSite>>(`/projects/${projectId}/sites`, { method: "POST", body: JSON.stringify(body) });
}

// ── Cost Categories (Section 6.1) ────────────────────────────────────

export function getCostCategories() {
  return request<ApiListResponse<CostCategory>>("/cost-categories");
}

// ── Synced masters (Section 9.1) — read-only mirror of SmartERP items,
// populated either by POST /integration/sync or the manual
// /integration/synced-items fallback. Used here just for the BOQ line
// item picker.
export function getSyncedItems() {
  return request<ApiListResponse<SyncedItem>>("/integration/synced-items");
}

// ── BOQ & Estimation (Section 6.3) ───────────────────────────────────

export function getBoqVersions(projectId: string) {
  return request<ApiListResponse<Boq>>(`/boq/project/${projectId}`);
}
export function createBoqVersion(projectId: string) {
  return request<ApiItemResponse<Boq>>(`/boq/project/${projectId}`, { method: "POST" });
}
export function getBoq(boqId: string) {
  return request<ApiItemResponse<Boq>>(`/boq/${boqId}`);
}
export function addBoqLine(boqId: string, body: {
  lineNo: number; description: string; itemId?: string | null; costCategoryId?: string | null;
  uom: string; quantity: number; rate: number; billable?: boolean;
}) {
  return request<ApiItemResponse<BoqLine>>(`/boq/${boqId}/lines`, { method: "POST", body: JSON.stringify(body) });
}
export function approveBoq(boqId: string) {
  return request<ApiItemResponse<{ id: string; status: string }>>(`/boq/${boqId}/approve`, { method: "POST" });
}
export function setLineEstimate(lineId: string, body: {
  materialCost: number; labourCost: number; subcontractCost: number; overheadCost: number;
}) {
  return request<ApiItemResponse<Estimate>>(`/boq/lines/${lineId}/estimate`, { method: "PUT", body: JSON.stringify(body) });
}

// BOQ import (template download / preview / apply) bypasses the typed
// request<T>() wrapper for the two file-handling calls — same reasoning
// as SmartERP frontend's downloadFile()/uploadJournalAttachment(): a
// blob response and a multipart request body don't fit request<T>()'s
// JSON-in/JSON-out shape.
export function downloadBoqImportTemplate(boqId: string) {
  return downloadFile(`/boq/${boqId}/import/template`, "ProjectOS_BOQ_Template.xlsx");
}
export async function previewBoqImport(boqId: string, file: File): Promise<BoqImportPreviewRow[]> {
  const token = getToken();
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/boq/${boqId}/import/preview`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message ?? `Preview failed (${res.status})`, res.status);
  }
  const body = (await res.json()) as ApiListResponse<BoqImportPreviewRow>;
  return body.data;
}
export function applyBoqImport(boqId: string, rows: BoqImportPreviewRow[]) {
  return request<ApiItemResponse<{ created: number }>>(`/boq/${boqId}/import/apply`, {
    method: "POST",
    body: JSON.stringify({ rows }),
  });
}

// ── Budget (Section 6.3) ─────────────────────────────────────────────

export function getBudget(projectId: string) {
  return request<ApiListResponse<Budget>>(`/budget/project/${projectId}`);
}
export function generateBudget(projectId: string) {
  return request<ApiListResponse<Budget> & { warning?: string }>(`/budget/project/${projectId}/generate`, { method: "POST" });
}
export function approveBudgetLine(budgetId: string, approvedAmount?: number) {
  return request<ApiItemResponse<Budget>>(`/budget/${budgetId}/approve`, {
    method: "PATCH",
    body: JSON.stringify(approvedAmount != null ? { approvedAmount } : {}),
  });
}

// ── SmartERP connection + sync (Section 9.1) ─────────────────────────
// Settings UI for the connection/sync job that already existed on the
// backend (task #118) but had no frontend until now — previously had to
// be driven with curl. SUPER_ADMIN only, matching requireRole(...) on
// these two routes server-side.

export function getSmartErpConnection() {
  return request<ApiItemResponse<SmartErpConnectionStatus | null>>("/integration/connection");
}
export function saveSmartErpConnection(body: { apiBaseUrl: string; apiKey: string }) {
  return request<ApiItemResponse<{ organizationId: string; apiBaseUrl: string }>>("/integration/connection", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
export function syncSmartErp() {
  return request<ApiItemResponse<SyncResult>>("/integration/sync", { method: "POST" });
}

// Read-only mirrors used for pickers elsewhere (BOQ item picker already
// used synced-items; synced-customers is new, backing the Project
// creation form's Customer dropdown).
export function getSyncedCustomers() {
  return request<ApiListResponse<SyncedBusinessPartner>>("/integration/synced-customers");
}
export function getSyncedSuppliers() {
  return request<ApiListResponse<SyncedBusinessPartner>>("/integration/synced-suppliers");
}
