import { Router } from "express";
import { prisma } from "../db";
import { authenticate } from "../middleware/auth";

const router = Router();
router.use(authenticate);

interface LineInput {
  accountId: string;
  businessPartnerId?: string | null;
  debit?: number;
  credit?: number;
  narration?: string | null;
}

// POST /journal — post a balanced entry. This is the one write path that
// locks an org's domain selection (trg_lock_org_domains fires on INSERT).
router.post("/", async (req, res) => {
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

  const organizationId = req.user!.organizationId;

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
    const created = await tx.journalEntry.create({
      data: {
        organizationId,
        branchId: branchId ?? req.user!.branchId ?? null,
        entryDate: new Date(entryDate),
        narration,
        voucherType: voucherType ?? null,
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
  res.status(201).json({ data: full });
});

// GET /journal?from=&to=&branchId= — list, most recent first.
router.get("/", async (req, res) => {
  const { from, to, branchId } = req.query;
  const entries = await prisma.journalEntry.findMany({
    where: {
      organizationId: req.user!.organizationId,
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
    include: { journalLines: { include: { account: true, businessPartner: true } } },
    orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  res.json({ data: entries });
});

// GET /journal/ledger?accountId=&businessPartnerId=&from=&to=
// Running balance for one account (or one business partner's sub-ledger cut
// of a control account).
router.get("/ledger", async (req, res) => {
  const { accountId, businessPartnerId, from, to } = req.query;
  if (!accountId) return res.status(400).json({ message: "accountId is required." });

  const account = await prisma.account.findFirst({
    where: { id: String(accountId), organizationId: req.user!.organizationId },
  });
  if (!account) return res.status(404).json({ message: "Account not found." });

  const lines = await prisma.journalLine.findMany({
    where: {
      accountId: String(accountId),
      ...(businessPartnerId ? { businessPartnerId: String(businessPartnerId) } : {}),
      journalEntry: {
        organizationId: req.user!.organizationId,
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
  const organizationId = req.user!.organizationId;

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

export default router;
