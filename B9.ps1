$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Depreciation schedule: engine and endpoint...' -ForegroundColor Cyan

function Set-FileText($rel, $text) {
  $p = Join-Path $repo $rel
  $dir = Split-Path $p -Parent
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [IO.File]::WriteAllText($p, $text.Replace([string][char]13, ''), (New-Object Text.UTF8Encoding $false))
  Write-Host "  wrote  $rel"
}
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

Set-FileText 'backend/src/lib/depreciationSchedule.ts' 'import {
  DepreciationFrequency, DepreciationMethod, FREQUENCY_MONTHS,
  periodEndFor, periodStartFor,
} from "./depreciationPolicy";

// What an asset will be charged, period by period, from the day it was put
// to use until its carrying amount reaches its residual value.
//
// This is a PROJECTION. Nothing here reads or writes a posted charge — it
// answers "what is this asset going to cost the P&L, and when", which is the
// question the schedule popup exists to answer. The run engine computes each
// period the same way, but against the asset''s actual opening balance, so a
// period that posted differently (a policy that changed, a disposal) never
// gets rewritten by this.
//
// THE TWO FORMULAS
//
//   SLM  monthly rate = (1 - residual%) / life in months, applied to COST
//   WDV  monthly rate = 1 - residual%^(1 / life in months), applied to the
//                       OPENING carrying amount
//
// Both are derived from the life and the residual rather than prescribed:
// Schedule II publishes useful lives, and stopped publishing rates when it
// replaced Schedule XIV. Both land on exactly the residual after `life`
// months, which is what makes the last period a balancing figure rather than
// an approximation.
//
// PRO RATA
//
// Schedule II charges "on a pro rata basis from the date of such addition",
// so the first period is proportioned by days: an asset put to use on the
// 20th of a 31-day month is charged 12/31 of that month. Every period after
// it is whole. The proportion is by day and not by month because that is
// what the Schedule says, and because a mid-month addition is the normal
// case rather than the exception.

export interface SchedulePeriod {
  periodStart: string;
  periodEnd: string;
  frequency: DepreciationFrequency;
  // Days of this period the asset was actually in use — equal to the days in
  // the period for every period except the first.
  daysCharged: number;
  daysInPeriod: number;
  openingWdv: number;
  amount: number;
  closingWdv: number;
}

export interface ScheduleInput {
  grossCost: number;
  residualValue: number;
  usefulLifeMonths: number;
  method: DepreciationMethod;
  // "YYYY-MM-DD"
  inUseDate: string;
  frequency: DepreciationFrequency;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayCount(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
}

export function buildSchedule(input: ScheduleInput): SchedulePeriod[] {
  const { grossCost, residualValue, usefulLifeMonths, method, frequency } = input;
  const inUse = new Date(`${input.inUseDate}T00:00:00.000Z`);
  if (isNaN(inUse.getTime()) || !(grossCost > 0) || usefulLifeMonths < 1) return [];

  const depreciable = grossCost - residualValue;
  if (!(depreciable > 0)) return [];

  const span = FREQUENCY_MONTHS[frequency];
  // Residual as a fraction of cost — what both rate formulas take.
  const residualFraction = residualValue / grossCost;

  // SLM: a flat amount per month of the life, charged on cost.
  const slmPerMonth = depreciable / usefulLifeMonths;
  // WDV: a rate per month, compounded on the opening balance. Undefined at a
  // zero residual, which is why fixed_assets_wdv_residual_ck exists.
  const wdvMonthlyRate = residualFraction > 0
    ? 1 - Math.pow(residualFraction, 1 / usefulLifeMonths)
    : 0;

  const out: SchedulePeriod[] = [];
  let cursor = periodStartFor(inUse, frequency);
  let opening = grossCost;
  // Months of life still to be charged. Tracked in months rather than
  // periods because the first period is usually partial.
  let monthsLeft = usefulLifeMonths;

  // A hard stop. The arithmetic terminates on its own; this only bounds the
  // damage if a future edit makes it not.
  const maxPeriods = Math.ceil(usefulLifeMonths / span) + 2;

  while (monthsLeft > 0.0001 && out.length < maxPeriods) {
    const periodEnd = periodEndFor(cursor, frequency);
    const effectiveStart = inUse > cursor ? inUse : cursor;
    const daysInPeriod = dayCount(cursor, periodEnd);
    const daysCharged = dayCount(effectiveStart, periodEnd);
    const proportion = daysCharged / daysInPeriod;

    // Months of life consumed by this period. The first period consumes only
    // the fraction of it the asset was in use for.
    const monthsThisPeriod = Math.min(span * proportion, monthsLeft);

    let amount: number;
    if (method === "WDV") {
      // Compounding the monthly rate over a partial number of months is what
      // keeps a mid-month addition on the same curve as a whole one.
      amount = opening * (1 - Math.pow(1 - wdvMonthlyRate, monthsThisPeriod));
    } else {
      amount = slmPerMonth * monthsThisPeriod;
    }
    amount = round2(amount);

    monthsLeft = round2(monthsLeft - monthsThisPeriod);

    // The last period is the balancing figure, so the asset lands on exactly
    // its residual rather than a rounding remainder either side of it. Same
    // reasoning as the last instalment of a prepaid schedule.
    if (monthsLeft <= 0.0001 || round2(opening - amount) < residualValue) {
      amount = round2(opening - residualValue);
      monthsLeft = 0;
    }

    const closing = round2(opening - amount);
    out.push({
      periodStart: isoDay(cursor),
      periodEnd: isoDay(periodEnd),
      frequency,
      daysCharged,
      daysInPeriod,
      openingWdv: round2(opening),
      amount,
      closingWdv: closing,
    });

    opening = closing;
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + span, 1));
  }

  return out;
}
'

