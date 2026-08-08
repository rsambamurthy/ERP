// Schedule III (Companies Act, 2013, Division I — the general-purpose
// format, not Ind AS/NBFC/banking) Balance Sheet classification. Balance
// Sheet only — the corresponding Part II (Statement of Profit and Loss)
// format isn't built yet, so INCOME/EXPENSE accounts have no head here.
//
// Every head belongs to exactly one of the five standard groupings, which
// is what routes/journal.ts's GET /schedule-iii-balance-sheet actually
// renders as: two sides (Equity & Liabilities / Assets), each split into
// its groupings, each grouping split into its heads.
import { prisma } from "../db";

export type ScheduleIIISide = "EQUITY_AND_LIABILITIES" | "ASSETS";

export type ScheduleIIIGroup =
  | "SHAREHOLDERS_FUNDS"
  | "NON_CURRENT_LIABILITIES"
  | "CURRENT_LIABILITIES"
  | "NON_CURRENT_ASSETS"
  | "CURRENT_ASSETS";

export interface ScheduleIIIHeadDef {
  code: string;
  label: string;
  side: ScheduleIIISide;
  group: ScheduleIIIGroup;
  groupLabel: string;
  // Which Account.accountType values this head may be applied to — a route
  // accepting a scheduleIiiHead value should reject a mismatch (e.g.
  // "TRADE_PAYABLES" on an ASSET account).
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

const HEAD_BY_CODE = new Map(SCHEDULE_III_HEADS.map((h) => [h.code, h]));

export function getScheduleIIIHead(code: string): ScheduleIIIHeadDef | undefined {
  return HEAD_BY_CODE.get(code);
}

// A head is only valid for the account types it was defined for — e.g.
// "TRADE_PAYABLES" can't be applied to an ASSET account.
export function isValidHeadForAccountType(code: string, accountType: string): boolean {
  const head = HEAD_BY_CODE.get(code);
  return !!head && (head.accountTypes as string[]).includes(accountType);
}

// ── Schedule III Balance Sheet report ───────────────────────────────────────

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
  // Accounts of type ASSET/LIABILITY/EQUITY with no scheduleIiiHead set yet
  // — surfaced explicitly rather than silently dropped, so an incomplete
  // classification is obvious instead of making the report look "balanced"
  // while actually missing pieces.
  unclassified: { assets: ScheduleIIILineItem[]; liabilities: ScheduleIIILineItem[]; equity: ScheduleIIILineItem[]; total: number };
  balanced: boolean;
  difference: number;
}

