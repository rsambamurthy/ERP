import { Router } from "express";
import type { Account } from "@prisma/client";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { upload } from "../lib/upload";
import { computeScheduleIIIBalanceSheet } from "../lib/scheduleIII";
import { computeTrialBalance, computePnl, computeBalanceSheet, computeCashBook, computeReceiptsPayments } from "../lib/reports";
import { buildTemplateWorkbook, loadUploadedWorksheet, cellText, cellDateIso } from "../lib/xlsxTemplate";

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
  const data = await computeTrialBalance(organizationId, asOf ? String(asOf) : undefined, branchId ? String(branchId) : undefined);
  res.json({ data });
});

// GET /journal/pnl?from=&to=&branchId= — Income vs Expense for a period
// (movement only, not cumulative — P&L is period-specific, unlike the
// balance sheet / trial balance which are "as of a date").
router.get("/pnl", async (req, res) => {
  const { from, to, branchId } = req.query;
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const data = await computePnl(
    organizationId,
    from ? String(from) : undefined,
    to ? String(to) : undefined,
    branchId ? String(branchId) : undefined
  );
  res.json({ data });
});

// GET /journal/balance-sheet?asOf=&branchId= — Assets vs Liabilities+Equity,
// cumulative as of a date, with net profit-to-date folded into Equity as
// "Current Earnings" so the two sides actually balance.
router.get("/balance-sheet", async (req, res) => {
  const { asOf, branchId } = req.query;
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const data = await computeBalanceSheet(organizationId, asOf ? String(asOf) : undefined, branchId ? String(branchId) : undefined);
  res.json({ data });
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
  const data = await computeCashBook(
    organizationId,
    from ? String(from) : undefined,
    to ? String(to) : undefined,
    branchId ? String(branchId) : undefined
  );
  res.json({ data });
});

