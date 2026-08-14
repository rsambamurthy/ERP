// Shared report computations — extracted from routes/journal.ts so both the
// report endpoints (GET /journal/trial-balance, /pnl, /balance-sheet,
// /cash-book, /receipts-payments) and the chatbot's tool-calling agent
// (lib/chatbotTools.ts) call exactly the same logic. Never duplicate this
// math elsewhere — the chatbot's numbers must always match the report
// pages', or it undermines trust in both.
import { prisma } from "../db";

// Same two seeded account codes routes/journal.ts's CASH_BANK_CODES uses
// (Cash in Hand, Bank Account) — duplicated here rather than imported to
// avoid a routes -> lib -> routes circular import.
const CASH_BANK_CODES = ["1001", "1002"];

export async function computeTrialBalance(organizationId: string, asOf?: string, branchId?: string) {
  const accounts = await prisma.account.findMany({
    where: { organizationId, deletedAt: null, isGroup: false },
    orderBy: [{ accountType: "asc" }, { sortOrder: "asc" }, { accountCode: "asc" }],
  });

  const sums = await prisma.journalLine.groupBy({
    by: ["accountId"] as const,
    where: {
      journalEntry: {
        organizationId,
        ...(branchId ? { branchId } : {}),
        ...(asOf ? { entryDate: { lte: new Date(asOf) } } : {}),
      },
    },
    _sum: { debit: true, credit: true },
  });
  const sumByAccount = new Map(sums.map((s) => [s.accountId, s._sum]));

  let totalDebit = 0;
  let totalCredit = 0;
  const rows = accounts
    .map((a) => {
      const debitFirst = ["ASSET", "EXPENSE"].includes(a.accountType);
      let opening = Number(a.openingBalance ?? 0);
      if (a.openingBalanceType === "CREDIT") opening = -opening;
      if (!debitFirst) opening = -opening;

      const sum = sumByAccount.get(a.id);
      const movement = debitFirst
        ? Number(sum?.debit ?? 0) - Number(sum?.credit ?? 0)
        : Number(sum?.credit ?? 0) - Number(sum?.debit ?? 0);
      const net = opening + movement;

      const debit = debitFirst ? Math.max(net, 0) : Math.max(-net, 0);
      const credit = debitFirst ? Math.max(-net, 0) : Math.max(net, 0);
      totalDebit += debit;
      totalCredit += credit;
      return { account: a, debit, credit };
    })
    .filter((r) => r.debit !== 0 || r.credit !== 0);

  return { asOf: asOf ?? null, rows, totalDebit, totalCredit };
}

export async function computePnl(organizationId: string, from?: string, to?: string, branchId?: string) {
  const accounts = await prisma.account.findMany({
    where: { organizationId, deletedAt: null, isGroup: false, accountType: { in: ["INCOME", "EXPENSE"] } },
    orderBy: [{ accountType: "asc" }, { sortOrder: "asc" }, { accountCode: "asc" }],
  });

  const sums = await prisma.journalLine.groupBy({
    by: ["accountId"] as const,
    where: {
      accountId: { in: accounts.map((a) => a.id) },
      journalEntry: {
        organizationId,
        ...(branchId ? { branchId } : {}),
        ...(from || to ? { entryDate: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
      },
    },
    _sum: { debit: true, credit: true },
  });
  const sumByAccount = new Map(sums.map((s) => [s.accountId, s._sum]));

  const income: { account: typeof accounts[number]; amount: number }[] = [];
  const expense: { account: typeof accounts[number]; amount: number }[] = [];
  let totalIncome = 0;
  let totalExpense = 0;

  for (const a of accounts) {
    const sum = sumByAccount.get(a.id);
    if (a.accountType === "INCOME") {
      const amount = Number(sum?.credit ?? 0) - Number(sum?.debit ?? 0);
      if (amount !== 0) { income.push({ account: a, amount }); totalIncome += amount; }
    } else {
      const amount = Number(sum?.debit ?? 0) - Number(sum?.credit ?? 0);
      if (amount !== 0) { expense.push({ account: a, amount }); totalExpense += amount; }
    }
  }

  return { from: from ?? null, to: to ?? null, income, expense, totalIncome, totalExpense, netProfit: totalIncome - totalExpense };
}

export async function computeBalanceSheet(organizationId: string, asOf?: string, branchId?: string) {
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
        ...(asOf ? { entryDate: { lte: new Date(asOf) } } : {}),
      },
    },
    _sum: { debit: true, credit: true },
  });
  const sumByAccount = new Map(sums.map((s) => [s.accountId, s._sum]));

  const assets: { account: typeof accounts[number]; amount: number }[] = [];
  const liabilities: { account: typeof accounts[number]; amount: number }[] = [];
  const equity: { account: typeof accounts[number]; amount: number }[] = [];
  let totalAssets = 0, totalLiabilities = 0, totalEquity = 0, netProfitToDate = 0;

  for (const a of accounts) {
    const sum = sumByAccount.get(a.id);
    let opening = Number(a.openingBalance ?? 0);
    if (a.openingBalanceType === "CREDIT") opening = -opening;

    if (a.accountType === "ASSET") {
      const net = opening + Number(sum?.debit ?? 0) - Number(sum?.credit ?? 0);
      if (net !== 0) { assets.push({ account: a, amount: net }); totalAssets += net; }
    } else if (a.accountType === "LIABILITY") {
      const net = -opening + Number(sum?.credit ?? 0) - Number(sum?.debit ?? 0);
      if (net !== 0) { liabilities.push({ account: a, amount: net }); totalLiabilities += net; }
    } else if (a.accountType === "EQUITY") {
      const net = -opening + Number(sum?.credit ?? 0) - Number(sum?.debit ?? 0);
      if (net !== 0) { equity.push({ account: a, amount: net }); totalEquity += net; }
    } else if (a.accountType === "INCOME") {
      netProfitToDate += Number(sum?.credit ?? 0) - Number(sum?.debit ?? 0);
    } else if (a.accountType === "EXPENSE") {
      netProfitToDate -= Number(sum?.debit ?? 0) - Number(sum?.credit ?? 0);
    }
  }

  return {
    asOf: asOf ?? null, assets, liabilities, equity,
    totalAssets, totalLiabilities, totalEquity, netProfitToDate,
    totalEquityAndProfit: totalEquity + netProfitToDate,
    balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity + netProfitToDate)) < 0.01,
  };
}

