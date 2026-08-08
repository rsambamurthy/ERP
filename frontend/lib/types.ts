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
  // Schedule III Balance Sheet classification — see
  // ScheduleIIIHeadCode/SCHEDULE_III_HEADS below. Only meaningful for
  // ASSET/LIABILITY/EQUITY accounts; null means "not classified yet".
  scheduleIiiHead: string | null;
}

// ── Schedule III Balance Sheet ──────────────────────────────────────────────
// Mirrors backend/src/lib/scheduleIII.ts's catalog exactly — keep both in
// sync if the heads ever change.
export type ScheduleIIIGroup =
  | "SHAREHOLDERS_FUNDS"
  | "NON_CURRENT_LIABILITIES"
  | "CURRENT_LIABILITIES"
  | "NON_CURRENT_ASSETS"
  | "CURRENT_ASSETS";

export interface ScheduleIIIHeadDef {
  code: string;
  label: string;
  side: "EQUITY_AND_LIABILITIES" | "ASSETS";
  group: ScheduleIIIGroup;
  groupLabel: string;
  accountTypes: ("ASSET" | "LIABILITY" | "EQUITY")[];
}

export const SCHEDULE_III_HEADS: ScheduleIIIHeadDef[] = [
  { code: "SHARE_CAPITAL", label: "Share Capital", side: "EQUITY_AND_LIABILITIES", group: "SHAREHOLDERS_FUNDS", groupLabel: "Shareholders' Funds", accountTypes: ["EQUITY"] },
  { code: "RESERVES_AND_SURPLUS", label: "Reserves and Surplus", side: "EQUITY_AND_LIABILITIES", group: "SHAREHOLDERS_FUNDS", groupLabel: "Shareholders' Funds", accountTypes: ["EQUITY"] },
  { code: "LONG_TERM_BORROWINGS", label: "Long-Term Borrowings", side: "EQUITY_AND_LIABILITIES", group: "NON_CURRENT_LIABILITIES", groupLabel: "Non-Current Liabilities", accountTypes: ["LIABILITY"] },
  { code: "DEFERRED_TAX_LIABILITIES", label: "Deferred Tax Liabilities (Net)", side: "EQUITY_AND_LIABILITIES", group: "NON_CURRENT_LIABILITIES", groupLabel: "Non-Current Liabilities", accountTypes: ["LIABILITY"] },
  { code: "OTHER_LONG_TERM_LIABILITIES", label: "Other Long-Term Liabilities", side: "EQUITY_AND_LIABILITIES", group: "NON_CURRENT_LIABILITIES", groupLabel: "Non-Current Liabilities", accountTypes: ["LIABILITY"] },
  { code: "LONG_TERM_PROVISIONS", label: "Long-Term Provisions", side: "EQUITY_AND_LIABILITIES", group: "NON_CURRENT_LIABILITIES", groupLabel: "Non-Current Liabilities", accountTypes: ["LIABILITY"] },
  { code: "SHORT_TERM_BORROWINGS", label: "Short-Term Borrowings", side: "EQUITY_AND_LIABILITIES", group: "CURRENT_LIABILITIES", groupLabel: "Current Liabilities", accountTypes: ["LIABILITY"] },
  { code: "TRADE_PAYABLES", label: "Trade Payables", side: "EQUITY_AND_LIABILITIES", group: "CURRENT_LIABILITIES", groupLabel: "Current Liabilities", accountTypes: ["LIABILITY"] },
  { code: "OTHER_CURRENT_LIABILITIES", label: "Other Current Liabilities", side: "EQUITY_AND_LIABILITIES", group: "CURRENT_LIABILITIES", groupLabel: "Current Liabilities", accountTypes: ["LIABILITY"] },
  { code: "SHORT_TERM_PROVISIONS", label: "Short-Term Provisions", side: "EQUITY_AND_LIABILITIES", group: "CURRENT_LIABILITIES", groupLabel: "Current Liabilities", accountTypes: ["LIABILITY"] },
  { code: "FIXED_ASSETS", label: "Fixed Assets", side: "ASSETS", group: "NON_CURRENT_ASSETS", groupLabel: "Non-Current Assets", accountTypes: ["ASSET"] },
  { code: "NON_CURRENT_INVESTMENTS", label: "Non-Current Investments", side: "ASSETS", group: "NON_CURRENT_ASSETS", groupLabel: "Non-Current Assets", accountTypes: ["ASSET"] },
  { code: "DEFERRED_TAX_ASSETS", label: "Deferred Tax Assets (Net)", side: "ASSETS", group: "NON_CURRENT_ASSETS", groupLabel: "Non-Current Assets", accountTypes: ["ASSET"] },
  { code: "LONG_TERM_LOANS_AND_ADVANCES", label: "Long-Term Loans and Advances", side: "ASSETS", group: "NON_CURRENT_ASSETS", groupLabel: "Non-Current Assets", accountTypes: ["ASSET"] },
  { code: "OTHER_NON_CURRENT_ASSETS", label: "Other Non-Current Assets", side: "ASSETS", group: "NON_CURRENT_ASSETS", groupLabel: "Non-Current Assets", accountTypes: ["ASSET"] },
  { code: "CURRENT_INVESTMENTS", label: "Current Investments", side: "ASSETS", group: "CURRENT_ASSETS", groupLabel: "Current Assets", accountTypes: ["ASSET"] },
  { code: "INVENTORIES", label: "Inventories", side: "ASSETS", group: "CURRENT_ASSETS", groupLabel: "Current Assets", accountTypes: ["ASSET"] },
  { code: "TRADE_RECEIVABLES", label: "Trade Receivables", side: "ASSETS", group: "CURRENT_ASSETS", groupLabel: "Current Assets", accountTypes: ["ASSET"] },
  { code: "CASH_AND_CASH_EQUIVALENTS", label: "Cash and Cash Equivalents", side: "ASSETS", group: "CURRENT_ASSETS", groupLabel: "Current Assets", accountTypes: ["ASSET"] },
  { code: "SHORT_TERM_LOANS_AND_ADVANCES", label: "Short-Term Loans and Advances", side: "ASSETS", group: "CURRENT_ASSETS", groupLabel: "Current Assets", accountTypes: ["ASSET"] },
  { code: "OTHER_CURRENT_ASSETS", label: "Other Current Assets", side: "ASSETS", group: "CURRENT_ASSETS", groupLabel: "Current Assets", accountTypes: ["ASSET"] },
];

