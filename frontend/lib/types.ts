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
  // Purchase Order approval workflow — null means every submitted PO
  // requires manual approval regardless of amount. See
  // PurchaseOrder.status and the "Purchase Order Workflow" ROADMAP section.
  poApprovalThreshold: string | null;
  // 3-way match price tolerance — null means 0%, any variance between a
  // Purchase Bill line's rate and its Purchase Order line's rate requires
  // approval. See PurchaseBill.status and PurchaseBill.varianceNote.
  priceVarianceTolerancePct: string | null;
  // Sales Order approval workflow — the exact sales-side mirror of
  // poApprovalThreshold. See SalesOrder.status below.
  soApprovalThreshold: string | null;
  directors: Director[];
  auditors: Auditor[];
}

// ── Vendor Management (Phase 1) ──────────────────────────────────────────
// Multiple contacts / labeled addresses / bank accounts, plus a minimal
// single-step approval workflow — all on the existing BusinessPartner
// (bp_type = 'VENDOR') record. See backend/db/migration_028.
export type ApprovalStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED";

// Suggestions only (datalist, not a select) — vendorCategory/taxIdType are
// unconstrained VARCHAR columns (see migration_028's comment on
// tax_id_type), same "app-layer dropdown, no DB CHECK" convention as
// openingBalanceType. Free text always wins, so a vendor from any country
// or with any category not listed here still works.
export const VENDOR_CATEGORIES = [
  "Raw Material", "Packaging", "Services", "Contractor", "Logistics & Freight",
  "IT / Software", "Capital Goods / Equipment", "Consumables", "Other",
];

export const TAX_ID_TYPE_SUGGESTIONS = [
  "PAN", "EIN (US)", "GST/HST No. (Canada)", "VAT No.", "ABN (Australia)", "Tax Registration No.", "Other",
];

// Address.country suggestions — a free-text field, not a fixed catalogue
// like SUPPORTED_CURRENCIES; new countries need no code change here.
export const COMMON_COUNTRIES = [
  "India", "United States", "Canada", "United Kingdom", "Germany", "UAE",
  "Singapore", "Australia", "China", "Japan", "France", "Netherlands",
];

export interface VendorContact {
  id: string;
  businessPartnerId: string;
  name: string;
  designation: string | null;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
  createdAt: string;
}

export interface VendorAddress {
  id: string;
  businessPartnerId: string;
  label: string;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  pincode: string | null;
  country: string;
  isPrimary: boolean;
  createdAt: string;
}

export interface VendorBankAccount {
  id: string;
  businessPartnerId: string;
  accountHolderName: string | null;
  bankName: string | null;
  accountNumber: string | null;
  ifscCode: string | null;
  swiftCode: string | null;
  routingNumber: string | null;
  branchName: string | null;
  isPrimary: boolean;
  createdAt: string;
}

// Narrow projection from GET /business-partners/lookup — enough to render
// and filter a partner picker, and nothing else. Kept separate from
// BusinessPartner so a screen can't accidentally read a field the lookup
// endpoint doesn't send.
export interface BusinessPartnerLookup {
  id: string;
  code: string | null;
  name: string;
  phone: string | null;
  bpType: "CUSTOMER" | "VENDOR" | "ITEM";
  // Not displayed by the picker — carried because Sales Invoice and Purchase
  // Bill compute CGST+SGST vs IGST from it (isInterState). See the matching
  // comment on the lookup route's select.
  stateCode: string | null;
}

