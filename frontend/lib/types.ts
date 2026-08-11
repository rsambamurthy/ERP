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
