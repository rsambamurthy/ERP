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
