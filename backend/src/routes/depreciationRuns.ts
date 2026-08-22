import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requireActiveSubscription, requirePermission, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import {
  DepreciationFrequency, FREQUENCY_MONTHS, frequencyInForce,
  methodResolver, periodEndFor, periodStartFor,
} from "../lib/depreciationPolicy";
import { BlockedReason, PeriodCharge, pendingPeriods, RunAsset } from "../lib/depreciationRun";

// The depreciation run — what is due, and (next) posting it.
//
// A run covers ONE period for the WHOLE organization, and periods are posted
// in order. That is stricter than the prepaid amortization screen, which lets
// any month be posted at any time, and the reason is that depreciation is not
// order-independent: under WDV every period compounds on the one before it,
// so posting August before April would compute August off a balance that
// never existed. Straight-line survives being posted out of order; the engine
// underneath is the same either way, so the discipline is applied to both.
//
// The period offered is therefore not a choice. It is the one after the last
// period posted, or — when nothing has ever posted — the earliest period any
// asset in the register needs.
//
// Nothing runs on a timer. The list is prepared, an accountant looks at it,
// and posting is a deliberate act, the same arrangement as Recurring Due and
// Amortization Due.

const router = Router();
router.use(authenticate, requireActiveSubscription);
// Posting a run writes journal entries and nothing else, so it is gated on
// journal.post rather than a fixed-asset permission — the same reasoning as
// the prepaid amortization screen. Reading what is due is open to any org
// member, like the other accounting views.
const canPost = requirePermission("journal.post");

