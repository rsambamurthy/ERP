import { Router } from "express";
import type { Account } from "@prisma/client";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { upload } from "../lib/upload";
import { computeScheduleIIIBalanceSheet } from "../lib/scheduleIII";

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

// Every org's core COA (seeded at provisioning, see prisma/seed.ts +
// lib/provisioning.ts) always includes these two codes — Cash in Hand and
// Bank Account. Cash Book / Receipts & Payments key off them directly rather
// than a dedicated "is_cash" flag, since that's the one thing guaranteed
// present for every organization regardless of domain.
const CASH_BANK_CODES = ["1001", "1002"];

const router = Router();
router.use(authenticate, requireActiveSubscription);

interface LineInput {
  accountId: string;
  businessPartnerId?: string | null;
  debit?: number;
  credit?: number;
  narration?: string | null;
}

// POST /journal — post a balanced entry. This is the one write path that
// locks an org's domain selection (trg_lock_org_domains fires on INSERT).
router.post("/", requirePermission("journal.post"), async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const { entryDate, narration, voucherType, branchId, lines } = req.body ?? {};

  if (!entryDate || !narration) {
    return res.status(400).json({ message: "entryDate and narration are required." });
  }
  if (!Array.isArray(lines) || lines.length < 2) {
    return res.status(400).json({ message: "At least 2 lines are required." });
  }
  if (voucherType && !["BV", "CV", "JV"].includes(voucherType)) {
    return res.status(400).json({ message: "voucherType must be BV, CV, or JV." });
  }

  const typedLines: LineInput[] = lines;
  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of typedLines) {
    if (!line.accountId) return res.status(400).json({ message: "Every line needs an accountId." });
    const debit = Number(line.debit ?? 0);
    const credit = Number(line.credit ?? 0);
    if (debit < 0 || credit < 0) return res.status(400).json({ message: "Amounts cannot be negative." });
    if (debit > 0 && credit > 0) {
      return res.status(400).json({ message: "A line can't have both a debit and a credit." });
    }
    totalDebit += debit;
    totalCredit += credit;
  }
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return res.status(400).json({
      message: `Entry is not balanced — debit ${totalDebit.toFixed(2)} vs credit ${totalCredit.toFixed(2)}.`,
    });
  }

  // Control-account lines (e.g. Trade Receivables) must be tagged with a
  // business partner — that's what makes the sub-ledger work.
  const accountIds = [...new Set(typedLines.map((l) => l.accountId))];
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds }, organizationId },
  });
  if (accounts.length !== accountIds.length) {
    return res.status(400).json({ message: "One or more accounts are invalid for this organization." });
  }
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  for (const line of typedLines) {
    const account = accountById.get(line.accountId)!;
    if (account.isControlAccount && !line.businessPartnerId) {
      return res.status(400).json({
        message: `${account.accountName} is a control account — every line against it needs a business partner.`,
      });
    }
  }

  const entry = await prisma.$transaction(async (tx) => {
    // Sequential reference code (JV-0001/BV-0001/CV-0001), scoped per org
    // per voucher type — only manual entries created here get one; every
    // auto-posted document (Sales Invoice, Purchase Bill, etc.) creates its
    // JournalEntry directly and keeps this null, relying on its own
    // invoiceNumber/billNumber/returnNumber instead. Same plain
    // count-based generation as SI-/PB- numbers elsewhere — not
    // concurrency-hardened, an accepted existing tradeoff in this codebase.
    const vt = voucherType ?? "JV";
    const count = await tx.journalEntry.count({ where: { organizationId, voucherType: vt, voucherNumber: { not: null } } });
    const voucherNumber = `${vt}-${String(count + 1).padStart(4, "0")}`;

    const created = await tx.journalEntry.create({
      data: {
        organizationId,
        branchId: branchId ?? req.user!.branchId ?? null,
        entryDate: new Date(entryDate),
        narration,
        voucherType: vt,
        voucherNumber,
        createdBy: req.user!.userId,
      },
    });
    await tx.journalLine.createMany({
      data: typedLines.map((l) => ({
        journalEntryId: created.id,
        accountId: l.accountId,
        businessPartnerId: l.businessPartnerId ?? null,
        debit: l.debit ?? 0,
        credit: l.credit ?? 0,
        narration: l.narration ?? null,
      })),
    });
    return created;
  });

  const full = await prisma.journalEntry.findUnique({
    where: { id: entry.id },
    include: { journalLines: { include: { account: true, businessPartner: true } } },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "CREATE", entityType: "journal_entry", entityId: entry.id,
    summary: `Posted ${entry.voucherNumber} — ${narration} (${totalDebit.toFixed(2)})`,
  });
  res.status(201).json({ data: full });
});

