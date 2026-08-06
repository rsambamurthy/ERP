export type DomainCode = "TRADING" | "MANUFACTURING";

export interface DomainType {
  code: DomainCode;
  name: string;
  description?: string;
}

export interface TradingDetails {
  gstin: string;
  businessType: "RETAILER" | "WHOLESALER" | "DISTRIBUTOR";
  primaryCategories?: string;
}

export interface ManufacturingDetails {
  gstin: string;
  industryType: string;
  hasBom: boolean;
}

export type DomainDetailsMap = {
  TRADING?: TradingDetails;
  MANUFACTURING?: ManufacturingDetails;
};

export interface RegisterPayload {
  businessName: string;
  name: string;
  email: string;
  phone: string;
  password: string;
}

export interface RegisterResponse {
  organizationId: string;
  userId: string;
  // Dev convenience only — present until a real email/SMS provider is wired
  // up. Will disappear once EXPOSE_DEV_OTP is turned off in the backend.
  devOtp?: string;
}

export type OnboardingStep =
  | "SIGNUP"
  | "VERIFIED"
  | "DOMAIN_SELECTED"
  | "PROVISIONED";

export interface OnboardingStatus {
  step: OnboardingStep;
  organizationId: string;
}

// ── Accounting core ─────────────────────────────────────────────────────────

export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";
export type BalanceType = "DEBIT" | "CREDIT";

export interface Account {
  id: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  subType: string | null;
  description: string | null;
  sortOrder: number;
  parentId: string | null;
  isGroup: boolean;
  isControlAccount: boolean;
  defaultBpType: "CUSTOMER" | "VENDOR" | "ITEM" | null;
  isSystem: boolean;
  isActive: boolean;
  openingBalance: string | null;
  openingBalanceType: BalanceType | null;
}

export interface BusinessPartner {
  id: string;
  bpType: "CUSTOMER" | "VENDOR" | "ITEM";
  name: string;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  openingBalance: string;
  openingBalanceType: BalanceType | null;
  isActive: boolean;
}

export interface JournalLineInput {
  accountId: string;
  businessPartnerId?: string | null;
  debit?: number;
  credit?: number;
  narration?: string | null;
}

export interface JournalLine extends JournalLineInput {
  id: string;
  account: Account;
  businessPartner: BusinessPartner | null;
}

export interface JournalEntry {
  id: string;
  entryDate: string;
  narration: string;
  voucherType: "BV" | "CV" | "JV" | null;
  branchId: string | null;
  journalLines: JournalLine[];
}

export interface LedgerRow {
  date: string;
  narration: string;
  businessPartner: string | null;
  debit: number;
  credit: number;
  balance: number;
}

export interface LedgerResponse {
  account: Account;
  openingBalance: number;
  rows: LedgerRow[];
}

export interface TrialBalanceRow {
  account: Account;
  debit: number;
  credit: number;
}

export interface TrialBalanceResponse {
  asOf: string | null;
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
}

export interface PnLRow {
  account: Account;
  amount: number;
}

export interface PnLResponse {
  from: string | null;
  to: string | null;
  income: PnLRow[];
  expense: PnLRow[];
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
}