// GET /journal/receipts-payments?from=&to=&branchId= — the same Cash+Bank
// movement, split into money-in (Receipts) and money-out (Payments).
router.get("/receipts-payments", async (req, res) => {
  const { from, to, branchId } = req.query;
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const data = await computeReceiptsPayments(
    organizationId,
    from ? String(from) : undefined,
    to ? String(to) : undefined,
    branchId ? String(branchId) : undefined
  );
  res.json({ data });
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

// ── Bulk upload (Template Download + Bulk Upload) ─────────────────────────
// Unlike every other bulk upload in this app (Chart of Accounts, Items,
// Business Partners, Currency Rates — all flat, one row per record), a
// Journal Entry is a header (date/narration/voucher type) plus at least two
// balanced lines. The template is therefore one row per LINE, grouped into
// a single entry by a shared "Voucher Ref" the uploader assigns — any
// string works, it only has to be unique *within this file*. Header fields
// (Entry Date, Voucher Type, Branch Code, Entry Narration) only need to be
// filled in once per voucher; repeating the same value on every line is
// fine too, but a *conflicting* value on a later line is flagged as an
// error rather than silently overridden, to catch an accidental autofill
// mistake rather than let it quietly change what gets posted.
//
// There is no "update" case here — unlike Items/Business Partners, an
// uploaded voucher never matches an existing entry; every valid group
// always creates a new posted entry, same as posting one by hand through
// the regular form. A group with ANY problem (unbalanced, bad account
// code, missing business partner on a control account, inconsistent
// header fields) has every one of its lines marked "error" together —
// never just the one line that happens to be wrong — so a partial voucher
// can never reach Apply. Each row keeps its own specific message where it
// has one; a row with nothing wrong on it individually falls back to
// whatever problem is holding up the rest of its voucher.

const JOURNAL_COLUMNS = [
  { header: "Voucher Ref *", hint: "← required, groups lines into one entry", width: 14 },
  { header: "Entry Date (YYYY-MM-DD) *", hint: "← required, once per voucher", width: 24 },
  { header: "Voucher Type", hint: "optional, blank = JV", width: 12, dropdown: ["BV", "CV", "JV"] },
  { header: "Branch Code", hint: "optional, blank = your default branch", width: 14 },
  { header: "Account Code *", hint: "← required, from Chart of Accounts", width: 16 },
  { header: "Business Partner Code", hint: "required only for control accounts", width: 20 },
  { header: "Debit", hint: "exactly one of Debit/Credit per line", width: 14, numFmt: "#,##0.00" },
  { header: "Credit", hint: "exactly one of Debit/Credit per line", width: 14, numFmt: "#,##0.00" },
  { header: "Line Narration", hint: "optional", width: 26 },
  { header: "Entry Narration *", hint: "← required, once per voucher", width: 30 },
];

interface JournalLinePreviewRow {
  rowNum: number;
  voucherRef: string;
  entryDate: string | null;
  voucherType: string;
  branchCode: string | null;
  accountCode: string;
  accountName: string | null;
  businessPartnerCode: string | null;
  debit: number;
  credit: number;
  lineNarration: string | null;
  entryNarration: string | null;
  status: "create" | "update" | "error";
  error?: string;
}

router.get("/bulk-upload/template", requirePermission("journal.post"), async (req, res) => {
  const buffer = await buildTemplateWorkbook("Journal Entries", JOURNAL_COLUMNS);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="SmartERP_JournalEntries_Template.xlsx"');
  res.send(buffer);
});

router.post("/bulk-upload/preview", requirePermission("journal.post"), upload.single("file"), async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  if (!req.file) return res.status(400).json({ message: "No file uploaded." });

  const ws = await loadUploadedWorksheet(req.file.buffer);
  if (!ws) return res.json({ data: [] });

  // Parse every data row first, in file order. Rows are decorated in place
  // by the grouping/validation pass below, but this array's order never
  // changes — that's what the shared bulk-upload table expects.
  const rows: JournalLinePreviewRow[] = [];
  ws.eachRow((row, rowNum) => {
    if (rowNum <= 2) return;
    const voucherRef = cellText(row, 1);
    const accountCode = cellText(row, 5);
    const debitRaw = row.getCell(7).value;
    const creditRaw = row.getCell(8).value;
    if (!voucherRef && !accountCode && (debitRaw == null || debitRaw === "") && (creditRaw == null || creditRaw === "")) return;

    rows.push({
      rowNum,
      voucherRef: voucherRef ?? "",
      entryDate: cellDateIso(row, 2),
      voucherType: (cellText(row, 3) ?? "").toUpperCase(),
      branchCode: cellText(row, 4),
      accountCode: accountCode ?? "",
      accountName: null,
      businessPartnerCode: cellText(row, 6),
      debit: debitRaw != null && debitRaw !== "" ? Number(debitRaw) : 0,
      credit: creditRaw != null && creditRaw !== "" ? Number(creditRaw) : 0,
      lineNarration: cellText(row, 9),
      entryNarration: cellText(row, 10),
      status: "create",
    });
  });
  if (rows.length === 0) return res.json({ data: [] });

  // Rows with no Voucher Ref can't be grouped at all — fail individually,
  // before anything else runs.
  for (const r of rows) {
    if (!r.voucherRef) { r.status = "error"; r.error = "Voucher Ref is required on every line"; }
  }

  // Resolve every distinct code referenced anywhere in the file in three
  // queries total, rather than one query per row.
  const accountCodes = [...new Set(rows.map((r) => r.accountCode).filter(Boolean))];
  const bpCodes = [...new Set(rows.map((r) => r.businessPartnerCode).filter((c): c is string => !!c))];
  const branchCodes = [...new Set(rows.map((r) => r.branchCode).filter((c): c is string => !!c))];
  const [accounts, partners, branches] = await Promise.all([
    prisma.account.findMany({ where: { organizationId, accountCode: { in: accountCodes }, isActive: true } }),
    bpCodes.length ? prisma.businessPartner.findMany({ where: { organizationId, code: { in: bpCodes }, deletedAt: null } }) : Promise.resolve([]),
    branchCodes.length ? prisma.branch.findMany({ where: { organizationId, code: { in: branchCodes }, deletedAt: null } }) : Promise.resolve([]),
  ]);
  const accountByCode = new Map(accounts.map((a) => [a.accountCode, a]));
  const bpByCode = new Map(partners.map((p) => [p.code!, p]));
  const branchByCode = new Map(branches.map((b) => [b.code, b]));

  // Group by Voucher Ref, preserving first-seen order (a Map does this
  // naturally as entries are inserted).
  const groups = new Map<string, JournalLinePreviewRow[]>();
  for (const r of rows) {
    if (!r.voucherRef) continue; // already failed above
    if (!groups.has(r.voucherRef)) groups.set(r.voucherRef, []);
    groups.get(r.voucherRef)!.push(r);
  }

  for (const [voucherRef, group] of groups) {
    let hasError = false;
    const groupLevelErrors: string[] = [];

    // Header fields: first non-blank value in row order wins; a later row
    // that disagrees is flagged rather than silently overridden.
    let entryDate: string | null = null;
    let voucherType = "";
    let branchCode: string | null = null;
    let entryNarration: string | null = null;
    for (const r of group) {
      if (r.entryDate) {
        if (entryDate === null) entryDate = r.entryDate;
        else if (r.entryDate !== entryDate) { groupLevelErrors.push(`Row ${r.rowNum}: Entry Date doesn't match the rest of voucher "${voucherRef}"`); hasError = true; }
      }
      if (r.voucherType) {
        if (voucherType === "") voucherType = r.voucherType;
        else if (r.voucherType !== voucherType) { groupLevelErrors.push(`Row ${r.rowNum}: Voucher Type doesn't match the rest of voucher "${voucherRef}"`); hasError = true; }
      }
      if (r.branchCode) {
        if (branchCode === null) branchCode = r.branchCode;
        else if (r.branchCode !== branchCode) { groupLevelErrors.push(`Row ${r.rowNum}: Branch Code doesn't match the rest of voucher "${voucherRef}"`); hasError = true; }
      }
      if (r.entryNarration) {
        if (entryNarration === null) entryNarration = r.entryNarration;
        else if (r.entryNarration !== entryNarration) { groupLevelErrors.push(`Row ${r.rowNum}: Entry Narration doesn't match the rest of voucher "${voucherRef}"`); hasError = true; }
      }
    }
    if (voucherType === "") voucherType = "JV";

    if (group.length < 2) { groupLevelErrors.push(`Voucher "${voucherRef}" needs at least 2 lines`); hasError = true; }
    if (!entryDate) { groupLevelErrors.push(`Voucher "${voucherRef}" is missing Entry Date`); hasError = true; }
    if (!["BV", "CV", "JV"].includes(voucherType)) { groupLevelErrors.push(`Voucher "${voucherRef}": Voucher Type must be BV, CV, or JV`); hasError = true; }
    if (!entryNarration) { groupLevelErrors.push(`Voucher "${voucherRef}" is missing Entry Narration`); hasError = true; }
    if (branchCode && !branchByCode.has(branchCode)) { groupLevelErrors.push(`Voucher "${voucherRef}": Branch Code "${branchCode}" not found`); hasError = true; }

    let totalDebit = 0, totalCredit = 0;
    for (const r of group) {
      if (!r.accountCode) { r.error = "Account Code is required"; hasError = true; continue; }
      const account = accountByCode.get(r.accountCode);
      if (!account) { r.error = `Account Code "${r.accountCode}" not found`; hasError = true; continue; }
      r.accountName = account.accountName;

      if (r.debit < 0 || r.credit < 0) { r.error = "Amounts cannot be negative"; hasError = true; }
      else if (r.debit > 0 && r.credit > 0) { r.error = "A line can't have both a debit and a credit"; hasError = true; }
      else if (r.debit === 0 && r.credit === 0) { r.error = "Needs a debit or a credit"; hasError = true; }
      totalDebit += r.debit;
      totalCredit += r.credit;

      if (account.isControlAccount) {
        if (!r.businessPartnerCode) { r.error = r.error ?? `${account.accountName} is a control account — a Business Partner Code is required`; hasError = true; }
        else if (!bpByCode.has(r.businessPartnerCode)) { r.error = r.error ?? `Business Partner Code "${r.businessPartnerCode}" not found`; hasError = true; }
      }
    }
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      groupLevelErrors.push(`Voucher "${voucherRef}" is not balanced — debit ${totalDebit.toFixed(2)} vs credit ${totalCredit.toFixed(2)}`);
      hasError = true;
    }

    if (hasError) {
      const fallback = groupLevelErrors[0] ?? `Voucher "${voucherRef}" has an error on another line`;
      for (const r of group) {
        r.status = "error";
        if (!r.error) r.error = fallback;
      }
    } else {
      for (const r of group) {
        r.status = "create";
        r.entryDate = entryDate;
        r.voucherType = voucherType;
        r.branchCode = branchCode;
        r.entryNarration = entryNarration;
      }
    }
  }

  res.json({ data: rows });
});

