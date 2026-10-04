// Line icons for individual nav pages (NavItem.id), used on the /menu page-level
// cards. Several pages share a glyph where one fits. An id with no entry here
// returns null, and the caller falls back to the item's coloured dot, so adding
// a new page to navGroups.ts never breaks the card.
const G: Record<string, React.ReactNode> = {
  user: (<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></>),
  users: (<><circle cx="9" cy="8" r="3.5" /><path d="M2 20a7 7 0 0114 0" /><path d="M16 4.5a3.5 3.5 0 010 7M18 14a7 7 0 013 6" /></>),
  building: (<path d="M4 21V5a1 1 0 011-1h9a1 1 0 011 1v16M15 10h4a1 1 0 011 1v10M2 21h20M8 8h3M8 12h3M8 16h3" />),
  coins: (<><circle cx="12" cy="12" r="9" /><path d="M9 8h6M9 11.5h6M10 8c4.5 0 4.5 6 0 6h-.5l4.5 3.5" /></>),
  list: (<><path d="M9 6h12M9 12h12M9 18h12" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>),
  tag: (<><path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z" /><circle cx="7.5" cy="7.5" r="1.2" /></>),
  box: (<><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" /><path d="M3.3 7.5L12 12.5l8.7-5M12 22V12.5" /></>),
  repeat: (<><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 013-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 01-3 3H3" /></>),
  trendDown: (<><path d="M22 17l-8.5-8.5-5 5L2 7" /><path d="M16 17h6v-6" /></>),
  pin: (<><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0116 0z" /><circle cx="12" cy="10" r="3" /></>),
  shield: (<><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></>),
  plug: (<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 01-12 0V8zM12 18v4" />),
  clipboard: (<><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4h6v3H9zM9 12h6M9 16h6" /></>),
  truck: (<><path d="M2 6h11v10H2zM13 9h5l3 3v4h-8" /><circle cx="6.5" cy="18" r="2" /><circle cx="17.5" cy="18" r="2" /></>),
  receipt: (<><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2V3z" /><path d="M9 8h6M9 12h6" /></>),
  undo: (<><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 010 12h-3" /></>),
  packageCheck: (<><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" /><path d="M9 12l2 2 4-4" /></>),
  sliders: (<><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>),
  swap: (<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />),
  bookOpen: (<path d="M2 5h7a3 3 0 013 3v13a2 2 0 00-2-2H2V5zM22 5h-7a3 3 0 00-3 3v13a2 2 0 012-2h8V5z" />),
  calendar: (<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>),
  wallet: (<><path d="M3 7a2 2 0 012-2h13v4M3 7v11a2 2 0 002 2h15V9H5a2 2 0 01-2-2z" /><circle cx="16.5" cy="14.5" r="1" /></>),
  scale: (<><path d="M12 3v18M5 21h14M5 7h14" /><path d="M5 7l-3 7a3 3 0 006 0L5 7zM19 7l-3 7a3 3 0 006 0l-3-7z" /></>),
  chartLine: (<><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></>),
  columns: (<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16M6 9h3M6 13h3M15 9h3M15 13h3" /></>),
  clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  alarm: (<><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M5 3L2 6M22 6l-3-3" /></>),
  factory: (<><path d="M2 21V10l6 4V10l6 4V6h4v15H2z" /><path d="M6 17h2M11 17h2" /></>),
  pen: (<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></>),
  fileText: (<><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>),
};

const BY_ITEM: Record<string, keyof typeof G> = {
  my_profile: "user",
  company_master: "building",
  currency_master: "coins",
  chart_of_accounts: "list",
  charge_master: "tag",
  business_partners: "users",
  items: "box",
  recurring_expenses: "repeat",
  depreciation: "trendDown",
  branches: "pin",
  team: "users",
  access_control: "shield",
  integration: "plug",
  sales_orders: "clipboard",
  delivery_notes: "truck",
  sales_invoices: "receipt",
  sales_returns: "undo",
  purchase_orders: "clipboard",
  goods_receipt_notes: "packageCheck",
  purchase_bills: "receipt",
  purchase_returns: "undo",
  recurring_due: "alarm",
  stock_adjustments: "sliders",
  stock_transfers: "swap",
  stock_ledger: "list",
  item_valuation: "coins",
  production_orders: "factory",
  journal_entries: "pen",
  ledger: "bookOpen",
  day_book: "calendar",
  cash_book: "wallet",
  receipts_payments: "swap",
  trial_balance: "scale",
  pnl: "chartLine",
  balance_sheet: "columns",
  prepaid_schedules: "clock",
  amortization_due: "alarm",
  fixed_assets: "building",
  depreciation_due: "alarm",
  gstr1: "fileText",
  gstr3b: "fileText",
  schedule_iii_balance_sheet: "columns",
};

export function hasItemIcon(id: string): boolean {
  return Boolean(BY_ITEM[id]);
}

export default function ItemIcon({ id, size = 22 }: { id: string; size?: number }) {
  const key = BY_ITEM[id];
  if (!key) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {G[key]}
    </svg>
  );
}