export async function computeCashBook(organizationId: string, from?: string, to?: string, branchId?: string) {
  const cashAccounts = await prisma.account.findMany({
    where: { organizationId, deletedAt: null, accountCode: { in: CASH_BANK_CODES } },
  });
  if (cashAccounts.length === 0) return { rows: [], openingBalance: 0 };

  const lines = await prisma.journalLine.findMany({
    where: {
      accountId: { in: cashAccounts.map((a) => a.id) },
      journalEntry: {
        organizationId,
        ...(branchId ? { branchId } : {}),
        ...(from || to ? { entryDate: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
      },
    },
    include: { journalEntry: true, account: true },
    orderBy: [{ journalEntry: { entryDate: "asc" } }, { journalEntry: { createdAt: "asc" } }],
  });

  const openingBalance = cashAccounts.reduce((s, a) => {
    let ob = Number(a.openingBalance ?? 0);
    if (a.openingBalanceType === "CREDIT") ob = -ob;
    return s + ob;
  }, 0);

  let balance = openingBalance;
  const rows = lines.map((l) => {
    const debit = Number(l.debit);
    const credit = Number(l.credit);
    balance += debit - credit;
    return {
      date: l.journalEntry.entryDate,
      narration: l.narration || l.journalEntry.narration,
      account: l.account.accountName,
      debit, credit, balance,
    };
  });

  return { rows, openingBalance };
}

export async function computeReceiptsPayments(organizationId: string, from?: string, to?: string, branchId?: string) {
  const cashAccounts = await prisma.account.findMany({
    where: { organizationId, deletedAt: null, accountCode: { in: CASH_BANK_CODES } },
  });
  if (cashAccounts.length === 0) return { receipts: [], payments: [], totalReceipts: 0, totalPayments: 0 };

  const lines = await prisma.journalLine.findMany({
    where: {
      accountId: { in: cashAccounts.map((a) => a.id) },
      journalEntry: {
        organizationId,
        ...(branchId ? { branchId } : {}),
        ...(from || to ? { entryDate: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
      },
    },
    include: { journalEntry: true, account: true, businessPartner: true },
    orderBy: [{ journalEntry: { entryDate: "asc" } }],
  });

  const receipts = lines
    .filter((l) => Number(l.debit) > 0)
    .map((l) => ({
      date: l.journalEntry.entryDate, narration: l.narration || l.journalEntry.narration,
      account: l.account.accountName, partner: l.businessPartner?.name ?? null, amount: Number(l.debit),
    }));
  const payments = lines
    .filter((l) => Number(l.credit) > 0)
    .map((l) => ({
      date: l.journalEntry.entryDate, narration: l.narration || l.journalEntry.narration,
      account: l.account.accountName, partner: l.businessPartner?.name ?? null, amount: Number(l.credit),
    }));

  return {
    receipts, payments,
    totalReceipts: receipts.reduce((s, r) => s + r.amount, 0),
    totalPayments: payments.reduce((s, p) => s + p.amount, 0),
  };
}