export interface ScheduleIIILineItem {
  accountId: string;
  accountCode: string;
  accountName: string;
  amount: number;
}

export interface ScheduleIIIHeadResult {
  code: string;
  label: string;
  items: ScheduleIIILineItem[];
  total: number;
}

export interface ScheduleIIIGroupResult {
  group: ScheduleIIIGroup;
  groupLabel: string;
  heads: ScheduleIIIHeadResult[];
  total: number;
}

export interface ScheduleIIIBalanceSheet {
  asOf: string | null;
  equityAndLiabilities: { groups: ScheduleIIIGroupResult[]; total: number };
  assets: { groups: ScheduleIIIGroupResult[]; total: number };
  unclassified: { assets: ScheduleIIILineItem[]; liabilities: ScheduleIIILineItem[]; equity: ScheduleIIILineItem[]; total: number };
  balanced: boolean;
  difference: number;
}

// ── Company Master ───────────────────────────────────────────────────────

export interface Director {
  id: string;
  name: string;
  din: string | null;
  designation: string | null;
  appointmentDate: string | null;
  cessationDate: string | null;
  isActive: boolean;
}

export interface Auditor {
  id: string;
  name: string;
  membershipNumber: string | null;
  firmRegistrationNumber: string | null;
  appointmentDate: string | null;
  tenureEndDate: string | null;
  isActive: boolean;
}

export interface CompanyMaster {
  id: string;
  name: string;
  cin: string | null;
  companyPan: string | null;
  companyType: string | null;
  incorporationDate: string | null;
  registeredOfficeAddress: string | null;
  directors: Director[];
  auditors: Auditor[];
}

export interface BusinessPartner {
  id: string;
  bpType: "CUSTOMER" | "VENDOR" | "ITEM";
  name: string;
  gstin: string | null;
  // GST state code — auto-filled from gstin's first 2 characters when set,
  // independently editable. See Branch.stateCode for what it feeds.
  stateCode: string | null;
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
  // Sequential JV-0001/BV-0001/CV-0001 style code — null for auto-posted
  // entries (referenceType set), which show their sibling document's own
  // number instead (see salesInvoice/purchaseBill/etc. below).
  voucherNumber: string | null;
  referenceType: string | null;
  branchId: string | null;
  attachmentFilename: string | null;
  attachmentMimeType: string | null;
  attachmentSize: number | null;
  journalLines: JournalLine[];
  salesInvoice?: { invoiceNumber: string } | null;
  purchaseBill?: { billNumber: string } | null;
  salesReturn?: { returnNumber: string } | null;
  purchaseReturn?: { returnNumber: string } | null;
  stockAdjustment?: { id: string } | null;
}

