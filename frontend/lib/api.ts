import type {
  Account,
  AccessControlMenuResponse,
  AdminOrganization,
  AdminOrganizationDetail,
  AdminSubscriptionsResponse,
  AuditLogEntry,
  BalanceSheetResponse,
  BusinessPartner,
  CashBookResponse,
  CostingMethod,
  DocumentLineInput,
  DomainDetailsMap,
  DomainType,
  Item,
  JournalEntry,
  JournalLineInput,
  LedgerResponse,
  MenuConfigMap,
  OnboardingStatus,
  OrgRole,
  OrgUsersResponse,
  PnLResponse,
  PurchaseBill,
  PurchaseReturn,
  PurchaseReturnableResponse,
  PurchaseReturnLineInput,
  ReceiptsPaymentsResponse,
  RegisterPayload,
  RegisterResponse,
  SalesInvoice,
  SalesReturn,
  SalesReturnableResponse,
  SalesReturnLineInput,
  StockAdjustment,
  StockAdjustmentLineInput,
  StockLedgerResponse,
  TrialBalanceResponse,
  ValuationResponse,
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
  return request<{ token: string; organizationId: string | null; role: string | null; isPlatformAdmin: boolean; name: string | null }>(
    "/auth/login",
    { method: "POST", body: JSON.stringify(payload) }
  );
}

