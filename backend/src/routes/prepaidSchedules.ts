import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { round2 } from "../lib/discountGst";

// Prepaid expense schedules — the release side of migration_032.
//
// A Purchase Bill line marked prepaid debits Prepaid Expenses (1105) and
// leaves a schedule here. This module is what gets the money back out again:
// one journal entry a month moving an instalment from the asset to the
// expense head the service item pointed at.
//
// Nothing posts on a timer. The due screen lists what is scheduled for a
// month, an accountant looks at it, and posting is a deliberate act — same
// arrangement as Recurring Due, for the same reason.

const router = Router();
router.use(authenticate, requireActiveSubscription);
// Posting an amortization writes a journal entry and nothing else, so it is
// gated on journal.post rather than purchase.post. Reading is open to any
// org member, like the other accounting views.
const canPost = requirePermission("journal.post");

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

// "YYYY-MM" -> the 1st of that month in UTC. Everything here is month-aligned
// so a schedule can be compared to a run without timezone drift.
function monthStart(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}-01T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}

function thisMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

function monthsBetween(from: Date, to: Date): number {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
}

// Straight-line, with the remainder landing on the final instalment rather
// than being spread. 1,00,000 over 12 is 8,333.33 eleven times and 8,333.37
// once — so accumulated releases always reach the total exactly and a
// schedule can never strand a few paise in Prepaid Expenses forever.
function instalmentAmount(total: number, months: number, n: number): number {
  const base = round2(total / months);
  if (n < months) return base;
  return round2(total - base * (months - 1));
}

// Which instalment does this month represent? 1-based; null if the month is
// outside the schedule's span entirely.
function instalmentNoFor(startMonth: Date, period: Date, months: number): number | null {
  const offset = monthsBetween(startMonth, period);
  if (offset < 0 || offset >= months) return null;
  return offset + 1;
}

function ym(d: Date): string {
  return d.toISOString().slice(0, 7);
}

