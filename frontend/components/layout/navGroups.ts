import type { OrgRole, Permission } from "@/lib/types";

// SmartERP's menu structure — same shape SmartAppt's Financial Accounting
// module uses (NAV_GROUPS: id/label/items[]), scoped down to what an MSME
// Trading/Manufacturing org needs. Extend this array as new modules
// (Inventory, Sales, Purchase) come online — the sidebar renders whatever's
// here, nothing is hardcoded elsewhere.
//
// `roles` is the DEFAULT visibility for a brand-new org that has never
// touched the Access Control screen (/settings/access-control). It's the
// same role list this whole module already used to gate write access
// (middleware/auth.ts requireRole calls) — visibility here is a superset
// suggestion, not the authority; the backend enforces the real permission
// independently on every route regardless of what the sidebar shows.
// Per-org, per-role departures from these defaults are stored sparsely in
// org_menu_config (see backend/src/routes/accessControl.ts) — mirrors
// SmartAppt's menu_group_config / WebMenuPage.tsx exactly.
const ALL_ROLES: OrgRole[] = ["OWNER", "ADMIN", "ACCOUNTANT", "VIEWER"];

export interface NavItem {
  id: string;
  label: string;
  path: string;
  dot: string;
  /** Roles that see this item out of the box, before any org override. */
  roles: OrgRole[];
  /**
   * For a role === "CUSTOM" user, visibility isn't decided by `roles`
   * (that list is only ever the four fixed roles) — it's decided by
   * whether their custom role was granted this permission. Undefined means
   * "universal" — every custom role sees it, same as every fixed role does
   * (read-only screens, mostly). Team/Access Control are never given a
   * permission here since custom roles can't be granted those at all.
   */
  permission?: Permission;
}

