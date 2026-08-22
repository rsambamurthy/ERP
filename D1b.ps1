$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Depreciation: what is due...' -ForegroundColor Cyan

function Edit-FileText($rel, $old, $new) {
  $p = Join-Path $repo $rel
  if (-not (Test-Path -LiteralPath $p)) { throw "Missing file: $rel" }
  $old = $old.Replace([string][char]13, '')
  $new = $new.Replace([string][char]13, '')
  $t = [IO.File]::ReadAllText($p).Replace([string][char]13, '')
  if ($t.Contains($new)) { Write-Host "  skip   $rel"; return }
  $i = $t.IndexOf($old)
  if ($i -lt 0) { throw "Anchor not found in $rel." }
  if ($t.IndexOf($old, $i + 1) -ge 0) { throw "Anchor is not unique in $rel." }
  $t = $t.Substring(0, $i) + $new + $t.Substring($i + $old.Length)
  [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
  Write-Host "  edit   $rel"
}

function Set-FileText($rel, $text) {
  $p = Join-Path $repo $rel
  $dir = Split-Path $p -Parent
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [IO.File]::WriteAllText($p, $text.Replace([string][char]13, ''), (New-Object Text.UTF8Encoding $false))
  Write-Host "  wrote  $rel"
}

Set-FileText 'backend/src/routes/depreciationRuns.ts' 'import { Router } from "express";
import { prisma } from "../db";
import { authenticate, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import {
  DepreciationFrequency, FREQUENCY_MONTHS, frequencyInForce,
  methodResolver, periodEndFor, periodStartFor,
} from "../lib/depreciationPolicy";
import { BlockedReason, pendingPeriods, RunAsset } from "../lib/depreciationRun";

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
// comparing a period end against the server''s local clock would put the
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
// Derived from the last posted period''s END rather than its start, so a
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

// GET /depreciation-runs/due
//
// Read-only. Computes what the next period would charge without writing
// anything, which is also exactly what the posting route recomputes — the
// preview is never handed to the poster to trust.
router.get("/due", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const [frequency, resolveMethod, loaded] = await Promise.all([
    frequencyInForce(organizationId),
    methodResolver(organizationId),
    loadAssets(organizationId),
  ]);

  const lastRun = await prisma.fixedAssetDepreciationRun.findFirst({
    where: { fixedAsset: { organizationId } },
    orderBy: { periodStart: "desc" },
    select: { periodStart: true, periodEnd: true, frequency: true },
  });

  const runAssets = loaded.map(toRunAsset);
  const target = nextPeriodFor(runAssets, lastRun?.periodEnd ?? null, frequency);

  if (!target) {
    return res.json({
      data: {
        frequency, period: null, canPost: false,
        reason: loaded.length === 0
          ? "There are no assets in the register yet. Capitalise a Purchase Bill line to start one."
          : "Nothing is due.",
        lastPosted: lastRun
          ? { periodStart: isoDay(lastRun.periodStart), periodEnd: isoDay(lastRun.periodEnd), label: periodLabel(lastRun.periodStart, lastRun.periodEnd) }
          : null,
        totalAmount: 0, assets: [], blocked: [],
      },
    });
  }

  // A frequency lengthened mid-year can produce a period that reaches back
  // over one already posted: post April and May monthly, switch to quarterly,
  // and the next quarterly period is Apr – Jun, which overlaps both. Charging
  // it would double-count April and May; skipping it would lose June. Neither
  // is acceptable silently, so the run stops and says what to do — and what
  // to do is always the same, because a period end is a valid boundary for
  // every frequency it divides into.
  if (lastRun && target <= lastRun.periodEnd) {
    const stillOwed = periodLabel(target, periodEndFor(target, frequency));
    return res.json({
      data: {
        frequency, period: null, canPost: false,
        reason: `Depreciation is posted up to ${isoDay(lastRun.periodEnd)}, but the frequency is now ${frequency.toLowerCase().replace("_", "-")}, whose next period is ${stillOwed} — which overlaps what is already posted. Finish the current period at the old frequency before changing it, or set the frequency back.`,
        lastPosted: {
          periodStart: isoDay(lastRun.periodStart),
          periodEnd: isoDay(lastRun.periodEnd),
          label: periodLabel(lastRun.periodStart, lastRun.periodEnd),
        },
        totalAmount: 0, assets: [], blocked: [],
      },
    });
  }

  const periodEnd = periodEndFor(target, frequency);
  const today = todayUtc();
  // A period is charged when it is over. April''s depreciation is April''s
  // expense, and it is not known to be April''s until April has finished —
  // an asset bought on the 28th still belongs in it.
  const periodOver = periodEnd < today;

  const rows: unknown[] = [];
  const blocked: unknown[] = [];
  let totalAmount = 0;

  loaded.forEach((a, i) => {
    const { charges, blocked: why } = pendingPeriods(
      runAssets[i], target, frequency,
      (periodStart) => resolveMethod(a.assetClassId, periodStart),
    );

    if (charges.length === 0) {
      // NOT_YET_IN_USE is the ordinary case for an asset bought after this
      // period — it is not an exception worth showing.
      if (why && why !== "NOT_YET_IN_USE") {
        blocked.push({
          id: a.id, assetCode: a.assetCode, name: a.name,
          assetClass: a.assetClass, reason: why, message: BLOCKED_TEXT[why],
        });
      }
      return;
    }

    const amount = round2(charges.reduce((t, c) => t + c.amount, 0));
    totalAmount += amount;
    const last = charges[charges.length - 1];

    rows.push({
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
    });
  });

  res.json({
    data: {
      frequency,
      period: {
        periodStart: isoDay(target),
        periodEnd: isoDay(periodEnd),
        label: periodLabel(target, periodEnd),
        months: FREQUENCY_MONTHS[frequency],
      },
      today: isoDay(today),
      canPost: periodOver && rows.length > 0,
      reason: !periodOver
        ? `${periodLabel(target, periodEnd)} is not over yet. It can be posted from ${isoDay(new Date(periodEnd.getTime() + 86400000))}.`
        : rows.length === 0
          ? "Nothing is due for this period."
          : null,
      lastPosted: lastRun
        ? {
          periodStart: isoDay(lastRun.periodStart),
          periodEnd: isoDay(lastRun.periodEnd),
          label: periodLabel(lastRun.periodStart, lastRun.periodEnd),
        }
        : null,
      totalAmount: round2(totalAmount),
      assets: rows,
      blocked,
    },
  });
});

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export default router;
'

Edit-FileText 'backend/src/index.ts' 'import prepaidSchedulesRoutes from "./routes/prepaidSchedules";
import assetClassesRoutes from "./routes/assetClasses";
import depreciationPolicyRoutes from "./routes/depreciationPolicy";
import fixedAssetsRoutes from "./routes/fixedAssets";
import integrationConnectionsRoutes from "./routes/integrationConnections";
import integrationApiRoutes from "./routes/integrationApi";
import chatbotRoutes from "./routes/chatbot";

' 'import prepaidSchedulesRoutes from "./routes/prepaidSchedules";
import assetClassesRoutes from "./routes/assetClasses";
import depreciationPolicyRoutes from "./routes/depreciationPolicy";
import fixedAssetsRoutes from "./routes/fixedAssets";
import depreciationRunsRoutes from "./routes/depreciationRuns";
import integrationConnectionsRoutes from "./routes/integrationConnections";
import integrationApiRoutes from "./routes/integrationApi";
import chatbotRoutes from "./routes/chatbot";

'

Edit-FileText 'backend/src/index.ts' 'app.use("/prepaid-schedules", prepaidSchedulesRoutes);
app.use("/asset-classes", assetClassesRoutes);
app.use("/depreciation-policy", depreciationPolicyRoutes);
app.use("/fixed-assets", fixedAssetsRoutes);
app.use("/chatbot", chatbotRoutes);
// Mounted at two different paths, most-specific first — both routers
// apply their auth middleware via a path-less `router.use(...)`, so if
// the broader /integration prefix were checked first, its router would
' 'app.use("/prepaid-schedules", prepaidSchedulesRoutes);
app.use("/asset-classes", assetClassesRoutes);
app.use("/depreciation-policy", depreciationPolicyRoutes);
app.use("/fixed-assets", fixedAssetsRoutes);
app.use("/depreciation-runs", depreciationRunsRoutes);
app.use("/chatbot", chatbotRoutes);
// Mounted at two different paths, most-specific first — both routers
// apply their auth middleware via a path-less `router.use(...)`, so if
// the broader /integration prefix were checked first, its router would
'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green