export interface BusinessPartner {
  id: string;
  bpType: "CUSTOMER" | "VENDOR" | "ITEM";
  code: string | null;
  name: string;
  gstin: string | null;
  // GST state code — auto-filled from gstin's first 2 characters when set,
  // independently editable. See Branch.stateCode for what it feeds.
  stateCode: string | null;
  phone: string | null;
  email: string | null;
  address: { full?: string } | null;
  openingBalance: string;
  openingBalanceType: BalanceType | null;
  isActive: boolean;
  // Only meaningful for bpType VENDOR — harmless/unused on CUSTOMER.
  vendorCategory: string | null;
  approvalStatus: ApprovalStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  // International tax registration (EIN / GST-HST / VAT / ...) — separate
  // from gstin, never fed into the India GST engine. Display-only.
  taxIdType: string | null;
  taxId: string | null;
  createdAt: string;
  // Present on GET /business-partners/:id (detail), absent on the list
  // endpoint's rows.
  vendorContacts?: VendorContact[];
  vendorAddresses?: VendorAddress[];
  vendorBankAccounts?: VendorBankAccount[];
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

export interface Gstr1ExportRow {
  invoiceNumber: string;
  invoiceDate: string;
  invoiceValue: number;
  shippingBillNumber: string | null;
  shippingBillDate: string | null;
  portCode: string | null;
  rate: number;
  taxableValue: number;
  igst: number;
  exportType: "WPAY" | "WOPAY";
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
  exports: Gstr1ExportRow[];
  hsn: Gstr1HsnRow[];
  creditNotes: Gstr1CreditNoteRow[];
  totals: { taxableValue: number; cgst: number; sgst: number; igst: number; invoiceValue: number };
  exportsTotal: { taxableValue: number; igst: number; invoiceValue: number };
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
  // STOCK or SERVICE — see migration_029. A SERVICE item debits an EXPENSE
  // account and never moves stock; it exists so a GST-bearing expense can go
  // through a Purchase Bill and therefore produce ITC. Purchase-only: every
  // sales, PO and stock-adjustment route rejects one server-side.
  itemKind: "STOCK" | "SERVICE";
  isFinishedGood: boolean;
  isActive: boolean;
  // For STOCK this is the stock control account; for SERVICE it's the
  // expense account the bill line debits. Same column either way.
  stockAccount: { id: string; accountCode: string; accountName: string };
  // Set means this item is capital by nature — a conference table, a laptop.
  // Its Purchase Bill line arrives capitalised against this class instead of
  // debiting stockAccount, so an asset's cost cannot land in the P&L just
  // because someone forgot to tick a box. SERVICE items only.
  defaultAssetClass: ItemAssetClassRef | null;
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
  // Purchase Bill (import) lines only — Basic Customs Duty, as a % of this
  // line's INR taxable value. See customsDutyAmount on DocumentLine and the
  // PurchaseBill.customsDutyTotal note below.
  customsDutyRate?: number;
  // Purchase Bill lines only — which GoodsReceiptNoteLine this line bills
  // against, when the bill is raised from an approved PO (3-way match:
  // PO -> GRN -> Bill). Required on every line whenever the bill itself
  // carries a purchaseOrderId — see GoodsReceiptNote below and
  // ROADMAP.md's "Goods Receipt Note" section. The PurchaseOrderLine it
  // fulfills is derived server-side from this, never sent directly.
  goodsReceiptNoteLineId?: string;
  // Sales Invoice lines only — the sales-side mirror of
  // goodsReceiptNoteLineId: which DeliveryNoteLine this line invoices
  // against, when the invoice is raised from an approved SO (3-way match:
  // SO -> DN -> Invoice). Required on every line whenever the invoice
  // itself carries a salesOrderId — see DeliveryNote below.
  deliveryNoteLineId?: string;
  // Purchase Bill service lines only — spread this line over time instead of
  // expensing it now. The line debits Prepaid Expenses (1105) and a schedule
  // releases it to the item's expense head one month at a time. See
  // migration_032. Tax is untouched: the full ITC is still claimed in the
  // month the bill is booked.
  prepaid?: boolean;
  // "YYYY-MM" — the month the first instalment belongs to.
  prepaidStartMonth?: string;
  prepaidMonths?: number;
  // Purchase Bill service lines only — this line buys a fixed asset rather
  // than an expense. The line debits the asset class's cost account instead
  // of the item's own head and opens a row in the fixed asset register. See
  // migration_034. Mutually exclusive with prepaid.
  //
  // One line is one asset, whatever the quantity: three laptops that will be
  // disposed of separately need three lines.
  capitalise?: boolean;
  assetClassId?: string;
  // Defaults to the item's name server-side.
  assetName?: string;
  // "YYYY-MM-DD" — when the asset was put to use, which is what Schedule II
  // depreciates from. Never earlier than the bill date.
  inUseDate?: string;
  // NOTE: no useful life here either. A company adopting a life shorter than
  // Schedule II is making one policy decision, not one per purchase, so it
  // lives on the asset class under Configuration > Depreciation — with its
  // justification, which every asset copies at capitalisation.
  // NOTE: no method here. The depreciation method is a company policy, not a
  // per-purchase choice — see DepreciationPolicy below. The useful life is
  // the opposite: Schedule II is about the life of a particular asset.
  //
  // Part A paragraph 3(i): a life differing from the PRESCRIBED one — longer
  // or shorter — must be disclosed and justified with technical advice.
  usefulLifeNote?: string;
}

// The company's depreciation method and every time it changed.
//
// Changing it is permitted and prospective: under AS 10 (revised) and
// Ind AS 16 a change of method is a change in accounting ESTIMATE, so posted
// charges stand and are never restated. The reason is not optional — a
// change in estimate is disclosable.
export interface DepreciationMethodChange {
  id: string;
  // null means the change applies company-wide; a class means it applies to
  // that class alone, which then keeps its method when the company changes.
  assetClass: { id: string; name: string } | null;
  fromMethod: string;
  toMethod: string;
  // "YYYY-MM" — the first month the new method applies to.
  effectiveMonth: string;
  reason: string;
  recordedAt: string;
}

// Set on an Item that is capital by nature. Its Purchase Bill line arrives
// capitalised against this class — see migration_037.
export interface ItemAssetClassRef {
  id: string;
  name: string;
}

// ── Fixed asset register ─────────────────────────────────────────────────
//
// Read-only. An asset is created by capitalising a Purchase Bill line and is
// never edited: its cost, life, method, residual and accounts were all fixed
// at capitalisation, and everything afterwards happens through depreciation
// runs and disposal.
//
// Gross block, accumulated depreciation and net block are shown separately
// because Schedule III requires exactly that. Accumulated depreciation is
// summed from what actually posted rather than stored, so it cannot drift
// from the ledger.

export interface FixedAssetSummary {
  id: string;
  assetCode: string;
  name: string;
  assetClass: { id: string; name: string };
  branch: { id: string; name: string } | null;
  assetAccount: { accountCode: string; accountName: string };
  vendor: string | null;
  billNumber: string | null;
  purchaseDate: string | null;
  inUseDate: string | null;
  method: string;
  usefulLifeMonths: number;
  scheduleIiLifeMonths: number;
  // The set an auditor asks for: assets whose life departs from Schedule II.
  departsFromScheduleII: boolean;
  grossCost: number;
  residualValue: number;
  accumulatedDepreciation: number;
  netBookValue: number;
  periodsPosted: number;
  status: string;
}

// One period of a projected schedule. Not a posted charge — see
// DepreciationSchedule.
export interface DepreciationSchedulePeriod {
  periodStart: string;
  periodEnd: string;
  frequency: string;
  // Fewer than the days in the period only for the first one, which is
  // charged pro rata from the date the asset was put to use.
  daysCharged: number;
  daysInPeriod: number;
  openingWdv: number;
  amount: number;
  closingWdv: number;
  // True when this period has actually been charged, in which case the
  // figures above are the ledger's rather than the projection's.
  posted: boolean;
}

// The whole life of an asset, period by period. A projection computed from
// the asset as it stands and the company's current frequency — a policy
// change before a period is charged will change it.
export interface DepreciationSchedule {
  assetCode: string;
  name: string;
  method: string;
  frequency: string;
  usefulLifeMonths: number;
  grossCost: number;
  residualValue: number;
  periods: DepreciationSchedulePeriod[];
}

export interface FixedAssetRun {
  id: string;
  periodStart: string | null;
  periodEnd: string | null;
  frequency: string;
  amount: number;
  openingWdv: number;
  closingWdv: number;
  runType: string;
  journalEntryId: string;
  generatedAt: string;
}

export interface FixedAssetDetail extends Omit<FixedAssetSummary, "vendor" | "billNumber" | "periodsPosted"> {
  // This asset's sub-ledger card. Both balance-sheet accounts are tagged to
  // it, so one asset's gross block and accumulated depreciation are readable
  // from the ledger itself rather than only from this table.
  card: { id: string; name: string };
  accumDepAccount: { accountCode: string; accountName: string };
  depExpenseAccount: { accountCode: string; accountName: string };
  purchaseBill: {
    id: string; billNumber: string; billDate: string | null;
    vendor: { id: string; name: string } | null;
  } | null;
  // Copied from the asset class at capitalisation, so the Part A paragraph
  // 3(i) disclosure stays with the asset even if the class is edited later.
  usefulLifeNote: string | null;
  gstCapitalised: boolean;
  disposalDate: string | null;
  disposalProceeds: number | null;
  runs: FixedAssetRun[];
}

// One asset class as Configuration > Depreciation shows it. usefulLifeMonths
// is what this company has adopted; scheduleIiLifeMonths is what the
// Companies Act prescribes. When they differ, lifePolicyNote is the Part A
// paragraph 3(i) justification and is required.
export interface DepreciationClassConfig {
  id: string;
  name: string;
  isActive: boolean;
  scheduleIiLifeMonths: number;
  usefulLifeMonths: number;
  lifePolicyNote: string | null;
  residualPct: number;
  assetAccount: { accountCode: string; accountName: string };
  // What this class depreciates on today — its own method where it has one,
  // otherwise the company's.
  method: string;
  differsFromCompany: boolean;
}

export type DepreciationFrequency = "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL";

export interface DepreciationPolicy {
  currentMethod: string;
  frequency: string;
  // Below this a capitalised line is expensed instead. Zero means no
  // threshold.
  capitalisationThreshold: number;
  // "YYYY-MM", or null when nothing has ever been depreciated. A change can
  // never take effect on or before this month.
  lastPostedChargeMonth: string | null;
  earliestEffectiveMonth: string;
  changes: DepreciationMethodChange[];
  classes: DepreciationClassConfig[];
}

// One row of GET /asset-classes — the defaults an asset is created from.
// Income tax depreciation is out of scope, so no block code or rate here:
// depreciation is Schedule II only.
export interface AssetClassSummary {
  id: string;
  name: string;
  isActive: boolean;
  defaultUsefulLifeMonths: number;
  // What Schedule II prescribes, as against what this org's class says. A
  // deviation is measured against this one, never the editable default.
  scheduleIiLifeMonths: number;
  defaultMethod: string;
  defaultResidualPct: number;
  assetAccount: { id: string; accountCode: string; accountName: string };
  accumDepAccount: { id: string; accountCode: string; accountName: string };
  depExpenseAccount: { id: string; accountCode: string; accountName: string };
}

// Read-only result of POST /purchase-bills/extract-invoice — a vendor
// invoice (PDF/image) read by AI. Never posted directly: the frontend
// either auto-fills header fields (manual-entry bills) or matches these
// lines against GRN-derived lines for a comparison (PO-linked bills). See
// app/purchase/bills/page.tsx.
export interface ExtractedInvoiceLine {
  description: string;
  quantity: number;
  rate: number;
  amount: number;
}

export interface ExtractedInvoice {
  vendorName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  currency: string;
  grandTotal: number | null;
  lines: ExtractedInvoiceLine[];
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
  // Purchase Bill (import) lines only — computed Basic Customs Duty ₹
  // amount, folded into landed cost. Undefined on Sales Invoice lines,
  // "0.00" on a domestic Purchase Bill line.
  customsDutyAmount?: string;
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
  // Export declaration — null for a domestic (INR) invoice. See
  // ExportType below and the enforcement rules on POST /sales-invoices
  // (LUT/BOND must be zero-rated; WPAY may carry tax).
  exportType: ExportType | null;
  lutBondNumber: string | null;
  lutBondDate: string | null;
  // Almost always filled in later via PATCH, not at creation — see
  // routes/salesInvoices.ts. Null for a domestic invoice or an export that
  // hasn't shipped yet.
  shippingBillNumber: string | null;
  shippingBillDate: string | null;
  portCode: string | null;
  // Set when this invoice was raised against an approved Sales Order —
  // see SalesOrder below and routes/salesInvoices.ts's POST / handler.
  salesOrderId: string | null;
  salesOrder?: { id: string; soNumber: string } | null;
  lines: SalesInvoiceLine[];
}

export type ExportType = "LUT" | "BOND" | "WPAY";

export const EXPORT_TYPE_LABELS: Record<ExportType, string> = {
  LUT: "LUT (Letter of Undertaking) — zero-rated",
  BOND: "Bond — zero-rated",
  WPAY: "With Payment of IGST (claimed back as refund)",
};

// POSTED (default — journal entry + stock/billedQuantity impact already
// happened, exactly like every bill before this status existed) |
// PENDING_APPROVAL (PO-linked bill whose rate varies from the PO by more
// than Organization.priceVarianceTolerancePct — held with no journal
// entry, no stock movement, no billedQuantity impact until approved) |
// REJECTED (terminal — never posts; this app has no bill-edit capability,
// so correct the numbers on a fresh bill instead). See
// routes/purchaseBills.ts and ROADMAP.md's "3-Way Match" section.
export type PurchaseBillStatus = "POSTED" | "PENDING_APPROVAL" | "REJECTED";

export const PURCHASE_BILL_STATUS_LABELS: Record<PurchaseBillStatus, string> = {
  POSTED: "Posted",
  PENDING_APPROVAL: "Pending Approval",
  REJECTED: "Rejected",
};

export interface PurchaseBill {
  id: string;
  billNumber: string;
  billDate: string;
  narration: string;
  status: PurchaseBillStatus;
  // Server-generated — which line(s) exceeded the price tolerance and by
  // how much. Only ever set on a PENDING_APPROVAL (or since-approved) bill.
  varianceNote: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
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
  // Basic Customs Duty — non-creditable, folds into landed inventory cost.
  // "0.00" on a domestic bill. Import IGST is computed on (goods value +
  // duty) and, together with customsDutyTotal, credits a separate Customs
  // Duty Payable account rather than Trade Payables (see
  // routes/purchaseBills.ts) — grandTotal = subtotal + taxTotal +
  // customsDutyTotal, but Trade Payables only ever reflects `subtotal` on
  // an import.
  customsDutyTotal: string;
  // Same rationale as SalesInvoice.shippingBillNumber — almost always
  // filled in later via PATCH once customs clearance actually happens.
  billOfEntryNumber: string | null;
  billOfEntryDate: string | null;
  portCode: string | null;
  // Set when this bill was raised against an approved Purchase Order —
  // see PurchaseOrder below and routes/purchaseBills.ts's POST / handler.
  purchaseOrderId: string | null;
  purchaseOrder?: { id: string; poNumber: string } | null;
  lines: DocumentLine[];
}

// ── Purchase Order ───────────────────────────────────────────────────────
// A pre-commitment/approval document, entirely separate from posting — see
// backend/prisma/schema.prisma's PurchaseOrder model comment for the full
// status state machine and ROADMAP.md's "Purchase Order Workflow" section.
export type PurchaseOrderStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "CANCELLED" | "CLOSED";

export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending Approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  CLOSED: "Closed (fully billed)",
};