export interface BalanceSheetResponse {
  asOf: string | null;
  assets: PnLRow[];
  liabilities: PnLRow[];
  equity: PnLRow[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  netProfitToDate: number;
  totalEquityAndProfit: number;
  balanced: boolean;
}

export interface CashBookRow {
  date: string;
  narration: string;
  account: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface CashBookResponse {
  rows: CashBookRow[];
  openingBalance: number;
}

export interface ReceiptPaymentRow {
  date: string;
  narration: string;
  account: string;
  partner: string | null;
  amount: number;
}

export interface ReceiptsPaymentsResponse {
  receipts: ReceiptPaymentRow[];
  payments: ReceiptPaymentRow[];
  totalReceipts: number;
  totalPayments: number;
}

// ── Sales / Purchase / Inventory ────────────────────────────────────────────

export type CostingMethod = "WEIGHTED_AVG" | "FIFO";

export interface Item {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  uom: string;
  hsnCode: string | null;
  isFinishedGood: boolean;
  isActive: boolean;
  stockAccount: { id: string; accountCode: string; accountName: string };
  salesRate: string | null;
  purchaseRate: string | null;
  taxRate: string;
  totalQuantityOnHand: number;
}

export interface DocumentLineInput {
  itemId: string;
  quantity: number;
  rate: number;
  taxRate?: number;
}

export interface DocumentLine extends DocumentLineInput {
  id: string;
  item: { id: string; sku: string; name: string };
  lineSubtotal: string;
  taxAmount: string;
  lineTotal: string;
}

export interface SalesInvoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  narration: string;
  businessPartner: { id: string; name: string };
  subtotal: string;
  taxTotal: string;
  grandTotal: string;
  totalCogs: string;
  lines: DocumentLine[];
}

export interface PurchaseBill {
  id: string;
  billNumber: string;
  billDate: string;
  narration: string;
  businessPartner: { id: string; name: string };
  subtotal: string;
  taxTotal: string;
  grandTotal: string;
  lines: DocumentLine[];
}

// ── Sales / Purchase Returns ─────────────────────────────────────────────
// Always tied to an original Sales Invoice / Purchase Bill — the "pick
// lines to return" screen reads a ReturnableLine per original line, capped
// by `remaining` (quantity - alreadyReturned across all prior returns).

export interface ReturnableLine {
  id: string; // the original SalesInvoiceLine / PurchaseBillLine id
  item: { id: string; sku: string; name: string; uom: string };
  quantity: number;
  rate: number;
  taxRate: number;
  unitCost?: number; // sales lines only — what COGS reversal will use
  alreadyReturned: number;
  remaining: number;
}

export interface SalesReturnableResponse {
  invoice: { id: string; invoiceNumber: string; businessPartner: { id: string; name: string } };
  lines: ReturnableLine[];
}

export interface PurchaseReturnableResponse {
  bill: { id: string; billNumber: string; businessPartner: { id: string; name: string } };
  lines: ReturnableLine[];
}

export interface SalesReturnLineInput {
  salesInvoiceLineId: string;
  quantity: number;
  condition: "GOOD" | "DAMAGED";
}

export interface PurchaseReturnLineInput {
  purchaseBillLineId: string;
  quantity: number;
}

export interface SalesReturn {
  id: string;
  returnNumber: string;
  returnDate: string;
  narration: string;
  businessPartner: { id: string; name: string };
  salesInvoice: { id: string; invoiceNumber: string };
  subtotal: string;
  taxTotal: string;
  grandTotal: string;
  totalCogsReversed: string;
  lines: (SalesReturnLineInput & { id: string; item: { id: string; sku: string; name: string }; lineTotal: string })[];
}

export interface PurchaseReturn {
  id: string;
  returnNumber: string;
  returnDate: string;
  narration: string;
  businessPartner: { id: string; name: string };
  purchaseBill: { id: string; billNumber: string };
  subtotal: string;
  taxTotal: string;
  grandTotal: string;
  lines: (PurchaseReturnLineInput & { id: string; item: { id: string; sku: string; name: string }; lineTotal: string })[];
}

export interface StockAdjustmentLineInput {
  itemId: string;
  direction: "IN" | "OUT";
  quantity: number;
  unitCost?: number;
}

export interface StockAdjustment {
  id: string;
  adjustmentDate: string;
  narration: string;
  lines: (StockAdjustmentLineInput & { id: string; item: { id: string; sku: string; name: string }; lineValue: string })[];
}

export interface StockLedgerRow {
  date: string;
  movementType: string;
  branch: string;
  quantity: number;
  unitCost: number;
  narration: string | null;
  referenceType: string | null;
  balance: number;
}

export interface StockLedgerResponse {
  item: { id: string; sku: string; name: string; uom: string };
  openingQuantity: number;
  rows: StockLedgerRow[];
}

export interface ValuationRow {
  item: { id: string; sku: string; name: string; uom: string };
  stockAccount: { accountCode: string; accountName: string };
  quantityOnHand: number;
  averageCost: number;
  value: number;
}

export interface ValuationResponse {
  costingMethod: CostingMethod | null;
  rows: ValuationRow[];
  totalValue: number;
}

// ── Team / user management ──────────────────────────────────────────────────

export type OrgRole = "OWNER" | "ADMIN" | "ACCOUNTANT" | "VIEWER";

export interface OrgMember {
  userId: string;
  role: OrgRole;
  branchId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  isVerified: boolean;
}

export interface OrgInvite {
  id: string;
  email: string | null;
  phone: string | null;
  role: OrgRole;
  expiresAt: string;
}

export interface OrgUsersResponse {
  members: OrgMember[];
  invites: OrgInvite[];
}

// ── Access control (menu visibility by role) ────────────────────────────────

/** role -> itemId -> enabled. Sparse — only overrides, never the full catalogue. */
export type MenuConfigMap = Record<string, Record<string, boolean>>;

export interface AccessControlMenuResponse {
  data: MenuConfigMap;
  organizationId: string;
  editableRoles: OrgRole[];
  allRoles: OrgRole[];
}

// ── Platform admin ───────────────────────────────────────────────────────────

export interface AdminOrgModule {
  code: string;
  name: string;
  status: "ACTIVE" | "TRIAL" | "CANCELLED";
  startsOn?: string;
  expiresOn: string | null;
  amount?: number | string | null;
}

export interface AdminOrganization {
  id: string;
  name: string;
  status: string;
  subscriptionStatus: "ACTIVE" | "SUSPENDED";
  domains: string[];
  branchCount: number;
  userCount: number;
  journalEntryCount: number;
  modules: AdminOrgModule[];
  createdAt: string;
}

export interface AdminOrgDetailUser {
  userId: string;
  role: string;
  email: string | null;
  phone: string | null;
  isVerified: boolean;
}

export interface AdminOrgDetailBranch {
  id: string;
  code: string;
  name: string;
  isHeadOffice: boolean;
  status: string;
}

export interface AdminOrganizationDetail {
  id: string;
  name: string;
  status: string;
  subscriptionStatus: "ACTIVE" | "SUSPENDED";
  createdAt: string;
  domains: { code: string; name: string; addedAt: string }[];
  branches: AdminOrgDetailBranch[];
  users: AdminOrgDetailUser[];
  modules: AdminOrgModule[];
  counts: { journalEntries: number; accounts: number; businessPartners: number };
}

export interface ModuleCatalogItem {
  code: string;
  name: string;
}

export interface SubscriptionOrgRow {
  id: string;
  name: string;
  modules: AdminOrgModule[];
}

export interface AdminSubscriptionsResponse {
  data: SubscriptionOrgRow[];
  catalog: ModuleCatalogItem[];
}

export interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string | null;
  createdAt: string;
  organization: { id: string; name: string } | null;
  actor: { id: string; email: string | null; phone: string | null } | null;
}

