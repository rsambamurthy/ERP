import type {
  Account,
  AccessControlMenuResponse,
  AdminOrganization,
  AdminOrganizationDetail,
  AdminSubscriptionsResponse,
  AuditLogEntry,
  BalanceSheetResponse,
  Branch,
  BranchSummary,
  BusinessPartner,
  BusinessPartnerLookup,
  CashBookResponse,
  CompanyMaster,
  CostingMethod,
  CurrencyRate,
  CustomRole,
  Director,
  Auditor,
  MemberStatus,
  MyProfile,
  Permission,
  DocumentLineInput,
  DomainDetailsMap,
  ExtractedInvoice,
  DomainType,
  Gstr1Report,
  Gstr3bReport,
  IntegrationConnectionStatus,
  Item,
  ScheduleIIIBalanceSheet,
  ChatMessage,
  JournalEntry,
  JournalLineInput,
  LedgerResponse,
  MenuConfigMap,
  OnboardingStatus,
  OrgRole,
  OrgUsersResponse,
  PnLResponse,
  PurchaseBill,
  PurchaseOrder,
  PurchaseOrderLineInput,
  GoodsReceiptNote,
  GoodsReceiptNoteLineInput,
  SalesOrder,
  SalesOrderLineInput,
  DeliveryNote,
  DeliveryNoteLineInput,
  PurchaseReturn,
  PurchaseReturnableResponse,
  PurchaseReturnLineInput,
  ReceiptsPaymentsResponse,
  RegisterPayload,
  RegisterResponse,
  SalesInvoice,
  SalesLineInput,
  DiscountType,
  SalesReturn,
  SalesReturnableResponse,
  SalesReturnLineInput,
  StockAdjustment,
  StockAdjustmentLineInput,
  StockLedgerResponse,
  TrialBalanceResponse,
  VendorContact,
  VendorAddress,
  VendorBankAccount,
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
  return request<{ ok: true; token: string | null; permissions: Permission[] }>("/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({ organizationId, otp }),
  });
}

// POST /auth/login
export function login(payload: { email?: string; phone?: string; password: string }) {
  return request<{
    token: string; organizationId: string | null; role: string | null;
    isPlatformAdmin: boolean; name: string | null; permissions?: Permission[]; customRoleId?: string | null;
  }>("/auth/login", { method: "POST", body: JSON.stringify(payload) });
}

// Same response shape as login() above — all three log the user in the same
// way, just via a different credential.
export interface MpinLoginResponse {
  token: string; organizationId: string | null; role: string | null;
  isPlatformAdmin: boolean; name: string | null; permissions?: Permission[]; customRoleId?: string | null;
}

export function getMpinStatus(identifier: string) {
  return request<{ data: { hasMpin: boolean } }>(`/auth/mpin/status?identifier=${encodeURIComponent(identifier)}`);
}

export function requestMpinOtp(identifier: string) {
  return request<{ data: { sent: true; devOtp?: string } }>("/auth/mpin/request-otp", {
    method: "POST", body: JSON.stringify({ identifier }),
  });
}

export function verifyMpin(identifier: string, mpin: string) {
  return request<MpinLoginResponse>("/auth/mpin/verify", {
    method: "POST", body: JSON.stringify({ identifier, mpin }),
  });
}

export function setMpin(identifier: string, otp: string, mpin: string) {
  return request<MpinLoginResponse>("/auth/mpin/set", {
    method: "POST", body: JSON.stringify({ identifier, otp, mpin }),
  });
}

