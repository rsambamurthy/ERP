import {
  DepreciationFrequency, DepreciationMethod, FREQUENCY_MONTHS,
  periodEndFor, periodStartFor,
} from "./depreciationPolicy";

// What an asset is charged for a period that is about to be POSTED.
//
// depreciationSchedule.ts projects an asset's whole life from its cost. This
// does the opposite: it computes one period from what has actually happened
// — the closing balance of the last posted run, and the months of life those
// runs consumed. The two agree period for period when nothing changes, and
// they have to be separate for the case where something did: a method that
// changed, an asset added late, a period reversed and re-posted.
//
// THE ONE FORMULA
//
// Every charge is computed from the OPENING carrying amount and the months
// REMAINING, never from the original cost and the original life:
//
//   SLM  per month = (opening - residual) / remaining
//   WDV  per month = 1 - (residual / opening) ^ (1 / remaining)
//
// That looks like a rebasing rule for method changes, but it is not — it is
// an identity. For SLM, opening after k months is cost - k(cost-residual)/n,
// so (opening-residual)/(n-k) reduces to (cost-residual)/n: the same figure.
// For WDV, opening is cost·(residual/cost)^(k/n), so (residual/opening)^(1/(n-k))
// reduces to (residual/cost)^(1/n): again the same rate.
//
// So one formula serves both the ordinary case and the changed one. Nothing
// has to detect a method change or rebase anything; the charge after a switch
// is simply the other formula applied to where the asset actually stands,
// which is precisely what prospective treatment of a change in estimate
// means under AS 10 (revised) and Ind AS 16.
//
// CATCH-UP
//
// pendingPeriods returns EVERY unposted period up to the target, not just the
// target. Normally that is one. It is more when an asset was capitalised with
// a backdated in-use date after later periods had already been posted. Each
// gets its own run row at its own true period, so the register and the
// schedule stay truthful, and under WDV the chain compounds in the right
// order. Charging only the target period would silently under-depreciate the
// asset for the rest of its life.

export interface PostedRun {
  periodStart: Date;
  periodEnd: Date;
  frequency: string;
  closingWdv: number;
}

export interface RunAsset {
  grossCost: number;
  residualValue: number;
  usefulLifeMonths: number;
  inUseDate: Date;
  // Every run already posted for this asset, in any order.
  runs: PostedRun[];
}

export interface PeriodCharge {
  periodStart: Date;
  periodEnd: Date;
  frequency: DepreciationFrequency;
  method: DepreciationMethod;
  // Days of the period the asset was in use — less than the whole period only
  // in the first one, which Schedule II charges "on a pro rata basis from the
  // date of such addition".
  daysCharged: number;
  daysInPeriod: number;
  openingWdv: number;
  amount: number;
  closingWdv: number;
  // True when this charge takes the asset to its residual and ends its life.
  final: boolean;
}

// Why an asset cannot be charged. Surfaced rather than skipped: an asset
// missing from a run without explanation is how a register quietly stops
// reconciling to the ledger.
export type BlockedReason =
  | "NOT_YET_IN_USE"
  | "FULLY_DEPRECIATED"
  | "WDV_NEEDS_RESIDUAL";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function dayCount(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
}

function isFrequency(v: string): v is DepreciationFrequency {
  return v === "MONTHLY" || v === "QUARTERLY" || v === "HALF_YEARLY" || v === "ANNUAL";
}

// Months of useful life a posted run consumed. Derived rather than stored:
// the run carries its period and its frequency, and the in-use date is on the
// asset, which is everything the proportion needs. A stored column would be
// one more thing that could disagree with the dates beside it.
function monthsConsumedBy(run: PostedRun, inUseDate: Date): number {
  const span = isFrequency(run.frequency) ? FREQUENCY_MONTHS[run.frequency] : 1;
  const effectiveStart = inUseDate > run.periodStart ? inUseDate : run.periodStart;
  const daysInPeriod = dayCount(run.periodStart, run.periodEnd);
  const daysCharged = dayCount(effectiveStart, run.periodEnd);
  if (daysInPeriod <= 0) return span;
  return span * Math.min(1, Math.max(0, daysCharged / daysInPeriod));
}

// Where the asset stands right now: what it is carried at, and how much life
// is left to charge.
export function positionOf(asset: RunAsset): { openingWdv: number; monthsRemaining: number } {
  let latest: PostedRun | null = null;
  let consumed = 0;
  for (const r of asset.runs) {
    consumed += monthsConsumedBy(r, asset.inUseDate);
    if (!latest || r.periodStart > latest.periodStart) latest = r;
  }
  return {
    openingWdv: latest ? latest.closingWdv : asset.grossCost,
    // Deliberately NOT rounded. Money is rounded to the paisa because money
    // is paid in paisa; months remaining is a DIVISOR, and rounding a divisor
    // moves every charge that follows it. An asset put to use on the 20th has
    // 119.6333… months left, not 119.63 — the second figure is off by three
    // paise a month for the next ten years.
    monthsRemaining: asset.usefulLifeMonths - consumed,
  };
}