export interface PurchaseOrderLineInput {
  itemId: string;
  quantity: number;
  rate: number;
  // Foreign-currency POs only — the unit rate as entered, in the PO's
  // currency. See PurchaseOrder.currency below.
  rateFc?: number;
  taxRate?: number;
}

export interface PurchaseOrderLine extends PurchaseOrderLineInput {
  id: string;
  item: { id: string; sku: string; name: string };
  lineSubtotal: string;
  taxAmount: string;
  lineTotal: string;
  // Display-only — null for an INR PO. See PurchaseOrder.grandTotalFc.
  lineTotalFc?: string | null;
  // Running total already received against this line across every Goods
  // Receipt Note — never exceeds `quantity`. This is the real stock-in
  // signal; billedQuantity below is the separate, always-lagging-or-equal
  // financial side. See GoodsReceiptNote below.
  receivedQuantity: string;
  // Running total already billed against this line across every linked
  // Purchase Bill — never exceeds `quantity`.
  billedQuantity: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  poDate: string;
  expectedDeliveryDate: string | null;
  narration: string;
  status: PurchaseOrderStatus;
  businessPartner: { id: string; name: string };
  branch?: { id: string; name: string } | null;
  subtotal: string;
  taxTotal: string;
  grandTotal: string;
  // Foreign currency (imports) — currency is "INR" and grandTotalFc is
  // null for every domestic PO. A Purchase Bill raised against this PO
  // derives its own currency from here — see purchaseOrderId on
  // PurchaseBill/createPurchaseBill.
  currency: string;
  exchangeRate: string;
  grandTotalFc: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  autoApproved: boolean;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  lines: PurchaseOrderLine[];
  // Every Purchase Bill raised against this PO so far — the detail screen
  // shows this as the billing progress trail.
  purchaseBills?: { id: string; billNumber: string; billDate: string; grandTotal: string }[];
  // Every Goods Receipt Note raised against this PO so far — the detail
  // screen shows this as the receiving progress trail, alongside billing.
  goodsReceiptNotes?: { id: string; grnNumber: string; grnDate: string }[];
}

