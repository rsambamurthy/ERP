import type { OrgRole } from "@/lib/types";

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
      { id: "chart_of_accounts", label: "Chart of Accounts", path: "/accounting/chart-of-accounts", dot: "#2563eb", roles: ALL_ROLES },
      { id: "business_partners", label: "Business Partners", path: "/accounting/business-partners", dot: "#0891b2", roles: ALL_ROLES },
      { id: "team", label: "Team", path: "/settings/team", dot: "#a855f7", roles: ["OWNER", "ADMIN"] },
      { id: "access_control", label: "Access Control", path: "/settings/access-control", dot: "#dc2626", roles: ["OWNER", "ADMIN"] },
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
    ],
  },
];