// POST /auth/accept-invite
export function acceptInvite(token: string, name: string, password: string) {
  return request<{ token: string; organizationId: string; role: string; name: string | null }>("/auth/accept-invite", {
    method: "POST",
    body: JSON.stringify({ token, name, password }),
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

export function getPnL(params?: { from?: string; to?: string }) {
  const qs = new URLSearchParams(cleanParams(params)).toString();
  return request<{ data: PnLResponse }>(`/journal/pnl${qs ? `?${qs}` : ""}`);
}

export function getBalanceSheet(params?: { asOf?: string }) {
  const qs = new URLSearchParams(cleanParams(params)).toString();
  return request<{ data: BalanceSheetResponse }>(`/journal/balance-sheet${qs ? `?${qs}` : ""}`);
}

export function getCashBook(params?: { from?: string; to?: string }) {
  const qs = new URLSearchParams(cleanParams(params)).toString();
  return request<{ data: CashBookResponse }>(`/journal/cash-book${qs ? `?${qs}` : ""}`);
}

export function getReceiptsPayments(params?: { from?: string; to?: string }) {
  const qs = new URLSearchParams(cleanParams(params)).toString();
  return request<{ data: ReceiptsPaymentsResponse }>(`/journal/receipts-payments${qs ? `?${qs}` : ""}`);
}

export function getDayBook(params?: { from?: string; to?: string }) {
  const qs = new URLSearchParams(cleanParams(params)).toString();
  return request<{ data: JournalEntry[] }>(`/journal/day-book${qs ? `?${qs}` : ""}`);
}

// ── Sales / Purchase / Inventory ────────────────────────────────────────────

export function getCostingMethod() {
  return request<{ data: { costingMethod: CostingMethod | null } }>("/items/costing-method");
}

// Succeeds exactly once per org — see backend/src/routes/items.ts.
export function setCostingMethod(costingMethod: CostingMethod) {
  return request<{ data: { costingMethod: CostingMethod } }>("/items/costing-method", {
    method: "POST",
    body: JSON.stringify({ costingMethod }),
  });
}

export function getStockAccounts() {
  return request<{ data: Account[] }>("/items/stock-accounts");
}

export function getItems() {
  return request<{ data: Item[] }>("/items");
}

export function createItem(body: {
  sku: string; name: string; description?: string; uom?: string; hsnCode?: string;
  isFinishedGood?: boolean; stockAccountId: string; salesRate?: number; purchaseRate?: number; taxRate?: number;
  openingQuantity?: number; openingCost?: number; openingBranchId?: string; openingDate?: string;
}) {
  return request<{ data: Item }>("/items", { method: "POST", body: JSON.stringify(body) });
}

export function updateItem(id: string, body: Partial<Item>) {
  return request<{ data: Item }>(`/items/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function deleteItem(id: string) {
  return request<{ data: { deleted: true } }>(`/items/${id}`, { method: "DELETE" });
}

export function getPurchaseBills() {
  return request<{ data: PurchaseBill[] }>("/purchase-bills");
}

export function createPurchaseBill(body: {
  businessPartnerId: string; billDate: string; branchId?: string; narration?: string; lines: DocumentLineInput[];
}) {
  return request<{ data: PurchaseBill }>("/purchase-bills", { method: "POST", body: JSON.stringify(body) });
}

export function getSalesInvoices() {
  return request<{ data: SalesInvoice[] }>("/sales-invoices");
}

export function createSalesInvoice(body: {
  businessPartnerId: string; invoiceDate: string; branchId?: string; narration?: string; lines: DocumentLineInput[];
}) {
  return request<{ data: SalesInvoice }>("/sales-invoices", { method: "POST", body: JSON.stringify(body) });
}

// ── Sales Returns ────────────────────────────────────────────────────────

export function getSalesReturns() {
  return request<{ data: SalesReturn[] }>("/sales-returns");
}

export function getSalesReturnableLines(invoiceId: string) {
  return request<{ data: SalesReturnableResponse }>(`/sales-returns/invoice/${invoiceId}/lines`);
}

export function createSalesReturn(body: {
  salesInvoiceId: string; returnDate: string; branchId?: string; narration?: string; lines: SalesReturnLineInput[];
}) {
  return request<{ data: SalesReturn }>("/sales-returns", { method: "POST", body: JSON.stringify(body) });
}

// ── Purchase Returns ─────────────────────────────────────────────────────

export function getPurchaseReturns() {
  return request<{ data: PurchaseReturn[] }>("/purchase-returns");
}

export function getPurchaseReturnableLines(billId: string) {
  return request<{ data: PurchaseReturnableResponse }>(`/purchase-returns/bill/${billId}/lines`);
}

export function createPurchaseReturn(body: {
  purchaseBillId: string; returnDate: string; branchId?: string; narration?: string; lines: PurchaseReturnLineInput[];
}) {
  return request<{ data: PurchaseReturn }>("/purchase-returns", { method: "POST", body: JSON.stringify(body) });
}

export function getStockAdjustments() {
  return request<{ data: StockAdjustment[] }>("/stock-adjustments");
}

export function createStockAdjustment(body: {
  adjustmentDate: string; branchId?: string; narration?: string; lines: StockAdjustmentLineInput[];
}) {
  return request<{ data: StockAdjustment }>("/stock-adjustments", { method: "POST", body: JSON.stringify(body) });
}

export function getStockLedger(params: { itemId: string; branchId?: string; from?: string; to?: string }) {
  const qs = new URLSearchParams(cleanParams(params)).toString();
  return request<{ data: StockLedgerResponse }>(`/inventory/stock-ledger?${qs}`);
}

export function getValuation(params?: { branchId?: string }) {
  const qs = new URLSearchParams(cleanParams(params)).toString();
  return request<{ data: ValuationResponse }>(`/inventory/valuation${qs ? `?${qs}` : ""}`);
}

// ── Team / user management ──────────────────────────────────────────────────

export function getOrgUsers() {
  return request<{ data: OrgUsersResponse }>("/org/users");
}

export function inviteUser(body: { email?: string; phone?: string; role: OrgRole }) {
  return request<{ data: { id: string }; devInviteToken?: string }>("/org/users/invite", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function cancelInvite(id: string) {
  return request<{ data: { deleted: true } }>(`/org/users/invites/${id}`, { method: "DELETE" });
}

export function updateMemberRole(userId: string, role: OrgRole) {
  return request<{ data: { userId: string; role: OrgRole } }>(`/org/users/${userId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export function removeMember(userId: string) {
  return request<{ data: { deleted: true } }>(`/org/users/${userId}`, { method: "DELETE" });
}

// ── Access control (menu visibility by role) ────────────────────────────────

// Own org, resolved for whatever role the caller happens to have —
// AppShell uses this to filter the sidebar.
export function getMenuConfig() {
  return request<{ data: MenuConfigMap }>("/access-control/menu");
}

// The configuration screen: full matrix + which roles this caller may edit.
// Works for an OWNER/ADMIN's own org, or (with organizationId) a platform
// admin targeting any org.
export function getMenuConfigForOrg(organizationId: string) {
  return request<AccessControlMenuResponse>(`/access-control/menu/${organizationId}`);
}

export function saveMenuConfig(organizationId: string, items: Array<{ itemId: string; role: OrgRole; enabled: boolean }>) {
  return request<{ data: MenuConfigMap }>(`/access-control/menu/${organizationId}`, {
    method: "PUT",
    body: JSON.stringify({ items }),
  });
}

// ── Platform admin ───────────────────────────────────────────────────────────

export function getAdminOrganizations(q?: string) {
  const qs = q ? `?q=${encodeURIComponent(q)}` : "";
  return request<{ data: AdminOrganization[] }>(`/admin/organizations${qs}`);
}

export function getAdminOrganization(id: string) {
  return request<{ data: AdminOrganizationDetail }>(`/admin/organizations/${id}`);
}

export function updateAdminOrganization(id: string, name: string) {
  return request<{ data: { id: string; name: string } }>(`/admin/organizations/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export function setOrgSubscription(id: string, status: "ACTIVE" | "SUSPENDED") {
  return request<{ data: { id: string; subscriptionStatus: string } }>(`/admin/organizations/${id}/subscription`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

// Permanently deletes an org. The backend refuses unless it's already
// SUSPENDED and has zero posted journal entries.
export function deleteAdminOrganization(id: string) {
  return request<{ data: { deleted: true } }>(`/admin/organizations/${id}`, { method: "DELETE" });
}

export function getAdminSubscriptions(params?: { q?: string; filter?: string }) {
  const qs = new URLSearchParams(cleanParams(params)).toString();
  return request<AdminSubscriptionsResponse>(`/admin/subscriptions${qs ? `?${qs}` : ""}`);
}

export function grantModule(
  organizationId: string,
  moduleCode: string,
  body: { status?: "ACTIVE" | "TRIAL"; expiresOn: string | null; startsOn?: string; amount?: number | null; reference?: string; note?: string },
) {
  return request<{ data: unknown }>(`/admin/subscriptions/${organizationId}/${moduleCode}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function cancelModule(organizationId: string, moduleCode: string) {
  return request<{ data: unknown }>(`/admin/subscriptions/${organizationId}/${moduleCode}`, { method: "DELETE" });
}

export function getAdminAuditLogs(organizationId?: string) {
  const qs = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : "";
  return request<{ data: AuditLogEntry[] }>(`/admin/audit-logs${qs}`);
}

// ── Bulk upload (Template Download + Bulk Upload) — shared across Chart of
// Accounts, Items, and Business Partners. Template download and preview-file
// upload both bypass request<T>() on purpose: a template response is binary
// (not JSON), and a preview request's body is FormData, which needs the
// browser to set its own multipart Content-Type — request<T>() always
// forces "application/json".
export type BulkUploadEntity = "accounts" | "items" | "business-partners";

export async function downloadBulkTemplate(entity: BulkUploadEntity, filename: string): Promise<void> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/${entity}/bulk-upload/template`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    throw new ApiError("Could not reach the backend to download the template.");
  }
  if (!res.ok) throw new ApiError(`Could not download the template (${res.status}).`, res.status);
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

export async function previewBulkUpload<Row>(entity: BulkUploadEntity, file: File): Promise<{ data: Row[] }> {
  const token = getToken();
  const fd = new FormData();
  fd.append("file", file);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/${entity}/bulk-upload/preview`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
  } catch {
    throw new ApiError("Could not reach the backend to parse the file.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message ?? `Could not parse the file (${res.status}).`, res.status);
  }
  return res.json();
}

export function applyBulkUpload<Row>(entity: BulkUploadEntity, rows: Row[]) {
  return request<{ data: { created: number; updated: number } }>(`/${entity}/bulk-upload/apply`, {
    method: "POST",
    body: JSON.stringify({ rows }),
  });
}