// ── Goods Receipt Note ───────────────────────────────────────────────────
// Records physical receipt of goods against an APPROVED Purchase Order —
// this, not the eventual Purchase Bill, is what actually moves stock. See
// backend/prisma/schema.prisma's GoodsReceiptNote model comment and
// ROADMAP.md's "Goods Receipt Note" section for the full design. Posts
// immediately on creation — no draft/approval workflow of its own.
export interface GoodsReceiptNoteLineInput {
  purchaseOrderLineId: string;
  quantityReceived: number;
}

export interface GoodsReceiptNoteLine extends GoodsReceiptNoteLineInput {
  id: string;
  item: { id: string; sku: string; name: string };
  // Only populated on the detail fetch (GET /goods-receipt-notes/:id) —
  // the list endpoint doesn't include this relation, so it's absent there.
  purchaseOrderLine?: { id: string; quantity: string };
  unitCost: string;
  // Running total already billed against this specific GRN line — never
  // exceeds quantityReceived. This is the 3-way match Purchase Bill
  // enforces (see DocumentLineInput.goodsReceiptNoteLineId).
  billedQuantity: string;
}

export interface GoodsReceiptNote {
  id: string;
  grnNumber: string;
  grnDate: string;
  narration: string;
  businessPartner: { id: string; name: string };
  branch?: { id: string; name: string } | null;
  purchaseOrder: { id: string; poNumber: string };
  lines: GoodsReceiptNoteLine[];
}