function orgIdOr400(req: import("express").Request, res: import("express").Response): string | null {
  const organizationId = resolveOrgId(req);
  if (!organizationId) {
    res.status(400).json({ message: "organizationId is required." });
    return null;
  }
  return organizationId;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Today at UTC midnight. Every date in this module is a UTC calendar day, so
// comparing a period end against the server's local clock would put the
// boundary in the wrong place for anyone east of Greenwich — which is
// everyone this product is for.
function todayUtc(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

// "April 2026", or "April – June 2026" when the period spans more than one.
function periodLabel(start: Date, end: Date): string {
  const a = `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
  if (start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear()) return a;
  const b = `${MONTHS[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
  return `${a} – ${b}`;
}

const BLOCKED_TEXT: Record<BlockedReason, string> = {
  NOT_YET_IN_USE: "Not in use until after this period.",
  FULLY_DEPRECIATED: "Fully depreciated — carried at its residual value.",
  WDV_NEEDS_RESIDUAL: "The method in force is WDV but this asset has no residual value, which would write it off in one period. Give the class a residual, or put this class back on SLM.",
};

// The asset shape the engine needs, plus what the screen shows.
type LoadedAsset = Awaited<ReturnType<typeof loadAssets>>[number];

async function loadAssets(organizationId: string) {
  return prisma.fixedAsset.findMany({
    where: { organizationId, deletedAt: null, status: "ACTIVE" },
    select: {
      id: true, assetCode: true, name: true, branchId: true,
      assetClassId: true, businessPartnerId: true,
      accumDepAccountId: true, depExpenseAccountId: true,
      grossCost: true, residualValue: true, usefulLifeMonths: true, inUseDate: true,
      assetClass: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
      depExpenseAccount: { select: { accountCode: true, accountName: true } },
      accumDepAccount: { select: { accountCode: true, accountName: true } },
      runs: { select: { periodStart: true, periodEnd: true, frequency: true, closingWdv: true } },
    },
    orderBy: { assetCode: "asc" },
  });
}

function toRunAsset(a: LoadedAsset): RunAsset {
  return {
    grossCost: Number(a.grossCost),
    residualValue: Number(a.residualValue),
    usefulLifeMonths: a.usefulLifeMonths,
    inUseDate: a.inUseDate,
    runs: a.runs.map((r) => ({
      periodStart: r.periodStart, periodEnd: r.periodEnd,
      frequency: r.frequency, closingWdv: Number(r.closingWdv),
    })),
  };
}

// The period a run should offer next: the one after the last period posted,
// or the earliest any asset needs when nothing has posted at all.
//
// Derived from the last posted period's END rather than its start, so a
// change of frequency lands cleanly. An organization that posted April,
// May and June monthly and then switches to quarterly is offered July –
// September, not a second Apr – Jun that overlaps three posted periods.
export function nextPeriodFor(
  assets: RunAsset[],
  lastPostedEnd: Date | null,
  frequency: DepreciationFrequency,
): Date | null {
  if (lastPostedEnd) {
    const dayAfter = new Date(lastPostedEnd.getTime() + 86400000);
    return periodStartFor(dayAfter, frequency);
  }
  let earliest: Date | null = null;
  for (const a of assets) {
    const first = periodStartFor(a.inUseDate, frequency);
    if (!earliest || first < earliest) earliest = first;
  }
  return earliest;
}


function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Everything both routes need, computed once, from the database only.
//
// The preview and the posting call this same function. The screen's figures
// are never sent back to be written: a run posted from a browser tab left
// open since yesterday would otherwise write yesterday's arithmetic.
type RunPlan =
  | { ok: false; reason: string; lastRun: LastRun | null; frequency: DepreciationFrequency }
  | {
    ok: true;
    frequency: DepreciationFrequency;
    target: Date;
    periodEnd: Date;
    periodOver: boolean;
    lastRun: LastRun | null;
    lines: PlannedAsset[];
    blocked: { asset: LoadedAsset; reason: BlockedReason }[];
  };

type LastRun = { periodStart: Date; periodEnd: Date; frequency: string };
type PlannedAsset = { asset: LoadedAsset; charges: PeriodCharge[]; amount: number };

async function prepareRun(organizationId: string): Promise<RunPlan> {
  const [frequency, resolveMethod, loaded] = await Promise.all([
    frequencyInForce(organizationId),
    methodResolver(organizationId),
    loadAssets(organizationId),
  ]);

  // The last RUN, not the last charge. A run whose charges all landed on
  // earlier periods writes no charge row at its own period, so inferring the
  // position from max(period_start) would offer that period again and post it
  // twice — which is what migration_040 exists to stop.
  const lastRun = await prisma.depreciationPeriod.findFirst({
    where: { organizationId },
    orderBy: { periodEnd: "desc" },
    select: { periodStart: true, periodEnd: true, frequency: true },
  });

  const runAssets = loaded.map(toRunAsset);
  const target = nextPeriodFor(runAssets, lastRun?.periodEnd ?? null, frequency);

  if (!target) {
    return {
      ok: false, frequency, lastRun,
      reason: loaded.length === 0
        ? "There are no assets in the register yet. Capitalise a Purchase Bill line to start one."
        : "Nothing is due.",
    };
  }

  // A frequency lengthened mid-year can produce a period that reaches back
  // over one already posted: post April and May monthly, switch to quarterly,
  // and the next quarterly period is Apr – Jun, which overlaps both. Charging
  // it would double-count April and May; skipping it would lose June. Neither
  // is acceptable silently, so the run stops and says what to do.
  if (lastRun && target <= lastRun.periodEnd) {
    return {
      ok: false, frequency, lastRun,
      reason: `Depreciation is posted up to ${isoDay(lastRun.periodEnd)}, but the frequency is now ${frequency.toLowerCase().replace("_", "-")}, whose next period is ${periodLabel(target, periodEndFor(target, frequency))} — which overlaps what is already posted. Post the remaining periods at the old frequency first, or set the frequency back.`,
    };
  }

  const periodEnd = periodEndFor(target, frequency);
  const lines: PlannedAsset[] = [];
  const blocked: { asset: LoadedAsset; reason: BlockedReason }[] = [];

  loaded.forEach((a, i) => {
    const { charges, blocked: why } = pendingPeriods(
      runAssets[i], target, frequency,
      (periodStart) => resolveMethod(a.assetClassId, periodStart),
    );
    if (charges.length > 0) {
      lines.push({ asset: a, charges, amount: round2(charges.reduce((t, c) => t + c.amount, 0)) });
      return;
    }
    // NOT_YET_IN_USE is the ordinary case for an asset bought after this
    // period — not an exception worth reporting.
    if (why && why !== "NOT_YET_IN_USE") blocked.push({ asset: a, reason: why });
  });

  return {
    ok: true, frequency, target, periodEnd,
    // A period is charged when it is over. April's depreciation is April's
    // expense, and it is not known to be April's until April has finished —
    // an asset bought on the 28th still belongs in it.
    periodOver: periodEnd < todayUtc(),
    lastRun, lines, blocked,
  };
}

function lastPostedJson(lastRun: LastRun | null) {
  return lastRun
    ? {
      periodStart: isoDay(lastRun.periodStart),
      periodEnd: isoDay(lastRun.periodEnd),
      label: periodLabel(lastRun.periodStart, lastRun.periodEnd),
    }
    : null;
}

// GET /depreciation-runs/due
router.get("/due", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const plan = await prepareRun(organizationId);

  if (!plan.ok) {
    return res.json({
      data: {
        frequency: plan.frequency, period: null, canPost: false, reason: plan.reason,
        lastPosted: lastPostedJson(plan.lastRun),
        totalAmount: 0, assets: [], blocked: [],
      },
    });
  }

  const assets = plan.lines.map(({ asset: a, charges, amount }) => {
    const last = charges[charges.length - 1];
    return {
      id: a.id, assetCode: a.assetCode, name: a.name,
      assetClass: a.assetClass, branch: a.branch,
      depExpenseAccount: a.depExpenseAccount,
      accumDepAccount: a.accumDepAccount,
      method: last.method,
      openingWdv: charges[0].openingWdv,
      amount,
      closingWdv: last.closingWdv,
      final: last.final,
      // More than one only when this asset was capitalised with an in-use
      // date behind periods already posted. Shown, because an asset charged
      // five periods in one entry needs to say so.
      periods: charges.map((c) => ({
        periodStart: isoDay(c.periodStart),
        periodEnd: isoDay(c.periodEnd),
        label: periodLabel(c.periodStart, c.periodEnd),
        method: c.method,
        daysCharged: c.daysCharged,
        daysInPeriod: c.daysInPeriod,
        openingWdv: c.openingWdv,
        amount: c.amount,
        closingWdv: c.closingWdv,
      })),
      catchUpPeriods: charges.length - 1,
      partFirstPeriod: charges[0].daysCharged < charges[0].daysInPeriod,
    };
  });

  res.json({
    data: {
      frequency: plan.frequency,
      period: {
        periodStart: isoDay(plan.target),
        periodEnd: isoDay(plan.periodEnd),
        label: periodLabel(plan.target, plan.periodEnd),
        months: FREQUENCY_MONTHS[plan.frequency],
      },
      today: isoDay(todayUtc()),
      canPost: plan.periodOver && assets.length > 0,
      reason: !plan.periodOver
        ? `${periodLabel(plan.target, plan.periodEnd)} is not over yet. It can be posted from ${isoDay(new Date(plan.periodEnd.getTime() + 86400000))}.`
        : assets.length === 0
          ? "Nothing is due for this period."
          : null,
      lastPosted: lastPostedJson(plan.lastRun),
      totalAmount: round2(assets.reduce((t, a) => t + a.amount, 0)),
      assets,
      blocked: plan.blocked.map(({ asset: a, reason }) => ({
        id: a.id, assetCode: a.assetCode, name: a.name,
        assetClass: a.assetClass, reason, message: BLOCKED_TEXT[reason],
      })),
    },
  });
});

// POST /depreciation-runs/post   { periodStart: "YYYY-MM-DD" }
//
// ONE TRANSACTION for the whole period, unlike the prepaid screen which posts
// each schedule separately. A half-posted period is worse than an unposted
// one: the next run would see the period as done and move past the assets it
// missed, and nothing downstream would ever notice. All or nothing.
//
// The journal entry is one per BRANCH, because a journal entry carries a
// single branch. Within it, accumulated depreciation is credited ONE LINE PER
// ASSET, each tagged to that asset's own sub-ledger card, and depreciation
// expense is debited grouped by expense account. That asymmetry is deliberate
// — the balance-sheet side has to break down asset by asset for the register
// to reconcile to the ledger, the P&L side does not.
router.post("/post", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const asked = typeof req.body?.periodStart === "string" ? req.body.periodStart : null;
  if (!asked) return res.status(400).json({ message: "periodStart is required, as YYYY-MM-DD." });

  const plan = await prepareRun(organizationId);
  if (!plan.ok) return res.status(409).json({ message: plan.reason });

  // The screen may have been open a while. Refusing a mismatch is what stops
  // a stale tab posting the period after the one the user was looking at.
  if (isoDay(plan.target) !== asked) {
    return res.status(409).json({
      message: `The period due is now ${periodLabel(plan.target, plan.periodEnd)}, not the one on screen. Reload and check the figures before posting.`,
    });
  }
  if (!plan.periodOver) {
    return res.status(409).json({
      message: `${periodLabel(plan.target, plan.periodEnd)} is not over yet. It can be posted from ${isoDay(new Date(plan.periodEnd.getTime() + 86400000))}.`,
    });
  }
  if (plan.lines.length === 0) {
    return res.status(409).json({ message: "Nothing is due for this period." });
  }

  const label = periodLabel(plan.target, plan.periodEnd);
  const userId = req.user!.userId;

  // Group by branch: a journal entry carries one branch, and an organization
  // with assets in two branches needs one entry each rather than a single
  // entry attributed to whichever branch happened to come first.
  const byBranch = new Map<string | null, PlannedAsset[]>();
  for (const line of plan.lines) {
    const key = line.asset.branchId ?? null;
    const list = byBranch.get(key);
    if (list) list.push(line); else byBranch.set(key, [line]);
  }

  try {
    const entryIds = await prisma.$transaction(async (tx) => {
      const created: string[] = [];

      // First, and inside the transaction: the run records itself. The unique
      // index on (organization_id, period_start) is what makes a second post
      // of the same period impossible rather than merely unlikely — it fires
      // before any journal entry is written, so a duplicate attempt rolls
      // back with nothing in the ledger.
      await tx.depreciationPeriod.create({
        data: {
          organizationId,
          periodStart: plan.target, periodEnd: plan.periodEnd,
          frequency: plan.frequency,
          totalAmount: round2(plan.lines.reduce((s, l) => s + l.amount, 0)),
          assetCount: plan.lines.length,
          postedBy: userId,
        },
      });

      for (const [branchId, lines] of byBranch) {
        const journalEntry = await tx.journalEntry.create({
          data: {
            organizationId, branchId,
            // Dated to the END of the period, which is when the charge is
            // recognised — not today, and not the period's first day.
            entryDate: plan.periodEnd,
            narration: `Depreciation — ${label}`.slice(0, 255),
            voucherType: "JV",
            // voucherNumber stays null: auto-posted entries carry their source
            // document's identity, not a manual JV number.
            referenceType: "depreciation_run",
            createdBy: userId,
          },
        });

        // P&L side: one line per expense account, however many assets fed it.
        const byExpense = new Map<string, number>();
        for (const l of lines) {
          byExpense.set(l.asset.depExpenseAccountId, round2((byExpense.get(l.asset.depExpenseAccountId) ?? 0) + l.amount));
        }

        await tx.journalLine.createMany({
          data: [
            ...Array.from(byExpense, ([accountId, debit]) => ({
              journalEntryId: journalEntry.id, accountId,
              businessPartnerId: null, debit, credit: 0,
              narration: `Depreciation — ${label}`.slice(0, 255),
            })),
            // Balance-sheet side: one line per asset, tagged to its card.
            ...lines.map((l) => ({
              journalEntryId: journalEntry.id, accountId: l.asset.accumDepAccountId,
              businessPartnerId: l.asset.businessPartnerId,
              debit: 0, credit: l.amount,
              narration: `${l.asset.assetCode} — ${l.asset.name}`.slice(0, 255),
            })),
          ],
        });

        await tx.fixedAssetDepreciationRun.createMany({
          // One row per period, not per posting: an asset caught up over four
          // months writes four rows, each at its own true period, all pointing
          // at this one entry.
          data: lines.flatMap((l) => l.charges.map((c) => ({
            fixedAssetId: l.asset.id,
            periodStart: c.periodStart,
            periodEnd: c.periodEnd,
            frequency: c.frequency,
            amount: c.amount,
            openingWdv: c.openingWdv,
            closingWdv: c.closingWdv,
            journalEntryId: journalEntry.id,
            // fa_dep_runs_type_ck admits only MONTHLY and DISPOSAL_CATCHUP.
            // The period's own length lives in `frequency`; run_type says how
            // the charge arose, and this one arose from the ordinary run.
            runType: "MONTHLY",
            generatedBy: userId,
          }))),
        });

        // Retiring an asset that has reached its residual, so it stops
        // appearing in every future run only to be reported as blocked.
        const finished = lines.filter((l) => l.charges[l.charges.length - 1].final).map((l) => l.asset.id);
        if (finished.length > 0) {
          await tx.fixedAsset.updateMany({
            where: { id: { in: finished } },
            data: { status: "FULLY_DEPRECIATED" },
          });
        }

        created.push(journalEntry.id);
      }

      return created;
    });

    const total = round2(plan.lines.reduce((t, l) => t + l.amount, 0));
    logAudit({
      organizationId, actorUserId: userId,
      // entityId is a UUID column, so the period goes in the summary. A run
      // has no single entity of its own; the organization is the subject.
      action: "CREATE", entityType: "depreciation_run", entityId: organizationId,
      summary: `Depreciation for ${label} — ${plan.lines.length} assets, ${total.toFixed(2)}`,
    });

    res.json({
      data: {
        periodStart: isoDay(plan.target), periodEnd: isoDay(plan.periodEnd), label,
        assetCount: plan.lines.length, totalAmount: total, journalEntryIds: entryIds,
      },
    });
  } catch (err: unknown) {
    // P2002 is the unique index on (fixed_asset_id, period_start) — two people
    // posting the same period at once. The whole transaction rolled back, so
    // there is nothing half-written to clean up.
    const code = (err as { code?: string })?.code;
    if (code === "P2002") {
      return res.status(409).json({ message: "This period has just been posted by someone else. Reload to see it." });
    }
    // Nothing was written — the transaction rolled back. The real error goes
    // to the log rather than to the client, which would otherwise be told the
    // name of whichever column or constraint failed.
    console.error("depreciation run post failed", err);
    return res.status(500).json({ message: "Could not post the depreciation run. Nothing was written." });
  }
});

// POST /depreciation-runs/reverse   { periodStart: "YYYY-MM-DD" }
//
// Undoes the LATEST run, and only that one. Reversing an earlier period would
// leave every period after it computed from a closing balance that no longer
// exists — under WDV, arithmetically stranded.
//
// It deletes the charge rows and the journal entries rather than posting a
// contra entry. Two reasons: the unique index on (asset, period) means the
// rows have to go anyway before the period can be re-posted, and a
// depreciation entry carries no voucher number, so removing one leaves no gap
// in any sequence. The audit log is the trail — which is why the entityId on
// both this and the posting route has to be a real UUID rather than a date
// string the audit table would silently reject.
//
// When period locking arrives this must refuse to touch a locked period.
router.post("/reverse", canPost, async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const asked = typeof req.body?.periodStart === "string" ? req.body.periodStart : null;
  if (!asked || !/^\d{4}-\d{2}-\d{2}$/.test(asked)) {
    return res.status(400).json({ message: "periodStart is required, as YYYY-MM-DD." });
  }
  const period = new Date(`${asked}T00:00:00.000Z`);
  if (isNaN(period.getTime())) return res.status(400).json({ message: "periodStart is not a date." });

  // The run itself, not the charges it happened to write. A run with no
  // charge row at its own period is still a run, and still reversible.
  const latest = await prisma.depreciationPeriod.findFirst({
    where: { organizationId },
    orderBy: { periodEnd: "desc" },
    select: { id: true, periodStart: true, periodEnd: true },
  });
  if (!latest) return res.status(404).json({ message: "No depreciation has been posted yet." });
  if (latest.periodStart.getTime() !== period.getTime()) {
    return res.status(409).json({
      message: `Only the latest posted period can be reversed, and that is ${periodLabel(latest.periodStart, latest.periodEnd)}. Reverse it first.`,
    });
  }

  // The entries this run wrote. Identified by their date and reference type
  // rather than through the charge rows, so that a run whose charges all fell
  // on earlier periods is still reachable.
  const entries = await prisma.journalEntry.findMany({
    where: { organizationId, referenceType: "depreciation_run", entryDate: latest.periodEnd },
    select: { id: true },
  });
  const entryIds = entries.map((e) => e.id);

  // The assets those entries charged, so only they are brought back to life.
  const touched = entryIds.length === 0 ? [] : await prisma.fixedAssetDepreciationRun.findMany({
    where: { journalEntryId: { in: entryIds }, fixedAsset: { organizationId } },
    select: { fixedAssetId: true },
  });
  const assetIds = Array.from(new Set(touched.map((r) => r.fixedAssetId)));

  const removed = await prisma.$transaction(async (tx) => {
    let count = 0;
    if (entryIds.length > 0) {
      const runs = await tx.fixedAssetDepreciationRun.deleteMany({
        where: { journalEntryId: { in: entryIds }, fixedAsset: { organizationId } },
      });
      count = runs.count;
      await tx.journalLine.deleteMany({
        // Scoped through the entry, not by id alone. An id that reaches here
        // but fails the entry filter below would otherwise lose its lines and
        // keep its header — a journal entry with nothing in it.
        where: {
          journalEntryId: { in: entryIds },
          journalEntry: { organizationId, referenceType: "depreciation_run" },
        },
      });
      await tx.journalEntry.deleteMany({
        where: { id: { in: entryIds }, organizationId, referenceType: "depreciation_run" },
      });
      // An asset retired by the charge being reversed is active again — only
      // those, not every fully depreciated asset in the register.
      await tx.fixedAsset.updateMany({
        where: { id: { in: assetIds }, organizationId, status: "FULLY_DEPRECIATED" },
        data: { status: "ACTIVE" },
      });
    }
    await tx.depreciationPeriod.delete({ where: { id: latest.id } });
    return count;
  });

  logAudit({
    organizationId, actorUserId: req.user!.userId,
    action: "DELETE", entityType: "depreciation_run", entityId: organizationId,
    summary: `Reversed depreciation for ${periodLabel(latest.periodStart, latest.periodEnd)} — ${removed} charges, ${entryIds.length} journal entries`,
  });

  res.json({ data: { periodStart: asked, runsRemoved: removed, journalEntriesRemoved: entryIds.length } });
});

export default router;