// PATCH /journal/:id — edit a MANUAL entry (referenceType null) in place.
// Auto-posted entries (Sales Invoice, Purchase Bill, Stock Adjustment,
// Sales/Purchase Return) stay read-only here — correcting one of those
// means posting through its own module, not this route. voucherType is
// locked once created (its voucherNumber's prefix already reflects it) —
// same "structural fields frozen after creation" convention Item.sku /
// Account.accountCode already use.
router.patch("/:id", requirePermission("journal.post"), async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const existing = await prisma.journalEntry.findFirst({ where: { id: req.params.id, organizationId } });
  if (!existing) return res.status(404).json({ message: "Journal entry not found." });
  if (existing.referenceType) {
    return res.status(409).json({ message: "This entry was posted automatically by another module and can't be edited here." });
  }

  const { entryDate, narration, branchId, lines } = req.body ?? {};
  if (!entryDate || !narration) {
    return res.status(400).json({ message: "entryDate and narration are required." });
  }
  if (!Array.isArray(lines) || lines.length < 2) {
    return res.status(400).json({ message: "At least 2 lines are required." });
  }

  const typedLines: LineInput[] = lines;
  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of typedLines) {
    if (!line.accountId) return res.status(400).json({ message: "Every line needs an accountId." });
    const debit = Number(line.debit ?? 0);
    const credit = Number(line.credit ?? 0);
    if (debit < 0 || credit < 0) return res.status(400).json({ message: "Amounts cannot be negative." });
    if (debit > 0 && credit > 0) return res.status(400).json({ message: "A line can't have both a debit and a credit." });
    totalDebit += debit;
    totalCredit += credit;
  }
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return res.status(400).json({
      message: `Entry is not balanced — debit ${totalDebit.toFixed(2)} vs credit ${totalCredit.toFixed(2)}.`,
    });
  }

  const accountIds = [...new Set(typedLines.map((l) => l.accountId))];
  const accounts = await prisma.account.findMany({ where: { id: { in: accountIds }, organizationId } });
  if (accounts.length !== accountIds.length) {
    return res.status(400).json({ message: "One or more accounts are invalid for this organization." });
  }
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  for (const line of typedLines) {
    const account = accountById.get(line.accountId)!;
    if (account.isControlAccount && !line.businessPartnerId) {
      return res.status(400).json({
        message: `${account.accountName} is a control account — every line against it needs a business partner.`,
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.journalEntry.update({
      where: { id: existing.id },
      data: { entryDate: new Date(entryDate), narration, branchId: branchId ?? existing.branchId ?? null },
    });
    await tx.journalLine.deleteMany({ where: { journalEntryId: existing.id } });
    await tx.journalLine.createMany({
      data: typedLines.map((l) => ({
        journalEntryId: existing.id,
        accountId: l.accountId,
        businessPartnerId: l.businessPartnerId ?? null,
        debit: l.debit ?? 0,
        credit: l.credit ?? 0,
        narration: l.narration ?? null,
      })),
    });
  });

  const full = await prisma.journalEntry.findUnique({
    where: { id: existing.id },
    include: { journalLines: { include: { account: true, businessPartner: true } } },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "journal_entry", entityId: existing.id,
    summary: `Updated ${existing.voucherNumber ?? existing.voucherType ?? "entry"} — ${narration} (${totalDebit.toFixed(2)})`,
  });
  res.json({ data: full });
});