// ── Sales Order ──────────────────────────────────────────────────────────
// The sales-side mirror of PurchaseOrder — same status state machine and
// pre-commitment/no-posting design. See backend/prisma/schema.prisma's
// SalesOrder model comment for the full details.
export type SalesOrderStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "CANCELLED" | "CLOSED";

export const SALES_ORDER_STATUS_LABELS: Record<SalesOrderStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending Approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  CLOSED: "Closed (fully invoiced)",
};

export interface SalesOrderLineInput {
  itemId: string;
  quantity: number;
  rate: number;
  // Foreign-currency SOs only — the unit rate as entered, in the SO's
  // currency. See SalesOrder.currency below.
  rateFc?: number;
  taxRate?: number;
}

export interface SalesOrderLine extends SalesOrderLineInput {
  id: string;
  item: { id: string; sku: string; name: string };
  lineSubtotal: string;
  taxAmount: string;
  lineTotal: string;
  // Display-only — null for an INR SO. See SalesOrder.grandTotalFc.
  lineTotalFc?: string | null;
  // Running total already dispatched against this line across every
  // Delivery Note — never exceeds `quantity`. This is the real stock-out
  // signal; billedQuantity below is the separate, always-lagging-or-equal
  // financial side. See DeliveryNote below.
  deliveredQuantity: string;
  // Running total already invoiced against this line across every linked
  // Sales Invoice — never exceeds `quantity`.
  billedQuantity: string;
}

export interface SalesOrder {
  id: string;
  soNumber: string;
  soDate: string;
  expectedDeliveryDate: string | null;
  narration: string;
  status: SalesOrderStatus;
  businessPartner: { id: string; name: string };
  branch?: { id: string; name: string } | null;
  subtotal: string;
  taxTotal: string;
  grandTotal: string;
  // Foreign currency (exports) — currency is "INR" and grandTotalFc is
  // null for every domestic SO. A Sales Invoice raised against this SO
  // derives its own currency from here — see salesOrderId on
  // SalesInvoice/createSalesInvoice.
  currency: string;
  exchangeRate: string;
  grandTotalFc: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  autoApproved: boolean;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  lines: SalesOrderLine[];
  // Every Sales Invoice raised against this SO so far — the detail screen
  // shows this as the billing progress trail.
  salesInvoices?: { id: string; invoiceNumber: string; invoiceDate: string; grandTotal: string }[];
  // Every Delivery Note raised against this SO so far — the detail screen
  // shows this as the dispatch progress trail, alongside billing.
  deliveryNotes?: { id: string; dnNumber: string; dnDate: string }[];
}

// ── Delivery Note ────────────────────────────────────────────────────────
// Records physical dispatch of goods against an APPROVED Sales Order —
// this, not the eventual Sales Invoice, is what actually moves stock. See
// backend/prisma/schema.prisma's DeliveryNote model comment. Posts
// immediately on creation — no draft/approval workflow of its own.
export interface DeliveryNoteLineInput {
  salesOrderLineId: string;
  quantityDelivered: number;
}

export interface DeliveryNoteLine extends DeliveryNoteLineInput {
  id: string;
  item: { id: string; sku: string; name: string };
  // Only populated on the detail fetch (GET /delivery-notes/:id) — the
  // list endpoint doesn't include this relation, so it's absent there.
  salesOrderLine?: { id: string; quantity: string };
  // Carried in at the SO line's own selling rate — descriptive only.
  rate: string;
  // The actual blended cost consumeStock returned when this note posted —
  // reused by an eventual SO-linked Sales Invoice's COGS instead of
  // re-consuming stock.
  unitCost: string;
  // Running total already invoiced against this specific Delivery Note
  // line — never exceeds quantityDelivered. This is the 3-way match Sales
  // Invoice enforces (see DocumentLineInput.deliveryNoteLineId).
  billedQuantity: string;
}