// ── Bulk upload (Template Download + Bulk Upload) ───────────────────────────
// One shared shape (BulkUploadPanel renders generically off `status`/`error`
// plus whatever columns each page tells it to show); each entity's row adds
// its own fields on top, mirroring the backend's *PreviewRow interfaces.

export interface BulkUploadRowBase {
  rowNum: number;
  status: "create" | "update" | "error";
  error?: string;
}

export interface CoaUploadRow extends BulkUploadRowBase {
  accountCode: string;
  accountName: string;
  accountType: string | null;
  subType: string | null;
  parentCode: string | null;
  isGroup: boolean;
  description: string | null;
  openingBalance: number | null;
  openingBalanceType: "DEBIT" | "CREDIT" | null;
  openingBalanceDate: string | null;
  isSystem?: boolean;
}

export interface ItemUploadRow extends BulkUploadRowBase {
  sku: string;
  name: string;
  description: string | null;
  uom: string;
  hsnCode: string | null;
  stockAccountCode: string | null;
  salesRate: number | null;
  purchaseRate: number | null;
  taxRate: number;
  openingQuantity: number;
  openingCost: number;
}

export interface BpUploadRow extends BulkUploadRowBase {
  bpType: "CUSTOMER" | "VENDOR" | null;
  code: string | null;
  name: string;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  openingBalance: number | null;
  openingBalanceType: "DEBIT" | "CREDIT" | null;
  openingBalanceDate: string | null;
}