// ── Supporting document attachment — one per entry, replacing on re-upload.
// Allowed on any entry (manual or auto-posted) — attaching a scanned bill
// is documentation, not a change to the ledger, so it doesn't fall under
// the "auto-posted entries are read-only" rule above.

router.post("/:id/attachment", requirePermission("journal.post"), upload.single("file"), async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const entry = await prisma.journalEntry.findFirst({ where: { id: req.params.id, organizationId } });
  if (!entry) return res.status(404).json({ message: "Journal entry not found." });
  if (!req.file) return res.status(400).json({ message: "No file uploaded." });

  await prisma.journalEntry.update({
    where: { id: entry.id },
    data: {
      attachmentFilename: req.file.originalname,
      attachmentMimeType: req.file.mimetype,
      attachmentSize: req.file.size,
      attachmentData: req.file.buffer,
    },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "journal_entry", entityId: entry.id,
    summary: `Attached ${req.file.originalname} to ${entry.voucherNumber ?? entry.voucherType ?? "entry"}`,
  });
  res.json({ data: { attachmentFilename: req.file.originalname, attachmentMimeType: req.file.mimetype, attachmentSize: req.file.size } });
});

router.get("/:id/attachment", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const entry = await prisma.journalEntry.findFirst({ where: { id: req.params.id, organizationId } });
  if (!entry || !entry.attachmentData) return res.status(404).json({ message: "No attachment found." });
  res.setHeader("Content-Type", entry.attachmentMimeType || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${entry.attachmentFilename || "attachment"}"`);
  res.send(Buffer.from(entry.attachmentData));
});

router.delete("/:id/attachment", requirePermission("journal.post"), async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const entry = await prisma.journalEntry.findFirst({ where: { id: req.params.id, organizationId } });
  if (!entry) return res.status(404).json({ message: "Journal entry not found." });

  await prisma.journalEntry.update({
    where: { id: entry.id },
    data: { attachmentFilename: null, attachmentMimeType: null, attachmentSize: null, attachmentData: null },
  });
  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "UPDATE", entityType: "journal_entry", entityId: entry.id,
    summary: `Removed attachment from ${entry.voucherNumber ?? entry.voucherType ?? "entry"}`,
  });
  res.json({ data: { removed: true } });
});

// GET /journal?from=&to=&branchId= — list, most recent first.
router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const { from, to, branchId } = req.query;
  const entries = await prisma.journalEntry.findMany({
    where: {
      organizationId,
      ...(branchId ? { branchId: String(branchId) } : {}),
      ...(from || to
        ? {
            entryDate: {
              ...(from ? { gte: new Date(String(from)) } : {}),
              ...(to ? { lte: new Date(String(to)) } : {}),
            },
          }
        : {}),
    },
    include: {
      journalLines: { include: { account: true, businessPartner: true } },
      // Resolve the sibling document's own number for auto-posted entries
      // (referenceType set) — the UI shows this instead of voucherNumber,
      // which stays null for these rows.
      salesInvoice: { select: { invoiceNumber: true } },
      purchaseBill: { select: { billNumber: true } },
      salesReturn: { select: { returnNumber: true } },
      purchaseReturn: { select: { returnNumber: true } },
      stockAdjustment: { select: { id: true } },
    },
    orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  res.json({ data: entries });
});