// GET /prepaid-schedules — every schedule with how much has been released.
router.get("/", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const rows = await prisma.prepaidSchedule.findMany({
    where: { organizationId, deletedAt: null },
    include: {
      expenseAccount: { select: { id: true, accountCode: true, accountName: true } },
      purchaseBill: { select: { id: true, billNumber: true, billDate: true } },
      runs: { select: { amount: true, periodMonth: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    data: rows.map((s) => {
      const total = Number(s.totalAmount);
      const released = round2(s.runs.reduce((t, r) => t + Number(r.amount), 0));
      const lastPeriod = s.runs.length
        ? s.runs.map((r) => r.periodMonth).sort((a, b) => b.getTime() - a.getTime())[0]
        : null;
      return {
        id: s.id,
        name: s.name,
        status: s.status,
        expenseAccount: s.expenseAccount,
        purchaseBill: s.purchaseBill
          ? { id: s.purchaseBill.id, billNumber: s.purchaseBill.billNumber, billDate: s.purchaseBill.billDate.toISOString().slice(0, 10) }
          : null,
        totalAmount: total,
        released,
        remaining: round2(total - released),
        startMonth: ym(s.startMonth),
        endMonth: ym(addMonths(s.startMonth, s.months - 1)),
        months: s.months,
        instalmentsPosted: s.runs.length,
        lastPostedMonth: lastPeriod ? ym(lastPeriod) : null,
      };
    }),
  });
});

// GET /prepaid-schedules/due?month=YYYY-MM
//
// Declared above /:id — "due" is a single path segment, so /:id would
// otherwise swallow it. This codebase has been bitten by that three times
// (items /expense-accounts, business-partners /lookup, recurring /due).
router.get("/due", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const period = monthStart(req.query.month) ?? thisMonth();

  const rows = await prisma.prepaidSchedule.findMany({
    where: { organizationId, deletedAt: null, status: "ACTIVE" },
    include: {
      expenseAccount: { select: { id: true, accountCode: true, accountName: true } },
      purchaseBill: { select: { id: true, billNumber: true } },
      runs: { select: { periodMonth: true, amount: true, journalEntryId: true } },
    },
    orderBy: { name: "asc" },
  });

  const data = rows
    .map((s) => {
      const n = instalmentNoFor(s.startMonth, period, s.months);
      if (n === null) return null;

      const total = Number(s.totalAmount);
      const released = round2(s.runs.reduce((t, r) => t + Number(r.amount), 0));
      const existing = s.runs.find((r) => r.periodMonth.getTime() === period.getTime()) ?? null;
      const amount = instalmentAmount(total, s.months, n);

      // Instalments before this month that were never posted. Straight-line
      // means posting out of order is arithmetically harmless, but an
      // accountant should still be told rather than left to notice.
      let missingBefore = 0;
      for (let i = 1; i < n; i++) {
        const p = addMonths(s.startMonth, i - 1);
        if (!s.runs.some((r) => r.periodMonth.getTime() === p.getTime())) missingBefore++;
      }

      return {
        id: s.id,
        name: s.name,
        expenseAccount: s.expenseAccount,
        purchaseBill: s.purchaseBill,
        totalAmount: total,
        released,
        remaining: round2(total - released),
        instalmentNo: n,
        months: s.months,
        amount,
        missingBefore,
        alreadyPosted: existing
          ? { journalEntryId: existing.journalEntryId, amount: Number(existing.amount) }
          : null,
      };
    })
    .filter(Boolean);

  res.json({ data });
});

// POST /prepaid-schedules/post  { month: "YYYY-MM", scheduleIds: [...] }
//
// One journal entry per schedule, each in its own transaction, so one
// failure doesn't roll back the ones that already worked. The response says
// exactly which succeeded and which didn't — the same shape the recurring
// generator returns.
router.post("/post", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;
  const period = monthStart(req.body?.month);
  if (!period) return res.status(400).json({ message: "month is required, as YYYY-MM." });

  const ids: string[] = Array.isArray(req.body?.scheduleIds) ? req.body.scheduleIds : [];
  if (ids.length === 0) return res.status(400).json({ message: "Select at least one schedule to post." });

  const posted: { id: string; amount: number }[] = [];
  const failed: { id: string; message: string }[] = [];

  for (const id of ids) {
    try {
      const s = await prisma.prepaidSchedule.findFirst({
        where: { id, organizationId, deletedAt: null },
        include: { runs: { select: { id: true } } },
      });
      if (!s) { failed.push({ id, message: "Not found." }); continue; }
      if (s.status !== "ACTIVE") { failed.push({ id, message: `${s.name} is ${s.status.toLowerCase()}.` }); continue; }

      const n = instalmentNoFor(s.startMonth, period, s.months);
      if (n === null) { failed.push({ id, message: `${s.name} has no instalment for this month.` }); continue; }

      const amount = instalmentAmount(Number(s.totalAmount), s.months, n);

      await prisma.$transaction(async (tx) => {
        // Dated to the last day of the period, which is when the expense is
        // recognised — not the schedule's start day and not today.
        const entryDate = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 0));

        const journalEntry = await tx.journalEntry.create({
          data: {
            organizationId, branchId: s.branchId, entryDate,
            narration: `Amortization — ${s.name} (${ym(period)}), instalment ${n} of ${s.months}`,
            voucherType: "JV",
            // voucherNumber stays null: this is an auto-posted entry, which
            // by this codebase's convention carries its source document's
            // identity rather than a manual JV number.
            referenceType: "prepaid_amortization",
            createdBy: req.user!.userId,
          },
        });

        await tx.journalLine.createMany({
          data: [
            {
              journalEntryId: journalEntry.id, accountId: s.expenseAccountId,
              businessPartnerId: null, debit: amount, credit: 0,
              narration: `${s.name} — ${ym(period)}`,
            },
            {
              journalEntryId: journalEntry.id, accountId: s.prepaidAccountId,
              // Tagged to this schedule's own card, so Prepaid Expenses keeps
              // breaking down schedule by schedule as it unwinds.
              businessPartnerId: s.businessPartnerId, debit: 0, credit: amount,
              narration: `Released to ${ym(period)}`,
            },
          ],
        });

        // The idempotency guard. The unique index on
        // (prepaid_schedule_id, period_month) means a second concurrent post
        // for the same month fails here and rolls the whole transaction back
        // — including the journal entry — rather than releasing twice.
        await tx.prepaidScheduleRun.create({
          data: {
            prepaidScheduleId: s.id, periodMonth: period, instalmentNo: n,
            amount, journalEntryId: journalEntry.id,
            runType: "AMORTIZATION", generatedBy: req.user!.userId,
          },
        });

        // Counted inside the transaction, after the insert above, so it sees
        // this run too.
        const runCount = await tx.prepaidScheduleRun.count({
          where: { prepaidScheduleId: s.id, runType: "AMORTIZATION" },
        });
        if (runCount >= s.months) {
          await tx.prepaidSchedule.update({ where: { id: s.id }, data: { status: "COMPLETED" } });
        }
      });

      logAudit({
        organizationId, actorUserId: req.user!.userId,
        action: "CREATE", entityType: "prepaid_amortization", entityId: s.id,
        summary: `Amortized ${s.name} for ${ym(period)} — ${amount.toFixed(2)}`,
      });
      posted.push({ id: s.id, amount });
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      failed.push({
        id,
        message: code === "P2002"
          ? "Already posted for this month."
          : (err as Error)?.message ?? "Could not post this amortization.",
      });
    }
  }

  res.json({ data: { posted, failed } });
});

