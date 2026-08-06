// SmartERP's menu structure — same shape SmartAppt's Financial Accounting
// module uses (NAV_GROUPS: id/label/items[]), scoped down to what an MSME
// Trading/Manufacturing org needs. Extend this array as new modules
// (Inventory, Sales, Purchase) come online — the sidebar renders whatever's
// here, nothing is hardcoded elsewhere.
export interface NavItem {
  id: string;
  label: string;
  path: string;
  dot: string;
  /** OWNER/ADMIN-only items (e.g. Team) — filtered out client-side for
   * other roles. The backend enforces this independently either way. */
  ownerAdminOnly?: boolean;
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
      { id: "chart_of_accounts", label: "Chart of Accounts", path: "/accounting/chart-of-accounts", dot: "#2563eb" },
      { id: "business_partners", label: "Business Partners", path: "/accounting/business-partners", dot: "#0891b2" },
      { id: "team", label: "Team", path: "/settings/team", dot: "#a855f7", ownerAdminOnly: true },
    ],
  },
  {
    id: "accounting",
    label: "Accounting",
    icon: "A",
    items: [
      { id: "journal_entries", label: "Journal Entries", path: "/accounting/journal", dot: "#7c3aed" },
      { id: "ledger", label: "Ledger", path: "/accounting/ledger", dot: "#16a34a" },
      { id: "day_book", label: "Day Book", path: "/accounting/day-book", dot: "#f59e0b" },
      { id: "cash_book", label: "Cash / Bank Book", path: "/accounting/cash-book", dot: "#16a34a" },
      { id: "receipts_payments", label: "Receipts & Payments", path: "/accounting/receipts-payments", dot: "#15803d" },
      { id: "trial_balance", label: "Trial Balance", path: "/accounting/trial-balance", dot: "#0891b2" },
      { id: "pnl", label: "Profit & Loss", path: "/accounting/pnl", dot: "#f59e0b" },
      { id: "balance_sheet", label: "Balance Sheet", path: "/accounting/balance-sheet", dot: "#7c3aed" },
    ],
  },
];