export interface DeliveryNote {
  id: string;
  dnNumber: string;
  dnDate: string;
  narration: string;
  businessPartner: { id: string; name: string };
  branch?: { id: string; name: string } | null;
  salesOrder: { id: string; soNumber: string };
  lines: DeliveryNoteLine[];
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
  "purchase.approve",
  "purchase.receive",
  "sales.approve",
  "sales.deliver",
  "inventory.post",
  "journal.post",
  "company.manage",
  "currency.manage",
  "chatbot.access",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "coa.manage": "Manage Chart of Accounts",
  "items.manage": "Manage Items",
  "businessPartners.manage": "Manage Business Partners (Customers/Vendors)",
  "branches.manage": "Manage Branches",
  "sales.post": "Create Sales Orders, post Sales Invoices & Sales Returns",
  "purchase.post": "Create Purchase Orders, post Purchase Bills & Purchase Returns",
  "purchase.approve": "Approve or reject Purchase Orders & Purchase Bills held for a price variance",
  "purchase.receive": "Raise Goods Receipt Notes (receive goods against a Purchase Order)",
  "sales.approve": "Approve or reject Sales Orders pending approval",
  "sales.deliver": "Raise Delivery Notes (dispatch goods against a Sales Order)",
  "inventory.post": "Post Stock Adjustments",
  "journal.post": "Post Journal Entries",
  "company.manage": "Manage Company Master Data (CIN, directors, auditors)",
  "currency.manage": "Manage Currency Master (effective-dated exchange rates)",
  "chatbot.access": "Use the data assistant (ask questions about the company's accounts, sales, purchases, and stock)",
};

export interface CustomRole {
  id: string;
  organizationId: string;
  name: string;
  permissions: Permission[];
  createdAt: string;
  updatedAt: string;
}