// POST /auth/accept-invite — mpin is optional: set straight away, no OTP
// (the invite token itself is the proof — see the backend route's comment).
export function acceptInvite(token: string, name: string, password: string, mpin?: string) {
  return request<{
    token: string; organizationId: string; role: string; name: string | null;
    permissions: Permission[]; customRoleId: string | null;
  }>("/auth/accept-invite", { method: "POST", body: JSON.stringify({ token, name, password, mpin: mpin || undefined }) });
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

// ── Company Master ───────────────────────────────────────────────────────

export function getCompanyMaster() {
  return request<{ data: CompanyMaster }>("/company-master");
}

export function updateCompanyMaster(body: {
  cin?: string | null; companyPan?: string | null; companyType?: string | null;
  incorporationDate?: string | null; registeredOfficeAddress?: string | null;
  poApprovalThreshold?: number | null; priceVarianceTolerancePct?: number | null;
  soApprovalThreshold?: number | null;
}) {
  return request<{ data: CompanyMaster }>("/company-master", { method: "PATCH", body: JSON.stringify(body) });
}

export function createDirector(body: { name: string; din?: string; designation?: string; appointmentDate?: string }) {
  return request<{ data: Director }>("/company-master/directors", { method: "POST", body: JSON.stringify(body) });
}

export function updateDirector(id: string, body: Partial<Director>) {
  return request<{ data: Director }>(`/company-master/directors/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function deleteDirector(id: string) {
  return request<{ data: { deleted: true } }>(`/company-master/directors/${id}`, { method: "DELETE" });
}

export function createAuditor(body: { name: string; membershipNumber?: string; firmRegistrationNumber?: string; appointmentDate?: string }) {
  return request<{ data: Auditor }>("/company-master/auditors", { method: "POST", body: JSON.stringify(body) });
}

export function updateAuditor(id: string, body: Partial<Auditor>) {
  return request<{ data: Auditor }>(`/company-master/auditors/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function deleteAuditor(id: string) {
  return request<{ data: { deleted: true } }>(`/company-master/auditors/${id}`, { method: "DELETE" });
}

// Re-runs provisioning's account seeding for an org that already exists —
// picks up any template account added since this org signed up (e.g. GST
// Input/Output, COGS, Sales Revenue — added with Sales/Purchase/Inventory).
// Safe to call anytime: only ever adds accounts missing by code.
export function syncAccountTemplates() {
  return request<{ data: { added: number } }>("/accounts/sync-templates", { method: "POST" });
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

// Use this, not getBusinessPartners, for anything that only needs to *pick* a
// partner. It returns four fields per row instead of twenty-odd, which is the
// difference between a few hundred KB and several MB on an org with ~10k
// partners — paid on every load of every screen that has a partner dropdown.
export function getBusinessPartnerLookup(bpType?: "CUSTOMER" | "VENDOR") {
  return request<{ data: BusinessPartnerLookup[] }>(
    `/business-partners/lookup${bpType ? `?bpType=${bpType}` : ""}`
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

// Full detail — includes vendorContacts/vendorAddresses/vendorBankAccounts,
// which the list endpoint above doesn't return.
export function getBusinessPartner(id: string) {
  return request<{ data: BusinessPartner }>(`/business-partners/${id}`);
}

// ── Vendor Management (Phase 1) ──────────────────────────────────────────

export function submitBusinessPartnerForApproval(id: string) {
  return request<{ data: BusinessPartner }>(`/business-partners/${id}/submit-for-approval`, { method: "POST" });
}
export function approveBusinessPartner(id: string) {
  return request<{ data: BusinessPartner }>(`/business-partners/${id}/approve`, { method: "POST" });
}
export function rejectBusinessPartner(id: string, reason: string) {
  return request<{ data: BusinessPartner }>(`/business-partners/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function createVendorContact(businessPartnerId: string, body: Partial<VendorContact>) {
  return request<{ data: VendorContact }>(`/business-partners/${businessPartnerId}/contacts`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
export function updateVendorContact(businessPartnerId: string, contactId: string, body: Partial<VendorContact>) {
  return request<{ data: VendorContact }>(`/business-partners/${businessPartnerId}/contacts/${contactId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
export function deleteVendorContact(businessPartnerId: string, contactId: string) {
  return request<{ data: { deleted: true } }>(`/business-partners/${businessPartnerId}/contacts/${contactId}`, { method: "DELETE" });
}

export function createVendorAddress(businessPartnerId: string, body: Partial<VendorAddress>) {
  return request<{ data: VendorAddress }>(`/business-partners/${businessPartnerId}/addresses`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
export function updateVendorAddress(businessPartnerId: string, addressId: string, body: Partial<VendorAddress>) {
  return request<{ data: VendorAddress }>(`/business-partners/${businessPartnerId}/addresses/${addressId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
export function deleteVendorAddress(businessPartnerId: string, addressId: string) {
  return request<{ data: { deleted: true } }>(`/business-partners/${businessPartnerId}/addresses/${addressId}`, { method: "DELETE" });
}

export function createVendorBankAccount(businessPartnerId: string, body: Partial<VendorBankAccount>) {
  return request<{ data: VendorBankAccount }>(`/business-partners/${businessPartnerId}/bank-accounts`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
export function updateVendorBankAccount(businessPartnerId: string, bankAccountId: string, body: Partial<VendorBankAccount>) {
  return request<{ data: VendorBankAccount }>(`/business-partners/${businessPartnerId}/bank-accounts/${bankAccountId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
export function deleteVendorBankAccount(businessPartnerId: string, bankAccountId: string) {
  return request<{ data: { deleted: true } }>(`/business-partners/${businessPartnerId}/bank-accounts/${bankAccountId}`, { method: "DELETE" });
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

// Only manual entries (referenceType null) accept this — the backend
// 409s on anything auto-posted.
export function updateJournalEntry(id: string, body: {
  entryDate: string;
  narration: string;
  lines: JournalLineInput[];
}) {
  return request<{ data: JournalEntry }>(`/journal/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function getJournalEntry(id: string) {
  return request<{ data: JournalEntry }>(`/journal/${id}`);
}

// Multipart upload — bypasses request<T>() the same way bulk-upload does,
// so the browser can set its own multipart Content-Type boundary.
export async function uploadJournalAttachment(id: string, file: File) {
  const token = getToken();
  const fd = new FormData();
  fd.append("file", file);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/journal/${id}/attachment`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
  } catch {
    throw new ApiError("Could not reach the backend to upload the attachment.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message ?? `Could not upload the attachment (${res.status}).`, res.status);
  }
  return res.json() as Promise<{ data: { attachmentFilename: string; attachmentMimeType: string; attachmentSize: number } }>;
}

export async function downloadJournalAttachment(id: string, filename: string): Promise<void> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/journal/${id}/attachment`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    throw new ApiError("Could not reach the backend to download the attachment.");
  }
  if (!res.ok) throw new ApiError(`Could not download the attachment (${res.status}).`, res.status);
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

export function removeJournalAttachment(id: string) {
  return request<{ data: { removed: true } }>(`/journal/${id}/attachment`, { method: "DELETE" });
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

export function getScheduleIIIBalanceSheet(params?: { asOf?: string; branchId?: string }) {
  const qs = new URLSearchParams(cleanParams(params)).toString();
  return request<{ data: ScheduleIIIBalanceSheet }>(`/journal/schedule-iii-balance-sheet${qs ? `?${qs}` : ""}`);
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

// ── GST Statutory Reports (GSTR-1 / GSTR-3B) ────────────────────────────────

export function getGstr1(params: { from: string; to: string; branchId?: string }) {
  const qs = new URLSearchParams(cleanParams(params)).toString();
  return request<{ data: Gstr1Report }>(`/gst/gstr1?${qs}`);
}

export function getGstr3b(params: { from: string; to: string; branchId?: string }) {
  const qs = new URLSearchParams(cleanParams(params)).toString();
  return request<{ data: Gstr3bReport }>(`/gst/gstr3b?${qs}`);
}

// Both exports bypass request<T>() the same way downloadBulkTemplate does —
// a real file download, not JSON.
async function downloadFile(path: string, filename: string): Promise<void> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    throw new ApiError("Could not reach the backend to download the report.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message ?? `Could not download the report (${res.status}).`, res.status);
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

export function downloadGstr1(params: { from: string; to: string; branchId?: string }) {
  const qs = new URLSearchParams(cleanParams(params)).toString();
  return downloadFile(`/gst/gstr1/export?${qs}`, `GSTR1_${params.from}_to_${params.to}.xlsx`);
}

export function downloadGstr3b(params: { from: string; to: string; branchId?: string }) {
  const qs = new URLSearchParams(cleanParams(params)).toString();
  return downloadFile(`/gst/gstr3b/export?${qs}`, `GSTR3B_${params.from}_to_${params.to}.xlsx`);
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
  defaultDiscountPct?: number;
  openingQuantity?: number; openingCost?: number; openingBranchId?: string; openingDate?: string;
}) {
  return request<{ data: Item }>("/items", { method: "POST", body: JSON.stringify(body) });
}

export function getItem(id: string) {
  return request<{ data: Item }>(`/items/${id}`);
}

export function updateItem(id: string, body: Partial<Item>) {
  return request<{ data: Item }>(`/items/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function toggleItem(id: string) {
  return request<{ data: Item }>(`/items/${id}/toggle`, { method: "PATCH" });
}

export function deleteItem(id: string) {
  return request<{ data: { deleted: true } }>(`/items/${id}`, { method: "DELETE" });
}

export function getPurchaseBills() {
  return request<{ data: PurchaseBill[] }>("/purchase-bills");
}

export function getPurchaseBill(id: string) {
  return request<{ data: PurchaseBill }>(`/purchase-bills/${id}`);
}

// Multipart upload — same reasoning as uploadJournalAttachment above.
// Read-only: never creates or changes a bill, just reads the file.
export async function extractInvoice(file: File) {
  const token = getToken();
  const fd = new FormData();
  fd.append("file", file);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/purchase-bills/extract-invoice`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
  } catch {
    throw new ApiError("Could not reach the backend to extract the invoice.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message ?? `Could not extract the invoice (${res.status}).`, res.status);
  }
  return res.json() as Promise<{ data: ExtractedInvoice }>;
}

export function createPurchaseBill(body: {
  // Omit businessPartnerId when purchaseOrderId is given — the vendor is
  // derived from the (approved) PO server-side. See routes/purchaseBills.ts.
  businessPartnerId?: string; billDate: string; branchId?: string; narration?: string; lines: DocumentLineInput[];
  currency?: string; exchangeRate?: number;
  billOfEntryNumber?: string; billOfEntryDate?: string; portCode?: string;
  purchaseOrderId?: string;
}) {
  return request<{ data: PurchaseBill }>("/purchase-bills", { method: "POST", body: JSON.stringify(body) });
}

// Reference-only fields (Bill of Entry, port code) — see the PATCH
// /purchase-bills/:id note in the backend route. Never touches an amount.
export function updatePurchaseBillReference(id: string, body: {
  billOfEntryNumber?: string | null; billOfEntryDate?: string | null; portCode?: string | null;
}) {
  return request<{ data: PurchaseBill }>(`/purchase-bills/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

// 3-way match approval — PENDING_APPROVAL only. Approving performs the
// deferred posting (journal entry, billedQuantity increments); rejecting
// is terminal (this app has no bill-edit capability — raise a corrected
// bill instead). See PurchaseBill.status.
export function approvePurchaseBill(id: string) {
  return request<{ data: PurchaseBill }>(`/purchase-bills/${id}/approve`, { method: "POST" });
}

export function rejectPurchaseBill(id: string, reason: string) {
  return request<{ data: PurchaseBill }>(`/purchase-bills/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
}

// ── Purchase Orders ──────────────────────────────────────────────────────

export function getPurchaseOrders(params?: { status?: string; businessPartnerId?: string }) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.businessPartnerId) qs.set("businessPartnerId", params.businessPartnerId);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request<{ data: PurchaseOrder[] }>(`/purchase-orders${suffix}`);
}

export function getPurchaseOrder(id: string) {
  return request<{ data: PurchaseOrder }>(`/purchase-orders/${id}`);
}

export function createPurchaseOrder(body: {
  businessPartnerId: string; poDate: string; branchId?: string; expectedDeliveryDate?: string; narration?: string;
  lines: PurchaseOrderLineInput[];
  currency?: string; exchangeRate?: number;
}) {
  return request<{ data: PurchaseOrder }>("/purchase-orders", { method: "POST", body: JSON.stringify(body) });
}

// Full edit — Draft only (the backend 400s otherwise). See PATCH
// /purchase-orders/:id.
export function updatePurchaseOrder(id: string, body: {
  businessPartnerId?: string; poDate?: string; branchId?: string | null; expectedDeliveryDate?: string | null; narration?: string;
  lines: PurchaseOrderLineInput[];
  currency?: string; exchangeRate?: number;
}) {
  return request<{ data: PurchaseOrder }>(`/purchase-orders/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function submitPurchaseOrder(id: string) {
  return request<{ data: PurchaseOrder }>(`/purchase-orders/${id}/submit`, { method: "POST" });
}

export function approvePurchaseOrder(id: string) {
  return request<{ data: PurchaseOrder }>(`/purchase-orders/${id}/approve`, { method: "POST" });
}

export function rejectPurchaseOrder(id: string, reason: string) {
  return request<{ data: PurchaseOrder }>(`/purchase-orders/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function reopenPurchaseOrder(id: string) {
  return request<{ data: PurchaseOrder }>(`/purchase-orders/${id}/reopen`, { method: "POST" });
}

export function cancelPurchaseOrder(id: string) {
  return request<{ data: PurchaseOrder }>(`/purchase-orders/${id}/cancel`, { method: "POST" });
}

// Same bypass-request<T>() pattern as downloadGstr1/downloadGstr3b — a real
// file download, not JSON.
export function downloadPurchaseOrderPdf(id: string, poNumber: string) {
  return downloadFile(`/purchase-orders/${id}/pdf`, `${poNumber}.pdf`);
}

// ── Goods Receipt Notes ──────────────────────────────────────────────────
// Records physical receipt against an APPROVED Purchase Order and moves
// stock immediately — creates and posts in one step, no separate "post"
// call (same UX as Purchase Bills). See PurchaseOrder above and
// ROADMAP.md's "Goods Receipt Note" section.

export function getGoodsReceiptNotes(params?: { purchaseOrderId?: string }) {
  const qs = new URLSearchParams();
  if (params?.purchaseOrderId) qs.set("purchaseOrderId", params.purchaseOrderId);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request<{ data: GoodsReceiptNote[] }>(`/goods-receipt-notes${suffix}`);
}

export function getGoodsReceiptNote(id: string) {
  return request<{ data: GoodsReceiptNote }>(`/goods-receipt-notes/${id}`);
}

export function createGoodsReceiptNote(body: {
  purchaseOrderId: string; grnDate: string; narration?: string; lines: GoodsReceiptNoteLineInput[];
}) {
  return request<{ data: GoodsReceiptNote }>("/goods-receipt-notes", { method: "POST", body: JSON.stringify(body) });
}

// ── Sales Orders ──────────────────────────────────────────────────────────

export function getSalesOrders(params?: { status?: string; businessPartnerId?: string }) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.businessPartnerId) qs.set("businessPartnerId", params.businessPartnerId);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request<{ data: SalesOrder[] }>(`/sales-orders${suffix}`);
}

export function getSalesOrder(id: string) {
  return request<{ data: SalesOrder }>(`/sales-orders/${id}`);
}

export function createSalesOrder(body: {
  businessPartnerId: string; soDate: string; branchId?: string; expectedDeliveryDate?: string; narration?: string;
  lines: SalesOrderLineInput[];
  currency?: string; exchangeRate?: number;
}) {
  return request<{ data: SalesOrder }>("/sales-orders", { method: "POST", body: JSON.stringify(body) });
}

// Full edit — Draft only (the backend 400s otherwise). See PATCH
// /sales-orders/:id.
export function updateSalesOrder(id: string, body: {
  businessPartnerId?: string; soDate?: string; branchId?: string | null; expectedDeliveryDate?: string | null; narration?: string;
  lines: SalesOrderLineInput[];
  currency?: string; exchangeRate?: number;
}) {
  return request<{ data: SalesOrder }>(`/sales-orders/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function submitSalesOrder(id: string) {
  return request<{ data: SalesOrder }>(`/sales-orders/${id}/submit`, { method: "POST" });
}

export function approveSalesOrder(id: string) {
  return request<{ data: SalesOrder }>(`/sales-orders/${id}/approve`, { method: "POST" });
}

export function rejectSalesOrder(id: string, reason: string) {
  return request<{ data: SalesOrder }>(`/sales-orders/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function reopenSalesOrder(id: string) {
  return request<{ data: SalesOrder }>(`/sales-orders/${id}/reopen`, { method: "POST" });
}

export function cancelSalesOrder(id: string) {
  return request<{ data: SalesOrder }>(`/sales-orders/${id}/cancel`, { method: "POST" });
}

// Same bypass-request<T>() pattern as downloadPurchaseOrderPdf — a real
// file download, not JSON.
export function downloadSalesOrderPdf(id: string, soNumber: string) {
  return downloadFile(`/sales-orders/${id}/pdf`, `${soNumber}.pdf`);
}

// ── Delivery Notes ────────────────────────────────────────────────────────
// Records physical dispatch against an APPROVED Sales Order and moves
// stock immediately — creates and posts in one step, no separate "post"
// call (same UX as Sales Invoices). See SalesOrder above and
// ROADMAP.md's "Delivery Note" section.

export function getDeliveryNotes(params?: { salesOrderId?: string }) {
  const qs = new URLSearchParams();
  if (params?.salesOrderId) qs.set("salesOrderId", params.salesOrderId);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request<{ data: DeliveryNote[] }>(`/delivery-notes${suffix}`);
}

export function getDeliveryNote(id: string) {
  return request<{ data: DeliveryNote }>(`/delivery-notes/${id}`);
}

export function createDeliveryNote(body: {
  salesOrderId: string; dnDate: string; narration?: string; lines: DeliveryNoteLineInput[];
}) {
  return request<{ data: DeliveryNote }>("/delivery-notes", { method: "POST", body: JSON.stringify(body) });
}

export function getSalesInvoices() {
  return request<{ data: SalesInvoice[] }>("/sales-invoices");
}

export function getSalesInvoice(id: string) {
  return request<{ data: SalesInvoice }>(`/sales-invoices/${id}`);
}

export function createSalesInvoice(body: {
  businessPartnerId?: string; invoiceDate: string; branchId?: string; narration?: string; lines: SalesLineInput[];
  discountType?: DiscountType | null; discountValue?: number;
  currency?: string; exchangeRate?: number;
  exportType?: string; lutBondNumber?: string; lutBondDate?: string;
  shippingBillNumber?: string; shippingBillDate?: string; portCode?: string;
  // Sales-Order-linked invoice — see SalesOrder above. When set,
  // businessPartnerId is optional (derived from the SO server-side), and
  // every line must carry a deliveryNoteLineId (3-way match).
  salesOrderId?: string;
}) {
  return request<{ data: SalesInvoice }>("/sales-invoices", { method: "POST", body: JSON.stringify(body) });
}

// Reference-only fields (shipping bill, LUT/Bond ARN) — see the PATCH
// /sales-invoices/:id note in the backend route. Never touches an amount.
export function updateSalesInvoiceReference(id: string, body: {
  shippingBillNumber?: string | null; shippingBillDate?: string | null; portCode?: string | null;
  lutBondNumber?: string | null; lutBondDate?: string | null;
}) {
  return request<{ data: SalesInvoice }>(`/sales-invoices/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

// Same bypass-request<T>() pattern as downloadPurchaseOrderPdf — a real
// file download, not JSON.
export function downloadSalesInvoicePdf(id: string, invoiceNumber: string) {
  return downloadFile(`/sales-invoices/${id}/pdf`, `${invoiceNumber}.pdf`);
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

export function inviteUser(body: { email?: string; phone?: string; role: OrgRole; customRoleId?: string }) {
  return request<{ data: { id: string }; devInviteToken?: string }>("/org/users/invite", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function cancelInvite(id: string) {
  return request<{ data: { deleted: true } }>(`/org/users/invites/${id}`, { method: "DELETE" });
}

export function updateMemberRole(userId: string, role: OrgRole, customRoleId?: string) {
  return request<{ data: { userId: string; role: OrgRole; customRoleId: string | null } }>(`/org/users/${userId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role, customRoleId }),
  });
}

export function removeMember(userId: string) {
  return request<{ data: { deleted: true } }>(`/org/users/${userId}`, { method: "DELETE" });
}

export function updateMemberEmployeeDetails(userId: string, body: { address?: string; pan?: string; aadhar?: string }) {
  return request<{ data: { userId: string; address: string | null; pan: string | null; aadharMasked: string | null } }>(
    `/org/users/${userId}/employee-details`,
    { method: "PATCH", body: JSON.stringify(body) }
  );
}

export function updateMemberBranch(userId: string, branchId: string | null) {
  return request<{ data: { userId: string; branchId: string | null } }>(`/org/users/${userId}/branch`, {
    method: "PATCH",
    body: JSON.stringify({ branchId }),
  });
}

export function updateMemberStatus(userId: string, status: MemberStatus) {
  return request<{ data: { userId: string; status: MemberStatus } }>(`/org/users/${userId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function getBranches() {
  return request<{ data: Branch[] }>("/branches");
}

export function createBranch(body: {
  code: string; name: string; gstin?: string; stateCode?: string; phone?: string; email?: string; address?: unknown; isHeadOffice?: boolean;
}) {
  return request<{ data: Branch }>("/branches", { method: "POST", body: JSON.stringify(body) });
}

export function updateBranch(id: string, body: Partial<{
  code: string; name: string; gstin: string; stateCode: string; phone: string; email: string; address: unknown; isHeadOffice: boolean;
}>) {
  return request<{ data: Branch }>(`/branches/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function toggleBranch(id: string) {
  return request<{ data: Branch }>(`/branches/${id}/toggle`, { method: "PATCH" });
}

export function deleteBranch(id: string) {
  return request<{ data: { deleted: true } }>(`/branches/${id}`, { method: "DELETE" });
}

// ── Own profile / password ──────────────────────────────────────────────────

export function getMe() {
  return request<{ data: MyProfile }>("/me");
}

export function updateMe(body: { name?: string; email?: string; phone?: string }) {
  return request<{ data: MyProfile }>("/me", { method: "PATCH", body: JSON.stringify(body) });
}

export function changePassword(body: { currentPassword: string; newPassword: string }) {
  return request<{ data: { ok: true } }>("/me/change-password", { method: "POST", body: JSON.stringify(body) });
}

export function forgotPassword(body: { email?: string; phone?: string }) {
  return request<{ message: string; devOtp?: string }>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function resetPassword(body: { email?: string; phone?: string; otp: string; newPassword: string }) {
  return request<{ data: { ok: true } }>("/auth/reset-password", { method: "POST", body: JSON.stringify(body) });
}

// ── Custom roles ─────────────────────────────────────────────────────────────

export function getOrgRoles() {
  return request<{ data: CustomRole[]; permissionCatalogue: Permission[] }>("/org-roles");
}

export function createOrgRole(body: { name: string; permissions: Permission[] }) {
  return request<{ data: CustomRole }>("/org-roles", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateOrgRole(id: string, body: { name?: string; permissions?: Permission[] }) {
  return request<{ data: CustomRole }>(`/org-roles/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteOrgRole(id: string) {
  return request<{ data: { deleted: true } }>(`/org-roles/${id}`, { method: "DELETE" });
}

// ── Data assistant (chatbot) ─────────────────────────────────────────────
// history is the running transcript so far (not including this message) —
// ChatWidget.tsx holds it in memory only, nothing is persisted server-side.
export function askChatbot(message: string, history: ChatMessage[]) {
  return request<{ answer: string }>("/chatbot/ask", {
    method: "POST",
    body: JSON.stringify({ message, history }),
  });
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

// role is a plain string, not OrgRole — a fixed role name or "custom:<id>"
// for a custom role (see accessControl.ts's customRoleKey()).
export function saveMenuConfig(organizationId: string, items: Array<{ itemId: string; role: string; enabled: boolean }>) {
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
export type BulkUploadEntity = "accounts" | "items" | "business-partners" | "currency-rates" | "journal";

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

// ── Currency Master ──────────────────────────────────────────────────────

export function getCurrencyRates() {
  return request<{ data: CurrencyRate[] }>("/currency-rates");
}

export function createCurrencyRate(body: { currencyCode: string; effectiveFrom: string; rate: number }) {
  return request<{ data: CurrencyRate }>("/currency-rates", { method: "POST", body: JSON.stringify(body) });
}

export function updateCurrencyRate(id: string, rate: number) {
  return request<{ data: CurrencyRate }>(`/currency-rates/${id}`, { method: "PATCH", body: JSON.stringify({ rate }) });
}

export function deleteCurrencyRate(id: string) {
  return request<{ data: { deleted: true } }>(`/currency-rates/${id}`, { method: "DELETE" });
}

// The Sales Invoice / Purchase Bill create forms call this whenever the
// user has a foreign currency + a transaction date selected, to pre-fill
// the Exchange Rate field. Returns `{ data: null }` (not an error) when no
// rate has been entered yet for that currency/date — the field just stays
// whatever the user already typed.
export function lookupCurrencyRate(currencyCode: string, date: string) {
  return request<{ data: { rate: string; effectiveFrom: string } | null }>(
    `/currency-rates/lookup?currencyCode=${encodeURIComponent(currencyCode)}&date=${encodeURIComponent(date)}`
  );
}

// ── Integration Connections (Project OS API key) ────────────────────────────
// See routes/integrationConnections.ts. OWNER/ADMIN only. The raw API key is
// only ever present in generateIntegrationConnection()'s response — copy it
// immediately, it can't be retrieved again afterwards.

export function getIntegrationConnection() {
  return request<{ data: IntegrationConnectionStatus | null }>("/integration/connections");
}

export function generateIntegrationConnection(label?: string) {
  return request<{ data: { id: string; apiKey: string; label: string | null; createdAt: string } }>(
    "/integration/connections",
    { method: "POST", body: JSON.stringify({ label }) }
  );
}

export function revokeIntegrationConnection() {
  return request<{ data: { revoked: true } }>("/integration/connections", { method: "DELETE" });
}
