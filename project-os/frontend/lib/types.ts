// Mirrors project-os/backend's Prisma models 1:1 for the slice of the API
// this frontend pass covers (Auth, Projects, BOQ, Budget, Cost Categories).
// Keep in sync with project-os/backend/prisma/schema.prisma — same
// convention SmartERP frontend's lib/types.ts uses relative to its own
// backend schema. Money/quantity fields come back from the API as strings
// (Prisma Decimal → JSON), same as SmartERP's own types.ts already assumes
// elsewhere — components that need to compute with them call Number(...).

export type OrgRole = "SUPER_ADMIN" | "PROJECT_MANAGER" | "ESTIMATOR" | "PROCUREMENT" | "WAREHOUSE" | "SITE_ENGINEER";

export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  SUPER_ADMIN: "Super Admin",
  PROJECT_MANAGER: "Project Manager",
  ESTIMATOR: "Estimator",
  PROCUREMENT: "Procurement",
  WAREHOUSE: "Warehouse",
  SITE_ENGINEER: "Site Engineer",
};

// ── Auth ──────────────────────────────────────────────────────────────

export interface RegisterPayload {
  organizationName: string;
  name: string;
  email: string;
  password: string;
}

export interface RegisterResponse {
  token: string;
  organization: { id: string; name: string };
  user: { id: string; name: string; email: string };
}

export interface LoginResponse {
  token: string;
  user: { id: string; name: string; email: string };
  role: OrgRole;
}

// ── Project (Section 6.2) ────────────────────────────────────────────

// Draft -> Awarded -> Active -> On Hold -> Substantially Complete -> Closed
export type ProjectStatus = "DRAFT" | "AWARDED" | "ACTIVE" | "ON_HOLD" | "SUBSTANTIALLY_COMPLETE" | "CLOSED";

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  DRAFT: "Draft",
  AWARDED: "Awarded",
  ACTIVE: "Active",
  ON_HOLD: "On Hold",
  SUBSTANTIALLY_COMPLETE: "Substantially Complete",
  CLOSED: "Closed",
};

export interface Project {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  customerId: string | null;
  status: ProjectStatus | string;
  startDate: string | null;
  targetEndDate: string | null;
  poApprovalThreshold: string | null;
  createdAt: string;
  deletedAt: string | null;
  customer?: SyncedBusinessPartner | null;
  sites?: ProjectSite[];
  contract?: unknown;
  team?: unknown[];
}

export interface ProjectSite {
  id: string;
  projectId: string;
  name: string;
  address: unknown;
  stateCode: string | null;
  createdAt: string;
}

// ── BOQ & Estimation (Section 6.3) ───────────────────────────────────

// Draft -> Imported -> (Validated, unreachable in R1) -> Approved -> Superseded
export type BoqStatus = "DRAFT" | "IMPORTED" | "VALIDATED" | "APPROVED" | "SUPERSEDED";

export const BOQ_STATUS_LABELS: Record<BoqStatus, string> = {
  DRAFT: "Draft",
  IMPORTED: "Imported",
  VALIDATED: "Validated",
  APPROVED: "Approved",
  SUPERSEDED: "Superseded",
};

export interface Boq {
  id: string;
  projectId: string;
  version: number;
  status: BoqStatus | string;
  sourceFileName: string | null;
  createdAt: string;
  _count?: { lines: number };
  lines?: BoqLine[];
}

export interface CostCategory {
  id: string;
  organizationId: string;
  name: string;
  isSystem: boolean;
}

export interface SyncedItemRef {
  id: string;
  sku: string;
  name: string;
}

// ── Synced masters (Section 9.1) — for the item/supplier pickers ────

export interface SyncedItem {
  id: string;
  organizationId: string;
  externalId: string;
  sku: string;
  name: string;
  uom: string;
  hsnCode: string | null;
  purchaseRate: string | null;
  salesRate: string | null;
  taxRate: string;
  syncedAt: string;
}

export interface BoqLine {
  id: string;
  boqId: string;
  lineNo: number;
  description: string;
  itemId: string | null;
  costCategoryId: string | null;
  uom: string;
  quantity: string;
  rate: string;
  amount: string;
  billable: boolean;
  item?: SyncedItemRef | null;
  costCategory?: CostCategory | null;
  estimate?: Estimate | null;
}

export interface Estimate {
  id: string;
  boqLineId: string;
  materialCost: string;
  labourCost: string;
  subcontractCost: string;
  overheadCost: string;
  totalCost: string;
  version: number;
  approvalStatus: string;
  createdAt: string;
}

export interface BoqImportPreviewRow {
  rowNum: number;
  lineNo: number | null;
  description: string;
  itemSku: string | null;
  itemMatched: boolean;
  costCategoryName: string;
  uom: string;
  quantity: number | null;
  rate: number | null;
  amount: number | null;
  billable: boolean;
  status: "create" | "error";
  error?: string;
}

// ── Budget (Section 6.3) ─────────────────────────────────────────────

export type BudgetStatus = "DRAFT" | "APPROVED";

export interface Budget {
  id: string;
  projectId: string;
  version: number;
  costCategoryId: string;
  baselineAmount: string;
  approvedAmount: string | null;
  status: BudgetStatus | string;
  createdAt: string;
  costCategory?: CostCategory;
}

// ── SmartERP connection (Section 9.1 settings UI) ────────────────────

export interface SmartErpConnectionStatus {
  apiBaseUrl: string;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
}

export interface SyncResult {
  partnersSynced: number;
  itemsSynced: number;
  branchesSynced: number;
}

// bpType mirrors SmartERP's own BusinessPartner.bpType (CUSTOMER | VENDOR)
// — same shape backs both the synced-customers and synced-suppliers lists.
export interface SyncedBusinessPartner {
  id: string;
  organizationId: string;
  externalId: string;
  bpType: "CUSTOMER" | "VENDOR" | string;
  name: string;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  stateCode: string | null;
  syncedAt: string;
}

// ── Generic API envelope ─────────────────────────────────────────────

export interface ApiListResponse<T> {
  data: T[];
}
export interface ApiItemResponse<T> {
  data: T;
}