export interface Gstr1B2BRow {
  gstin: string;
  receiverName: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceValue: number;
  placeOfSupply: string;
  rate: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface Gstr1B2CRow {
  placeOfSupply: string;
  rate: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface Gstr1HsnRow {
  hsnCode: string;
  description: string;
  uom: string;
  rate: number;
  quantity: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface Gstr1CreditNoteRow {
  noteNumber: string;
  noteDate: string;
  originalInvoiceNumber: string;
  gstin: string | null;
  receiverName: string;
  placeOfSupply: string;
  rate: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface Gstr1Report {
  from: string;
  to: string;
  b2b: Gstr1B2BRow[];
  b2c: Gstr1B2CRow[];
  hsn: Gstr1HsnRow[];
  creditNotes: Gstr1CreditNoteRow[];
  totals: { taxableValue: number; cgst: number; sgst: number; igst: number; invoiceValue: number };
}

export interface Gstr3bSection {
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface Gstr3bReport {
  from: string;
  to: string;
  outward: Gstr3bSection;
  itc: Gstr3bSection;
  netPayable: { cgst: number; sgst: number; igst: number; total: number };
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
  // Seeds a Sales Invoice line's discount % when this item is picked —
  // freely overridable on the line itself.
  defaultDiscountPct: string;
  totalQuantityOnHand: number;
}

export type DiscountType = "PERCENT" | "FLAT";

export interface DocumentLineInput {
  itemId: string;
  quantity: number;
  rate: number;
  // Foreign-currency Sales Invoices / Purchase Bills only — the unit rate
  // as entered, in the document's currency. See CURRENCIES below and the
  // currency handling note on SalesInvoice/PurchaseBill.
  rateFc?: number;
  taxRate?: number;
}

// ── Foreign currency (exports/imports) ───────────────────────────────────
// Fixed list — mirrors backend/src/lib/currencies.ts by hand (same
// duplication convention as SCHEDULE_III_HEADS; no shared package between
// the two apps). Exchange rate is always manual entry — see the backend
// file's comment for why there's no live FX API.
export interface CurrencyDef {
  code: string;
  symbol: string;
  name: string;
}

export const SUPPORTED_CURRENCIES: CurrencyDef[] = [
  { code: "INR", symbol: "₹", name: "Indian Rupee" },
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "EUR", symbol: "€", name: "Euro" },
  { code: "GBP", symbol: "£", name: "British Pound" },
  { code: "AED", symbol: "AED", name: "UAE Dirham" },
  { code: "SGD", symbol: "S$", name: "Singapore Dollar" },
  { code: "JPY", symbol: "¥", name: "Japanese Yen" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar" },
  { code: "CAD", symbol: "C$", name: "Canadian Dollar" },
  { code: "CHF", symbol: "CHF", name: "Swiss Franc" },
  { code: "CNY", symbol: "¥", name: "Chinese Yuan" },
];

export function currencySymbol(code: string): string {
  return SUPPORTED_CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
}

// Sales Invoice lines additionally carry a discount — Purchase Bill lines
// stay DocumentLineInput as-is (no discount concept — see ROADMAP.md).
export interface SalesLineInput extends DocumentLineInput {
  discountType?: DiscountType | null;
  discountValue?: number;
}

export interface DocumentLine extends DocumentLineInput {
  id: string;
  item: { id: string; sku: string; name: string };
  lineSubtotal: string; // gross, qty*rate
  taxAmount: string; // cgstAmount + sgstAmount + igstAmount
  lineTotal: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  // Display-only — null for INR documents. See SalesInvoice.grandTotalFc.
  lineTotalFc?: string | null;
}

export interface SalesInvoiceLine extends DocumentLine, SalesLineInput {
  lineDiscountAmount: string;
  invoiceDiscountShare: string;
  taxableValue: string;
}

export interface SalesInvoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  narration: string;
  businessPartner: { id: string; name: string };
  subtotal: string; // gross, pre-discount
  taxTotal: string;
  grandTotal: string;
  totalCogs: string;
  discountType: DiscountType | null;
  discountValue: string;
  discountTotal: string;
  cgstTotal: string;
  sgstTotal: string;
  igstTotal: string;
  // Foreign currency (exports) — currency is "INR" and grandTotalFc is null
  // for every domestic invoice. grandTotalFc is display-only; grandTotal
  // (INR) is what accounting/GST/reports use.
  currency: string;
  exchangeRate: string;
  grandTotalFc: string | null;
  lines: SalesInvoiceLine[];
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
  cgstTotal: string;
  sgstTotal: string;
  igstTotal: string;
  currency: string;
  exchangeRate: string;
  grandTotalFc: string | null;
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

// "CUSTOM" means an org-defined role — see CustomRole below. OWNER/ADMIN/
// ACCOUNTANT/VIEWER stay fixed; their permissions aren't editable.
export type OrgRole = "OWNER" | "ADMIN" | "ACCOUNTANT" | "VIEWER" | "CUSTOM";

export type MemberStatus = "ACTIVE" | "SUSPENDED";

export interface OrgMember {
  userId: string;
  role: OrgRole;
  customRoleId: string | null;
  customRoleName: string | null;
  branchId: string | null;
  status: MemberStatus;
  name: string | null;
  email: string | null;
  phone: string | null;
  isVerified: boolean;
  // Interim employee-details fields, OWNER/ADMIN-entered — see
  // migration_012. aadharMasked is always "XXXX XXXX 1234" form or null,
  // the full number is never returned by the API.
  address: string | null;
  pan: string | null;
  aadharMasked: string | null;
}

export interface BranchSummary {
  id: string;
  code: string;
  name: string;
  isHeadOffice: boolean;
}

export type BranchStatus = "ACTIVE" | "INACTIVE";

export interface Branch {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  gstin: string | null;
  // GST state code — auto-filled from gstin's first 2 characters when set,
  // independently editable (a branch has a state even without a GSTIN).
  // Compared against the counterparty's stateCode at Sales/Purchase
  // posting time to decide CGST+SGST vs IGST.
  stateCode: string | null;
  phone: string | null;
  email: string | null;
  address: unknown;
  isHeadOffice: boolean;
  status: BranchStatus;
  createdAt: string;
}

// ── Own profile / password ──────────────────────────────────────────────────

export interface MyProfile {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  isPlatformAdmin: boolean;
  createdAt: string;
}

export interface OrgInvite {
  id: string;
  email: string | null;
  phone: string | null;
  role: OrgRole;
  customRoleId: string | null;
  customRoleName: string | null;
  expiresAt: string;
}

export interface OrgUsersResponse {
  members: OrgMember[];
  invites: OrgInvite[];
}

// ── Custom roles (module-level permissions) ─────────────────────────────────

// Mirrors backend/src/lib/permissions.ts's PERMISSIONS catalogue exactly.
// Deliberately excludes team/role management and menu-visibility config —
// see migration_009's note on why those two stay OWNER/ADMIN-only rather
// than being grantable to a custom role.
export const PERMISSIONS = [
  "coa.manage",
  "items.manage",
  "businessPartners.manage",
  "branches.manage",
  "sales.post",
  "purchase.post",
  "inventory.post",
  "journal.post",
  "company.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "coa.manage": "Manage Chart of Accounts",
  "items.manage": "Manage Items",
  "businessPartners.manage": "Manage Business Partners (Customers/Vendors)",
  "branches.manage": "Manage Branches",
  "sales.post": "Post Sales Invoices & Sales Returns",
  "purchase.post": "Post Purchase Bills & Purchase Returns",
  "inventory.post": "Post Stock Adjustments",
  "journal.post": "Post Journal Entries",
  "company.manage": "Manage Company Master Data (CIN, directors, auditors)",
};

export interface CustomRole {
  id: string;
  organizationId: string;
  name: string;
  permissions: Permission[];
  createdAt: string;
  updatedAt: string;
}

// ── Access control (menu visibility by role) ────────────────────────────────

/** role -> itemId -> enabled. Sparse — only overrides, never the full catalogue. */
export type MenuConfigMap = Record<string, Record<string, boolean>>;

// One configurable target in the Access Control screen — either a fixed
// role (value is the plain role name, permissions is null) or a custom role
// (value is "custom:<org_roles.id>", permissions is that role's granted
// set, used to compute its default — absent an override — visibility per
// item; see AccessControlMatrix.tsx).
export interface EditableRoleOption {
  value: string;
  label: string;
  permissions: Permission[] | null;
}

export interface AccessControlMenuResponse {
  data: MenuConfigMap;
  organizationId: string;
  editableRoles: EditableRoleOption[];
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
  customRoleName: string | null;
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