router.post("/bulk-upload/apply", requirePermission("journal.post"), async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const rows: JournalLinePreviewRow[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const workRows = rows.filter((r) => r.status === "create");
  if (workRows.length === 0) return res.json({ data: { created: 0, updated: 0 } });

  const groups = new Map<string, JournalLinePreviewRow[]>();
  for (const r of workRows) {
    if (!groups.has(r.voucherRef)) groups.set(r.voucherRef, []);
    groups.get(r.voucherRef)!.push(r);
  }

  // Re-resolve every code fresh rather than trust anything computed during
  // preview — the file could have been sitting in the browser a while, and
  // this posts straight to the ledger.
  const accountCodes = [...new Set(workRows.map((r) => r.accountCode).filter(Boolean))];
  const bpCodes = [...new Set(workRows.map((r) => r.businessPartnerCode).filter((c): c is string => !!c))];
  const branchCodes = [...new Set(workRows.map((r) => r.branchCode).filter((c): c is string => !!c))];
  const [accounts, partners, branches] = await Promise.all([
    prisma.account.findMany({ where: { organizationId, accountCode: { in: accountCodes }, isActive: true } }),
    bpCodes.length ? prisma.businessPartner.findMany({ where: { organizationId, code: { in: bpCodes }, deletedAt: null } }) : Promise.resolve([]),
    branchCodes.length ? prisma.branch.findMany({ where: { organizationId, code: { in: branchCodes }, deletedAt: null } }) : Promise.resolve([]),
  ]);
  const accountByCode = new Map(accounts.map((a) => [a.accountCode, a]));
  const bpByCode = new Map(partners.map((p) => [p.code!, p]));
  const branchByCode = new Map(branches.map((b) => [b.code, b]));

  // Sequential voucher numbers, same generation scheme as POST / above —
  // seeded once per voucher type from the current count, then incremented
  // in-memory across this loop (not concurrency-hardened, same accepted
  // tradeoff as manual posting there).
  const voucherTypesUsed = [...new Set([...groups.values()].map((g) => g[0].voucherType || "JV"))];
  const counters = new Map<string, number>();
  for (const vt of voucherTypesUsed) {
    counters.set(vt, await prisma.journalEntry.count({ where: { organizationId, voucherType: vt, voucherNumber: { not: null } } }));
  }

  let created = 0;
  for (const [voucherRef, group] of groups) {
    try {
      const first = group[0];
      const vt = first.voucherType || "JV";
      let totalDebit = 0, totalCredit = 0;
      const lineData = group.map((r) => {
        const account = accountByCode.get(r.accountCode);
        if (!account) throw new Error(`Account Code "${r.accountCode}" not found`);
        const businessPartner = r.businessPartnerCode ? bpByCode.get(r.businessPartnerCode) : null;
        if (r.businessPartnerCode && !businessPartner) throw new Error(`Business Partner Code "${r.businessPartnerCode}" not found`);
        if (account.isControlAccount && !businessPartner) throw new Error(`${account.accountName} is a control account — needs a Business Partner Code`);
        totalDebit += r.debit;
        totalCredit += r.credit;
        return { accountId: account.id, businessPartnerId: businessPartner?.id ?? null, debit: r.debit, credit: r.credit, narration: r.lineNarration ?? null };
      });
      if (Math.abs(totalDebit - totalCredit) > 0.01) throw new Error(`Voucher "${voucherRef}" is not balanced`);
      const branch = first.branchCode ? branchByCode.get(first.branchCode) : null;
      if (first.branchCode && !branch) throw new Error(`Branch Code "${first.branchCode}" not found`);
      if (!first.entryDate || !first.entryNarration) throw new Error(`Voucher "${voucherRef}" is missing Entry Date or Entry Narration`);

      const count = counters.get(vt) ?? 0;
      const voucherNumber = `${vt}-${String(count + 1).padStart(4, "0")}`;
      counters.set(vt, count + 1);

      // Same shape as the transaction body in POST / above — including the
      // trg_lock_org_domains trigger firing on the first INSERT either way.
      await prisma.$transaction(async (tx) => {
        const entry = await tx.journalEntry.create({
          data: {
            organizationId,
            branchId: branch?.id ?? req.user!.branchId ?? null,
            entryDate: new Date(first.entryDate!),
            narration: first.entryNarration!,
            voucherType: vt,
            voucherNumber,
            createdBy: req.user!.userId,
          },
        });
        await tx.journalLine.createMany({ data: lineData.map((l) => ({ ...l, journalEntryId: entry.id })) });
      });
      created++;
    } catch {
      // Data moved under us since preview (an account/business partner/
      // branch was deleted or deactivated in the meantime, most likely) —
      // skip this one voucher rather than fail the whole batch. Re-running
      // the same file will surface it as an error in preview next time.
    }
  }

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "BULK_UPLOAD", entityType: "journal_entry", entityId: organizationId,
    summary: `Bulk upload: ${created} journal entr${created === 1 ? "y" : "ies"} posted`,
  });
  res.json({ data: { created, updated: 0 } });
});

export default router;