Edit-FileText 'backend/src/routes/fixedAssets.ts' 'import { authenticate, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
' 'import { authenticate, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { frequencyInForce, isDepreciationMethod } from "../lib/depreciationPolicy";
import { buildSchedule } from "../lib/depreciationSchedule";
'

Edit-FileText 'backend/src/routes/fixedAssets.ts' 'export default router;
' '// GET /fixed-assets/:id/schedule — the whole life of this asset, period by
// period.
//
// A PROJECTION, not a promise. It is computed from the asset as it stands
// today at the company''s current frequency, so a policy that changes later
// will change what actually posts. Periods that HAVE posted are marked, and
// their real figures are returned in place of the projected ones — the two
// should agree, and where they do not the difference is worth seeing rather
// than smoothing over.
router.get("/:id/schedule", async (req, res) => {
  const organizationId = orgIdOr400(req, res);
  if (!organizationId) return;

  const a = await prisma.fixedAsset.findFirst({
    where: { id: req.params.id, organizationId, deletedAt: null },
    include: { runs: { orderBy: { periodStart: "asc" } } },
  });
  if (!a) return res.status(404).json({ message: "Asset not found." });

  const frequency = await frequencyInForce(organizationId);
  const projected = buildSchedule({
    grossCost: Number(a.grossCost),
    residualValue: Number(a.residualValue),
    usefulLifeMonths: a.usefulLifeMonths,
    method: isDepreciationMethod(a.method) ? a.method : "SLM",
    inUseDate: isoDay(a.inUseDate)!,
    frequency,
  });

  const postedByStart = new Map(a.runs.map((r) => [isoDay(r.periodStart)!, r]));

  res.json({
    data: {
      assetCode: a.assetCode,
      name: a.name,
      method: a.method,
      frequency,
      usefulLifeMonths: a.usefulLifeMonths,
      grossCost: Number(a.grossCost),
      residualValue: Number(a.residualValue),
      periods: projected.map((p) => {
        const posted = postedByStart.get(p.periodStart);
        return {
          ...p,
          posted: !!posted,
          // What actually posted, where it did. Shown instead of the
          // projection rather than beside it, because the ledger is the
          // fact and this table is the estimate.
          amount: posted ? Number(posted.amount) : p.amount,
          openingWdv: posted ? Number(posted.openingWdv) : p.openingWdv,
          closingWdv: posted ? Number(posted.closingWdv) : p.closingWdv,
        };
      }),
    },
  });
});

export default router;
'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green