// GET /journal/ledger?accountId=&businessPartnerId=&from=&to=
// Running balance for one account (or one business partner's sub-ledger cut
// of a control account).
router.get("/ledger", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const { accountId, businessPartnerId, from, to } = req.query;
  if (!accountId) return res.status(400).json({ message: "accountId is required." });

  const account = await prisma.account.findFirst({
    where: { id: String(accountId), organizationId },
  });
  if (!account) return res.status(404).json({ message: "Account not found." });

  const lines = await prisma.journalLine.findMany({
    where: {
      accountId: String(accountId),
      ...(businessPartnerId ? { businessPartnerId: String(businessPartnerId) } : {}),
      journalEntry: {
        organizationId,
        ...(from || to
          ? {
              entryDate: {
                ...(from ? { gte: new Date(String(from)) } : {}),
                ...(to ? { lte: new Date(String(to)) } : {}),
              },
            }
          : {}),
      },
    },
    include: { journalEntry: true, businessPartner: true },
    orderBy: [{ journalEntry: { entryDate: "asc" } }, { journalEntry: { createdAt: "asc" } }],
  });

  const debitFirst = ["ASSET", "EXPENSE"].includes(account.accountType);
  let balance = Number(account.openingBalance ?? 0);
  if (account.openingBalanceType === "CREDIT") balance = -balance;
  if (!debitFirst) balance = -balance;

  const rows = lines.map((l) => {
    const debit = Number(l.debit);
    const credit = Number(l.credit);
    balance += debitFirst ? debit - credit : credit - debit;
    return {
      date: l.journalEntry.entryDate,
      narration: l.narration || l.journalEntry.narration,
      businessPartner: l.businessPartner?.name ?? null,
      debit,
      credit,
      balance,
    };
  });

  res.json({ data: { account, openingBalance: Number(account.openingBalance ?? 0), rows } });
});

// GET /journal/trial-balance?asOf=&branchId=
router.get("/trial-balance", async (req, res) => {
  const { asOf, branchId } = req.query;
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const accounts = await prisma.account.findMany({
    where: { organizationId, deletedAt: null, isGroup: false },
    orderBy: [{ accountType: "asc" }, { sortOrder: "asc" }, { accountCode: "asc" }],
  });

  const sums = await prisma.journalLine.groupBy({
    by: ["accountId"] as const,
    where: {
      journalEntry: {
        organizationId,
        ...(branchId ? { branchId: String(branchId) } : {}),
        ...(asOf ? { entryDate: { lte: new Date(String(asOf)) } } : {}),
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

  res.json({ data: { asOf: asOf ?? null, rows, totalDebit, totalCredit } });
});

// GET /journal/pnl?from=&to=&branchId= — Income vs Expense for a period
// (movement only, not cumulative — P&L is period-specific, unlike the
// balance sheet / trial balance which are "as of a date").
router.get("/pnl", async (req, res) => {
  const { from, to, branchId } = req.query;
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

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
        ...(branchId ? { branchId: String(branchId) } : {}),
        ...(from || to
          ? {
              entryDate: {
                ...(from ? { gte: new Date(String(from)) } : {}),
                ...(to ? { lte: new Date(String(to)) } : {}),
              },
            }
          : {}),
      },
    },
    _sum: { debit: true, credit: true },
  });
  const sumByAccount = new Map(sums.map((s) => [s.accountId, s._sum]));

  const income: { account: Account; amount: number }[] = [];
  const expense: { account: Account; amount: number }[] = [];
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

  res.json({
    data: { from: from ?? null, to: to ?? null, income, expense, totalIncome, totalExpense, netProfit: totalIncome - totalExpense },
  });
});

// GET /journal/balance-sheet?asOf=&branchId= — Assets vs Liabilities+Equity,
// cumulative as of a date, with net profit-to-date folded into Equity as
// "Current Earnings" so the two sides actually balance.
router.get("/balance-sheet", async (req, res) => {
  const { asOf, branchId } = req.query;
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

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
        ...(branchId ? { branchId: String(branchId) } : {}),
        ...(asOf ? { entryDate: { lte: new Date(String(asOf)) } } : {}),
      },
    },
    _sum: { debit: true, credit: true },
  });
  const sumByAccount = new Map(sums.map((s) => [s.accountId, s._sum]));

  const assets: { account: Account; amount: number }[] = [];
  const liabilities: { account: Account; amount: number }[] = [];
  const equity: { account: Account; amount: number }[] = [];
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

  res.json({
    data: {
      asOf: asOf ?? null, assets, liabilities, equity,
      totalAssets, totalLiabilities, totalEquity, netProfitToDate,
      totalEquityAndProfit: totalEquity + netProfitToDate,
      balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity + netProfitToDate)) < 0.01,
    },
  });
});