// The charge for ONE period, taking the position as given. Exported for the
// posting route, which walks periods one at a time.
export function chargeForPeriod(
  asset: RunAsset,
  periodStart: Date,
  frequency: DepreciationFrequency,
  method: DepreciationMethod,
  position: { openingWdv: number; monthsRemaining: number },
): PeriodCharge | BlockedReason {
  const periodEnd = periodEndFor(periodStart, frequency);
  if (asset.inUseDate > periodEnd) return "NOT_YET_IN_USE";

  const { openingWdv: opening, monthsRemaining } = position;
  const residual = asset.residualValue;
  if (monthsRemaining <= 0.0001 || round2(opening - residual) <= 0) return "FULLY_DEPRECIATED";

  // The hole the CHECK constraint does not close. fixed_assets_wdv_residual_ck
  // guards the asset's own method column, but the method in force now comes
  // from the policy, so a class switched to WDV can reach an asset that was
  // capitalised under SLM with no residual. 1 - (0/opening)^(1/n) is 1: it
  // would write the entire asset off in a single period. Refuse instead.
  if (method === "WDV" && !(residual > 0)) return "WDV_NEEDS_RESIDUAL";

  const span = FREQUENCY_MONTHS[frequency];
  const effectiveStart = asset.inUseDate > periodStart ? asset.inUseDate : periodStart;
  const daysInPeriod = dayCount(periodStart, periodEnd);
  const daysCharged = dayCount(effectiveStart, periodEnd);

  const monthsThisPeriod = Math.min(span * (daysCharged / daysInPeriod), monthsRemaining);

  let amount = method === "WDV"
    // opening · (1 - (residual/opening)^(months/remaining)) — the monthly rate
    // 1-(R/O)^(1/remaining) compounded over the months this period charges.
    ? opening * (1 - Math.pow(residual / opening, monthsThisPeriod / monthsRemaining))
    : ((opening - residual) / monthsRemaining) * monthsThisPeriod;
  amount = round2(amount);

  // The last period is a balancing figure, so the asset lands on exactly its
  // residual instead of a rounding remainder either side of it.
  const monthsLeftAfter = monthsRemaining - monthsThisPeriod;
  let final = false;
  if (monthsLeftAfter <= 0.0001 || round2(opening - amount) < residual) {
    amount = round2(opening - residual);
    final = true;
  }

  return {
    periodStart, periodEnd, frequency, method,
    daysCharged, daysInPeriod,
    openingWdv: round2(opening),
    amount,
    closingWdv: round2(opening - amount),
    final,
  };
}

// Every period this asset still owes, from its first up to and including the
// target. Empty when it is up to date; more than one only for an asset added
// after later periods were already posted.
//
// methodFor is a callback rather than a lookup because resolving the method
// hits the database, and the caller can resolve one period once for a whole
// class instead of once per asset.
export function pendingPeriods(
  asset: RunAsset,
  target: Date,
  frequency: DepreciationFrequency,
  methodFor: (periodStart: Date) => DepreciationMethod,
): { charges: PeriodCharge[]; blocked: BlockedReason | null } {
  const span = FREQUENCY_MONTHS[frequency];
  const posted = new Set(asset.runs.map((r) => r.periodStart.getTime()));

  let cursor = periodStartFor(asset.inUseDate, frequency);
  if (cursor > target) return { charges: [], blocked: "NOT_YET_IN_USE" };

  const position = positionOf(asset);
  const charges: PeriodCharge[] = [];
  let blocked: BlockedReason | null = null;

  // Bounded by the life plus a period, so a bad date can never spin here.
  const maxPeriods = Math.ceil(asset.usefulLifeMonths / span) + 2;

  while (cursor <= target && charges.length < maxPeriods) {
    if (!posted.has(cursor.getTime())) {
      const result = chargeForPeriod(asset, cursor, frequency, methodFor(cursor), position);
      if (typeof result === "string") {
        // NOT_YET_IN_USE cannot happen here — the cursor starts at the asset's
        // own first period — so this is a real stop: nothing left to charge,
        // or a policy the asset cannot be charged under.
        blocked = result;
        break;
      }
      charges.push(result);
      position.openingWdv = result.closingWdv;
      position.monthsRemaining -= Math.min(
        span * (result.daysCharged / result.daysInPeriod),
        position.monthsRemaining,
      );
      if (result.final) break;
    }
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + span, 1));
  }

  // Only worth reporting when there is nothing to post instead. An asset that
  // finishes its life this period is charged AND finished; that is not a
  // block, it is the last instalment.
  return { charges, blocked: charges.length > 0 ? null : blocked };
}