export async function computeScheduleIIIBalanceSheet(
  organizationId: string,
  asOf?: Date,
  branchId?: string
): Promise<ScheduleIIIBalanceSheet> {
  const accounts = await prisma.account.findMany({
    where: { organizationId, deletedAt: null, isGroup: false, accountType: { in: ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] } },
    orderBy: [{ accountType: "asc" }, { sortOrder: "asc" }, { accountCode: "asc" }],
  });

  const sums = await prisma.journalLine.groupBy({
    by: ["accountId"] as const,
    where: {
      accountId: { in: accounts.map((a) => a.id) },
      journalEntry: {
        organizationId,
        ...(branchId ? { branchId } : {}),
        ...(asOf ? { entryDate: { lte: asOf } } : {}),
      },
    },
    _sum: { debit: true, credit: true },
  });
  const sumByAccount = new Map(sums.map((s) => [s.accountId, s._sum]));

  // Same math as GET /journal/balance-sheet — net profit-to-date folds into
  // Reserves and Surplus (Schedule III's "Current Earnings" equivalent) so
  // the two sides actually balance, same reasoning that report already uses
  // for its own Equity bucket.
  let netProfitToDate = 0;
  const byHead = new Map<string, ScheduleIIILineItem[]>();
  const unclassified = { assets: [] as ScheduleIIILineItem[], liabilities: [] as ScheduleIIILineItem[], equity: [] as ScheduleIIILineItem[] };

  for (const a of accounts) {
    const sum = sumByAccount.get(a.id);
    let opening = Number(a.openingBalance ?? 0);
    if (a.openingBalanceType === "CREDIT") opening = -opening;

    if (a.accountType === "INCOME") {
      netProfitToDate += Number(sum?.credit ?? 0) - Number(sum?.debit ?? 0);
      continue;
    }
    if (a.accountType === "EXPENSE") {
      netProfitToDate -= Number(sum?.debit ?? 0) - Number(sum?.credit ?? 0);
      continue;
    }

    let amount: number;
    if (a.accountType === "ASSET") amount = opening + Number(sum?.debit ?? 0) - Number(sum?.credit ?? 0);
    else amount = -opening + Number(sum?.credit ?? 0) - Number(sum?.debit ?? 0); // LIABILITY or EQUITY
    if (amount === 0) continue;

    const item: ScheduleIIILineItem = { accountId: a.id, accountCode: a.accountCode, accountName: a.accountName, amount };
    if (!a.scheduleIiiHead || !getScheduleIIIHead(a.scheduleIiiHead)) {
      if (a.accountType === "ASSET") unclassified.assets.push(item);
      else if (a.accountType === "LIABILITY") unclassified.liabilities.push(item);
      else unclassified.equity.push(item);
      continue;
    }
    const list = byHead.get(a.scheduleIiiHead) ?? [];
    list.push(item);
    byHead.set(a.scheduleIiiHead, list);
  }

  // Fold current-year earnings into Reserves and Surplus.
  if (netProfitToDate !== 0) {
    const list = byHead.get("RESERVES_AND_SURPLUS") ?? [];
    list.push({ accountId: "current-earnings", accountCode: "—", accountName: "Current Earnings (net profit to date)", amount: netProfitToDate });
    byHead.set("RESERVES_AND_SURPLUS", list);
  }

  function buildSide(side: ScheduleIIISide): { groups: ScheduleIIIGroupResult[]; total: number } {
    const groupsInOrder: ScheduleIIIGroup[] =
      side === "EQUITY_AND_LIABILITIES"
        ? ["SHAREHOLDERS_FUNDS", "NON_CURRENT_LIABILITIES", "CURRENT_LIABILITIES"]
        : ["NON_CURRENT_ASSETS", "CURRENT_ASSETS"];

    const groups: ScheduleIIIGroupResult[] = groupsInOrder.map((group) => {
      const headsInGroup = SCHEDULE_III_HEADS.filter((h) => h.group === group);
      const heads: ScheduleIIIHeadResult[] = headsInGroup
        .map((h) => {
          const items = byHead.get(h.code) ?? [];
          return { code: h.code, label: h.label, items, total: items.reduce((s, i) => s + i.amount, 0) };
        })
        .filter((h) => h.items.length > 0);
      return { group, groupLabel: headsInGroup[0]?.groupLabel ?? group, heads, total: heads.reduce((s, h) => s + h.total, 0) };
    });

    return { groups, total: groups.reduce((s, g) => s + g.total, 0) };
  }

  const equityAndLiabilities = buildSide("EQUITY_AND_LIABILITIES");
  const assets = buildSide("ASSETS");
  const unclassifiedTotal =
    unclassified.assets.reduce((s, i) => s + i.amount, 0) -
    unclassified.liabilities.reduce((s, i) => s + i.amount, 0) -
    unclassified.equity.reduce((s, i) => s + i.amount, 0);

  // Unclassified assets add to the Assets side; unclassified liabilities/
  // equity add to the other side — same sign convention as their
  // classified counterparts, so "balanced" stays meaningful even with gaps.
  const totalAssetsSide = assets.total + unclassified.assets.reduce((s, i) => s + i.amount, 0);
  const totalEqLiabSide = equityAndLiabilities.total + unclassified.liabilities.reduce((s, i) => s + i.amount, 0) + unclassified.equity.reduce((s, i) => s + i.amount, 0);
  const difference = Math.round((totalAssetsSide - totalEqLiabSide) * 100) / 100;

  return {
    asOf: asOf ? asOf.toISOString().slice(0, 10) : null,
    equityAndLiabilities,
    assets,
    unclassified: { ...unclassified, total: unclassifiedTotal },
    balanced: Math.abs(difference) < 0.01,
    difference,
  };
}