// GET /journal/schedule-iii-balance-sheet?asOf=&branchId= — the same
// underlying figures as /balance-sheet above, grouped into the Companies
// Act Schedule III hierarchy instead of a flat Assets/Liabilities/Equity
// list — see lib/scheduleIII.ts for the full computation and its
// documented simplifications.
router.get("/schedule-iii-balance-sheet", async (req, res) => {
  const { asOf, branchId } = req.query;
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const report = await computeScheduleIIIBalanceSheet(
    organizationId,
    asOf ? new Date(String(asOf)) : undefined,
    branchId ? String(branchId) : undefined
  );
  res.json({ data: report });
});

// GET /journal/cash-book?from=&to=&branchId= — ledger of the Cash + Bank
// accounts together, one combined running balance.
router.get("/cash-book", async (req, res) => {
  const { from, to, branchId } = req.query;
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const cashAccounts = await prisma.account.findMany({
    where: { organizationId, deletedAt: null, accountCode: { in: CASH_BANK_CODES } },
  });
  if (cashAccounts.length === 0) return res.json({ data: { rows: [], openingBalance: 0 } });

  const lines = await prisma.journalLine.findMany({
    where: {
      accountId: { in: cashAccounts.map((a) => a.id) },
      journalEntry: {
        organizationId,
        ...(branchId ? { branchId: String(branchId) } : {}),
        ...(from || to
          ? { entryDate: { ...(from ? { gte: new Date(String(from)) } : {}), ...(to ? { lte: new Date(String(to)) } : {}) } }
          : {}),
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

  res.json({ data: { rows, openingBalance } });
});

// GET /journal/receipts-payments?from=&to=&branchId= — the same Cash+Bank
// movement, split into money-in (Receipts) and money-out (Payments).
router.get("/receipts-payments", async (req, res) => {
  const { from, to, branchId } = req.query;
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const cashAccounts = await prisma.account.findMany({
    where: { organizationId, deletedAt: null, accountCode: { in: CASH_BANK_CODES } },
  });
  if (cashAccounts.length === 0) return res.json({ data: { receipts: [], payments: [], totalReceipts: 0, totalPayments: 0 } });

  const lines = await prisma.journalLine.findMany({
    where: {
      accountId: { in: cashAccounts.map((a) => a.id) },
      journalEntry: {
        organizationId,
        ...(branchId ? { branchId: String(branchId) } : {}),
        ...(from || to
          ? { entryDate: { ...(from ? { gte: new Date(String(from)) } : {}), ...(to ? { lte: new Date(String(to)) } : {}) } }
          : {}),
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

  res.json({
    data: {
      receipts, payments,
      totalReceipts: receipts.reduce((s, r) => s + r.amount, 0),
      totalPayments: payments.reduce((s, p) => s + p.amount, 0),
    },
  });
});

// GET /journal/day-book?from=&to=&branchId= — every posted line, chronological.
router.get("/day-book", async (req, res) => {
  const { from, to, branchId } = req.query;
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const entries = await prisma.journalEntry.findMany({
    where: {
      organizationId,
      ...(branchId ? { branchId: String(branchId) } : {}),
      ...(from || to
        ? { entryDate: { ...(from ? { gte: new Date(String(from)) } : {}), ...(to ? { lte: new Date(String(to)) } : {}) } }
        : {}),
    },
    include: { journalLines: { include: { account: true, businessPartner: true } } },
    orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
  });

  res.json({ data: entries });
});

// GET /journal/:id — single entry with full detail, for the detail panel.
// Registered last among GET routes so it doesn't shadow the literal paths
// above (ledger, trial-balance, pnl, balance-sheet, cash-book,
// receipts-payments, day-book) — Express matches in registration order and
// ":id" would otherwise swallow every one of those.
router.get("/:id", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const entry = await prisma.journalEntry.findFirst({
    where: { id: req.params.id, organizationId },
    include: {
      journalLines: { include: { account: true, businessPartner: true } },
      salesInvoice: { select: { invoiceNumber: true } },
      purchaseBill: { select: { billNumber: true } },
      salesReturn: { select: { returnNumber: true } },
      purchaseReturn: { select: { returnNumber: true } },
      stockAdjustment: { select: { id: true } },
    },
  });
  if (!entry) return res.status(404).json({ message: "Journal entry not found." });
  res.json({ data: entry });
});

export default router;