// ── Integration Connection (Project OS / external system API key) ──────────
// Backed by routes/integrationConnections.ts. Only one live key per org —
// GET never returns the raw key (only its last 4 chars), same "shown once"
// convention as the invite-link/token pattern above.
export interface IntegrationConnectionStatus {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  apiKeyLast4: string;
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

// ── Data assistant (chatbot) ────────────────────────────────────────────
// Session-only — the client holds the running transcript in memory
// (ChatWidget.tsx) and resends it on every POST /chatbot/ask; the backend
// never persists it. See routes/chatbot.ts.
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
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

// ── Currency Master ──────────────────────────────────────────────────────
// Effective-dated FX rates — see the schema.prisma comment on CurrencyRate.
// The currency code/symbol/name list itself is still the fixed
// SUPPORTED_CURRENCIES array above; this is the per-org "what rate applied
// on what date" history layered on top of it.

export interface CurrencyRate {
  id: string;
  currencyCode: string;
  effectiveFrom: string;
  rate: string;
  createdAt: string;
}

export interface CurrencyRateUploadRow extends BulkUploadRowBase {
  currencyCode: string;
  effectiveFrom: string | null;
  rate: number | null;
}

// ── Journal Entry bulk upload ────────────────────────────────────────────
// One row per LINE, not per entry — a Journal Entry is a header plus at
// least two balanced lines, unlike every other bulk-uploadable entity here.
// Rows sharing the same voucherRef are grouped into one entry server-side;
// see routes/journal.ts's bulk-upload section for the full grouping and
// validation rules. status is always "create" in practice — there is no
// "update" case for a journal entry — but the field stays typed as the
// full union for compatibility with BulkUploadRowBase/BulkUpload.tsx.
export interface JournalUploadRow extends BulkUploadRowBase {
  voucherRef: string;
  entryDate: string | null;
  voucherType: string;
  branchCode: string | null;
  accountCode: string;
  accountName: string | null;
  businessPartnerCode: string | null;
  debit: number;
  credit: number;
  lineNarration: string | null;
  entryNarration: string | null;
}

// ── Recurring Expenses ───────────────────────────────────────────────────
// A monthly expense template. Generating one produces a Purchase Bill of
// SERVICE items rather than a Journal Entry, because GSTR-3B's ITC only ever
// comes from purchase_bills — see migration_030.

export type RecurringAmountMode = "FIXED" | "PROMPTED";

export interface RecurringExpenseLine {
  id: string;
  itemId: string;
  quantity: string;
  // Null only on a PROMPTED template — the amount isn't known until the
  // month it's raised.
  rate: string | null;
  taxRate: string;
  sortOrder: number;
  item?: { id: string; sku: string; name: string; uom: string };
}

export interface RecurringExpenseRun {
  id: string;
  periodMonth: string;
  purchaseBillId: string;
  generatedAt: string;
  purchaseBill?: { id: string; billNumber: string; billDate: string; grandTotal: string };
}

// Row shape from GET /recurring-expenses — carries the derived fields the
// list shows and the detail response doesn't bother computing.
export interface RecurringExpenseSummary {
  id: string;
  name: string;
  businessPartner: { id: string; name: string; code: string | null };
  dayOfMonth: number;
  startMonth: string;
  endMonth: string | null;
  amountMode: RecurringAmountMode;
  isActive: boolean;
  lineCount: number;
  // Null for PROMPTED — showing 0 would read as "free".
  estimatedAmount: number | null;
  lastRunMonth: string | null;
  nextDueMonth: string | null;
}

export interface RecurringExpense {
  id: string;
  name: string;
  businessPartnerId: string;
  businessPartner: { id: string; name: string; code: string | null };
  branchId: string | null;
  branch: { id: string; name: string } | null;
  dayOfMonth: number;
  startMonth: string;
  endMonth: string | null;
  amountMode: RecurringAmountMode;
  narration: string | null;
  isActive: boolean;
  lines: RecurringExpenseLine[];
  runs: RecurringExpenseRun[];
}

export interface RecurringExpenseLineInput {
  itemId: string;
  quantity: number;
  rate: number | null;
  taxRate: number;
}

// Row shape from GET /recurring-expenses/due?month=YYYY-MM. Numbers here are
// already `number` rather than the Prisma-decimal strings the other shapes
// carry, because the server computes the line maths for this screen — the
// due list must show exactly the figures the generator will post.
export interface RecurringDueLine {
  itemId: string;
  item: { id: string; sku: string; name: string; uom: string } | null;
  quantity: number;
  // Null on a PROMPTED template with no amount entered yet.
  rate: number | null;
  taxRate: number;
  lineSubtotal: number | null;
  lineTotal: number | null;
}

export interface RecurringDueRow {
  id: string;
  name: string;
  businessPartner: { id: string; name: string; code: string | null };
  amountMode: RecurringAmountMode;
  dayOfMonth: number;
  billDate: string;
  narration: string | null;
  lines: RecurringDueLine[];
  estimatedTotal: number | null;
  // Present once a bill exists for this template and month. The row stays in
  // the list rather than disappearing, so it's obvious nothing was missed.
  alreadyRaised: { billId: string; billNumber: string; grandTotal: string } | null;
}

// ── Prepaid schedules ────────────────────────────────────────────────────
// The release side of a prepaid Purchase Bill line (migration_032). Amounts
// are numbers rather than Prisma-decimal strings: the server does the
// instalment arithmetic so the screen shows exactly what will post.

export type PrepaidStatus = "ACTIVE" | "COMPLETED" | "CANCELLED";

export interface PrepaidAccountRef {
  id: string;
  accountCode: string;
  accountName: string;
}

// Who the prepayment was made to. Carried from the originating bill, not from
// the schedule — an amortization entry has no counterparty, so this exists for
// the register's benefit rather than the ledger's. Null for a schedule with no
// bill behind it.
export interface PrepaidVendorRef {
  id: string;
  name: string;
  code: string | null;
}

export interface PrepaidScheduleSummary {
  id: string;
  name: string;
  status: PrepaidStatus;
  expenseAccount: PrepaidAccountRef;
  purchaseBill: { id: string; billNumber: string; billDate: string } | null;
  vendor: PrepaidVendorRef | null;
  totalAmount: number;
  released: number;
  remaining: number;
  startMonth: string;
  endMonth: string;
  months: number;
  instalmentsPosted: number;
  lastPostedMonth: string | null;
}

export interface PrepaidDueRow {
  id: string;
  name: string;
  expenseAccount: PrepaidAccountRef;
  purchaseBill: { id: string; billNumber: string } | null;
  vendor: PrepaidVendorRef | null;
  totalAmount: number;
  released: number;
  remaining: number;
  instalmentNo: number;
  months: number;
  amount: number;
  // Instalments before this month that were never posted. Straight-line makes
  // out-of-order posting arithmetically harmless, but it is worth surfacing.
  missingBefore: number;
  alreadyPosted: { journalEntryId: string; amount: number } | null;
}

export interface PrepaidInstalment {
  instalmentNo: number;
  month: string;
  amount: number;
  cumulative: number;
  balance: number;
  postedAt: string | null;
  journalEntryId: string | null;
  postedAmount: number | null;
}

export interface PrepaidScheduleDetail {
  id: string;
  name: string;
  status: PrepaidStatus;
  branch: { id: string; name: string } | null;
  expenseAccount: PrepaidAccountRef;
  prepaidAccount: PrepaidAccountRef;
  businessPartner: { id: string; name: string };
  purchaseBill: { id: string; billNumber: string; billDate: string } | null;
  vendor: PrepaidVendorRef | null;
  totalAmount: number;
  released: number;
  remaining: number;
  startMonth: string;
  endMonth: string;
  months: number;
  createdAt: string;
  instalments: PrepaidInstalment[];
}

export interface PrepaidPostResult {
  posted: { id: string; amount: number }[];
  failed: { id: string; message: string }[];
}

export interface RecurringGenerateResult {
  created: { recurringExpenseId: string; billNumber: string; grandTotal: number }[];
  failed: { recurringExpenseId: string; message: string }[];
}
// Depreciation Due — one period, the whole organization, posted in order.
//
// Unlike Amortization Due there is no month picker and no per-row selection.
// A depreciation period is not independent of the one before it: under WDV
// every charge compounds on the previous closing balance, so the period on
// offer is always the next one, and it posts whole or not at all.

export interface DepreciationDuePeriod {
  periodStart: string;
  periodEnd: string;
  label: string;
  months: number;
}

export interface DepreciationDueSubPeriod {
  periodStart: string;
  periodEnd: string;
  label: string;
  method: string;
  // Equal except in an asset's first period, which Schedule II charges pro
  // rata from the date the asset was put to use.
  daysCharged: number;
  daysInPeriod: number;
  openingWdv: number;
  amount: number;
  closingWdv: number;
}

export interface DepreciationDueAsset {
  id: string;
  assetCode: string;
  name: string;
  assetClass: { id: string; name: string };
  branch: { id: string; name: string } | null;
  depExpenseAccount: { accountCode: string; accountName: string };
  accumDepAccount: { accountCode: string; accountName: string };
  method: string;
  openingWdv: number;
  amount: number;
  closingWdv: number;
  // This charge takes the asset to its residual and ends its life.
  final: boolean;
  periods: DepreciationDueSubPeriod[];
  // More than zero only for an asset capitalised with an in-use date behind
  // periods already posted — it is charged for all of them at once.
  catchUpPeriods: number;
  partFirstPeriod: boolean;
}

export interface DepreciationBlockedAsset {
  id: string;
  assetCode: string;
  name: string;
  assetClass: { id: string; name: string };
  reason: string;
  message: string;
}

export interface DepreciationDue {
  frequency: string;
  // null when nothing can be offered — an empty register, or a frequency
  // change that would overlap what is already posted.
  period: DepreciationDuePeriod | null;
  today?: string;
  canPost: boolean;
  // Why not, when canPost is false.
  reason: string | null;
  lastPosted: { periodStart: string; periodEnd: string; label: string } | null;
  totalAmount: number;
  assets: DepreciationDueAsset[];
  blocked: DepreciationBlockedAsset[];
}

export interface DepreciationPostResult {
  periodStart: string;
  periodEnd: string;
  label: string;
  assetCount: number;
  totalAmount: number;
  journalEntryIds: string[];
}

export interface DepreciationReverseResult {
  periodStart: string;
  runsRemoved: number;
  journalEntriesRemoved: number;
}

// Bill of materials — what a finished item is made of.
//
// A recipe, not an event. It moves no stock and posts nothing; its only job
// is to be exploded when a production order is opened. The costs below are
// indicative — read from what the components are carried at today — because
// what a production order actually charges is whatever the stock is worth on
// the day it is issued.

export interface BomComponentRef {
  id: string;
  sku: string;
  name: string;
  uom: string;
  isActive: boolean;
}

export interface BomLine {
  id: string;
  component: BomComponentRef;
  qtyPerUnit: number;
  // What one of the component is carried at today, weighted across branches.
  // Zero when none is on hand anywhere.
  unitCost: number;
  lineCost: number;
  quantityOnHand: number;
}

export interface BillOfMaterials {
  item: { id: string; sku: string; name: string; uom: string; isFinishedGood: boolean };
  lines: BomLine[];
  materialCostPerUnit: number;
  // At least one component has never been priced, so the total understates.
  incomplete: boolean;
}

// Production orders — raw material in, finished goods out.
//
// The WIP balance and the quantity received are computed by the server from
// the order's postings, never stored. The finished good's unit cost is
// likewise derived: WIP absorbed divided by quantity received.

export interface ProductionEntryLineView {
  id: string;
  item: { id: string; sku: string; name: string; uom: string } | null;
  account: { id: string; accountCode: string; accountName: string } | null;
  quantity: number | null;
  unitCost: number | null;
  lineValue: number;
}

export interface ProductionEntryView {
  id: string;
  // ISSUE, COST, RECEIPT or WRITEOFF.
  entryType: string;
  entryDate: string;
  totalValue: number;
  narration: string | null;
  journalEntryId: string;
  lines: ProductionEntryLineView[];
}

export interface ProductionPosition {
  issued: number;
  costed: number;
  absorbed: number;
  writtenOff: number;
  wipBalance: number;
  receivedQuantity: number;
}

export interface ProductionOrderSummary extends ProductionPosition {
  id: string;
  orderNumber: string;
  orderDate: string;
  finishedItem: { id: string; sku: string; name: string; uom: string };
  branch: { id: string; name: string } | null;
  plannedQuantity: number;
  status: string;
  unitCostSoFar: number | null;
}

export interface SuggestedIssueLine {
  itemId: string;
  sku: string;
  name: string;
  uom: string;
  isActive: boolean;
  qtyPerUnit: number;
  // The bill of materials exploded for the planned quantity. A suggestion —
  // corrected on the issue against what was actually taken to the floor.
  quantity: number;
}

export interface ProductionOrderDetail extends ProductionOrderSummary {
  notes: string | null;
  suggestedIssue: SuggestedIssueLine[];
  entries: ProductionEntryView[];
}

// Stock transfers between branches.
//
// Two events, not one: goods dispatched are in transit until received, and
// 1304 Stock in Transit is where the balance sheet says so. Both journal
// entries net through it, because a journal entry carries a single branch.

export interface StockTransferLineView {
  id: string;
  item: { id: string; sku: string; name: string; uom: string };
  quantity: number;
  // What the stock was worth at the sending branch. Never entered — the
  // receiving branch receives at this cost and nothing is re-valued in
  // transit.
  unitCost: number;
  lineValue: number;
}

export interface StockTransferSummary {
  id: string;
  transferNumber: string;
  transferDate: string;
  receivedDate: string | null;
  fromBranch: { id: string; name: string };
  toBranch: { id: string; name: string };
  status: string;
  // NONE or TAXABLE. Only NONE is written today — a transfer between
  // branches with different GSTINs is refused rather than posted untaxed.
  taxTreatment: string;
  documentNumber: string | null;
  lineCount: number;
  totalValue: number;
}

export interface StockTransferDetail extends Omit<StockTransferSummary, "lineCount"> {
  ewayBillNumber: string | null;
  dispatchJournalEntryId: string | null;
  receiptJournalEntryId: string | null;
  lines: StockTransferLineView[];
}