// GET /prepaid-schedules/:id — the full month-by-month picture.
router.get("/:id", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const s = await prisma.prepaidSchedule.findFirst({
    where: { id: req.params.id, organizationId, deletedAt: null },
    include: {
      expenseAccount: { select: { id: true, accountCode: true, accountName: true } },
      prepaidAccount: { select: { id: true, accountCode: true, accountName: true } },
      businessPartner: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
      purchaseBill: { select: { id: true, billNumber: true, billDate: true } },
      runs: true,
    },
  });
  if (!s) return res.status(404).json({ message: "Schedule not found." });

  const total = Number(s.totalAmount);
  const runByPeriod = new Map(s.runs.map((r) => [r.periodMonth.getTime(), r]));

  // Every instalment the schedule will ever have, posted or not, with the
  // running balance. Derived rather than stored — the runs table records what
  // actually happened; this is what is meant to happen.
  let cumulative = 0;
  const instalments = Array.from({ length: s.months }, (_, i) => {
    const n = i + 1;
    const p = addMonths(s.startMonth, i);
    const amount = instalmentAmount(total, s.months, n);
    cumulative = round2(cumulative + amount);
    const run = runByPeriod.get(p.getTime()) ?? null;
    return {
      instalmentNo: n,
      month: ym(p),
      amount,
      cumulative,
      balance: round2(total - cumulative),
      postedAt: run ? run.generatedAt.toISOString() : null,
      journalEntryId: run ? run.journalEntryId : null,
      postedAmount: run ? Number(run.amount) : null,
    };
  });

  const released = round2(s.runs.reduce((t, r) => t + Number(r.amount), 0));

  res.json({
    data: {
      id: s.id,
      name: s.name,
      status: s.status,
      branch: s.branch,
      expenseAccount: s.expenseAccount,
      prepaidAccount: s.prepaidAccount,
      businessPartner: s.businessPartner,
      purchaseBill: s.purchaseBill
        ? { id: s.purchaseBill.id, billNumber: s.purchaseBill.billNumber, billDate: s.purchaseBill.billDate.toISOString().slice(0, 10) }
        : null,
      totalAmount: total,
      released,
      remaining: round2(total - released),
      startMonth: ym(s.startMonth),
      endMonth: ym(addMonths(s.startMonth, s.months - 1)),
      months: s.months,
      createdAt: s.createdAt.toISOString(),
      instalments,
    },
  });
});

export default router;
