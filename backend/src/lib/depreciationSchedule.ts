import {
  DepreciationFrequency, DepreciationMethod, FREQUENCY_MONTHS,
  periodEndFor, periodStartFor,
} from "./depreciationPolicy";

// What an asset will be charged, period by period, from the day it was put
// to use until its carrying amount reaches its residual value.
//
// This is a PROJECTION. Nothing here reads or writes a posted charge — it
// answers "what is this asset going to cost the P&L, and when", which is the
// question the schedule popup exists to answer. The run engine computes each
// period the same way, but against the asset's actual opening balance, so a
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