export interface NavGroup {
  id: string;
  label: string;
  icon: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "config",
    label: "Configuration",
    icon: "⚙",
    items: [
      { id: "my_profile", label: "My Profile", path: "/settings/profile", dot: "#64748b", roles: ALL_ROLES },
      { id: "company_master", label: "Company Master", path: "/settings/company-master", dot: "#0d9488", roles: ["OWNER", "ADMIN"], permission: "company.manage" },
      { id: "currency_master", label: "Currency Master", path: "/settings/currency-master", dot: "#ca8a04", roles: ["OWNER", "ADMIN"], permission: "currency.manage" },
      { id: "chart_of_accounts", label: "Chart of Accounts", path: "/accounting/chart-of-accounts", dot: "#2563eb", roles: ALL_ROLES },
      { id: "business_partners", label: "Business Partners", path: "/accounting/business-partners", dot: "#0891b2", roles: ALL_ROLES },
      { id: "items", label: "Items", path: "/inventory/items", dot: "#0d9488", roles: ALL_ROLES },
      { id: "recurring_expenses", label: "Recurring Expenses", path: "/settings/recurring-expenses", dot: "#e11d48", roles: ["OWNER", "ADMIN", "ACCOUNTANT"], permission: "purchase.post" },
      { id: "depreciation", label: "Depreciation", path: "/settings/depreciation", dot: "#9333ea", roles: ["OWNER", "ADMIN"], permission: "company.manage" },
      { id: "branches", label: "Branches", path: "/settings/branches", dot: "#0284c7", roles: ["OWNER", "ADMIN"], permission: "branches.manage" },
      { id: "team", label: "Team", path: "/settings/team", dot: "#a855f7", roles: ["OWNER", "ADMIN"] },
      { id: "access_control", label: "Access Control", path: "/settings/access-control", dot: "#dc2626", roles: ["OWNER", "ADMIN"] },
      { id: "integration", label: "Integration", path: "/settings/integration", dot: "#059669", roles: ["OWNER", "ADMIN"] },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    icon: "S",
    items: [
      { id: "sales_orders", label: "Sales Orders", path: "/sales/orders", dot: "#7c3aed", roles: ["OWNER", "ADMIN", "ACCOUNTANT"], permission: "sales.post" },
      { id: "delivery_notes", label: "Delivery Notes", path: "/sales/delivery-notes", dot: "#0891b2", roles: ["OWNER", "ADMIN", "ACCOUNTANT"], permission: "sales.deliver" },
      { id: "sales_invoices", label: "Sales Invoices", path: "/sales/invoices", dot: "#16a34a", roles: ["OWNER", "ADMIN", "ACCOUNTANT"], permission: "sales.post" },
      { id: "sales_returns", label: "Sales Returns", path: "/sales/returns", dot: "#65a30d", roles: ["OWNER", "ADMIN", "ACCOUNTANT"], permission: "sales.post" },
    ],
  },
  {
    id: "purchase",
    label: "Purchase",
    icon: "P",
    items: [
      { id: "purchase_orders", label: "Purchase Orders", path: "/purchase/orders", dot: "#9333ea", roles: ["OWNER", "ADMIN", "ACCOUNTANT"], permission: "purchase.post" },
      { id: "goods_receipt_notes", label: "Goods Receipt Notes", path: "/purchase/grn", dot: "#0891b2", roles: ["OWNER", "ADMIN", "ACCOUNTANT"], permission: "purchase.receive" },
      { id: "purchase_bills", label: "Purchase Bills", path: "/purchase/bills", dot: "#ea580c", roles: ["OWNER", "ADMIN", "ACCOUNTANT"], permission: "purchase.post" },
      { id: "purchase_returns", label: "Purchase Returns", path: "/purchase/returns", dot: "#c2410c", roles: ["OWNER", "ADMIN", "ACCOUNTANT"], permission: "purchase.post" },
      { id: "recurring_due", label: "Recurring Due", path: "/purchase/recurring-due", dot: "#e11d48", roles: ["OWNER", "ADMIN", "ACCOUNTANT"], permission: "purchase.post" },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    icon: "I",
    items: [
      { id: "stock_adjustments", label: "Stock Adjustments", path: "/inventory/adjustments", dot: "#dc2626", roles: ["OWNER", "ADMIN", "ACCOUNTANT"], permission: "inventory.post" },
      { id: "stock_transfers", label: "Stock Transfers", path: "/inventory/stock-transfers", dot: "#0d9488", roles: ALL_ROLES },
      { id: "stock_ledger", label: "Stock Ledger", path: "/inventory/stock-ledger", dot: "#0891b2", roles: ALL_ROLES },
      { id: "item_valuation", label: "Item Valuation", path: "/inventory/valuation", dot: "#7c3aed", roles: ALL_ROLES },
    ],
  },
  {
    id: "manufacturing",
    label: "Manufacturing",
    icon: "M",
    items: [
      { id: "production_orders", label: "Production Orders", path: "/manufacturing/production-orders", dot: "#ea580c", roles: ALL_ROLES },
    ],
  },
  {
    id: "accounting",
    label: "Accounting",
    icon: "A",
    items: [
      { id: "journal_entries", label: "Journal Entries", path: "/accounting/journal", dot: "#7c3aed", roles: ALL_ROLES },
      { id: "ledger", label: "Ledger", path: "/accounting/ledger", dot: "#16a34a", roles: ALL_ROLES },
      { id: "day_book", label: "Day Book", path: "/accounting/day-book", dot: "#f59e0b", roles: ALL_ROLES },
      { id: "cash_book", label: "Cash / Bank Book", path: "/accounting/cash-book", dot: "#16a34a", roles: ALL_ROLES },
      { id: "receipts_payments", label: "Receipts & Payments", path: "/accounting/receipts-payments", dot: "#15803d", roles: ALL_ROLES },
      { id: "trial_balance", label: "Trial Balance", path: "/accounting/trial-balance", dot: "#0891b2", roles: ALL_ROLES },
      { id: "pnl", label: "Profit & Loss", path: "/accounting/pnl", dot: "#f59e0b", roles: ALL_ROLES },
      { id: "balance_sheet", label: "Balance Sheet", path: "/accounting/balance-sheet", dot: "#7c3aed", roles: ALL_ROLES },
      { id: "prepaid_schedules", label: "Prepaid Schedules", path: "/accounting/prepaid-schedules", dot: "#0d9488", roles: ALL_ROLES },
      { id: "amortization_due", label: "Amortization Due", path: "/accounting/amortization-due", dot: "#e11d48", roles: ["OWNER", "ADMIN", "ACCOUNTANT"], permission: "journal.post" },
      { id: "fixed_assets", label: "Fixed Assets", path: "/accounting/fixed-assets", dot: "#9333ea", roles: ALL_ROLES },
      { id: "depreciation_due", label: "Depreciation Due", path: "/accounting/depreciation-due", dot: "#e11d48", roles: ["OWNER", "ADMIN", "ACCOUNTANT"], permission: "journal.post" },
    ],
  },
  {
    id: "statutory",
    label: "Statutory Reports",
    icon: "G",
    items: [
      { id: "gstr1", label: "GSTR-1", path: "/reports/gstr1", dot: "#0891b2", roles: ALL_ROLES },
      { id: "gstr3b", label: "GSTR-3B", path: "/reports/gstr3b", dot: "#ea580c", roles: ALL_ROLES },
      { id: "schedule_iii_balance_sheet", label: "Schedule III Balance Sheet", path: "/reports/schedule-iii-balance-sheet", dot: "#7c3aed", roles: ALL_ROLES },
    ],
  },
];
