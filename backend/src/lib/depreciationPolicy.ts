import { prisma } from "../db";

// The depreciation method in force, and how it changes.
//
// The method is a company policy, not a per-asset choice — it is what a
// company declares once in its significant accounting policies and applies
// across the entity. Schedule II is silent on method; it prescribes useful
// lives. So the life belongs to the asset and the method belongs here.
//
// Changing it is permitted and PROSPECTIVE. Under AS 10 (revised) and
// Ind AS 16 a change of depreciation method is a change in accounting
// ESTIMATE, applied going forward — charges already posted stand and are
// never restated. (The superseded AS 6 required retrospective recomputation,
// which is why a lot of older material says the opposite.)
//
// Prospective application needs no rebasing step, because every charge is
// computed from the opening carrying amount, the months of life remaining,
// and the residual:
//
//   SLM  charge = (opening - residual) / remaining
//   WDV  charge = opening * (1 - (residual / opening) ^ (1 / remaining))
//
// Both land exactly on the residual at the end of the life, from wherever
// they start. A switch mid-life is therefore just the other formula from the
// effective month onward, in either direction, and nothing already posted is
// touched.

export type DepreciationMethod = "SLM" | "WDV";

export function isDepreciationMethod(v: unknown): v is DepreciationMethod {
  return v === "SLM" || v === "WDV";
}

// How often the charge is posted. The amount for a year is identical
// whichever this is — twelve monthly charges and one annual charge of the
// same total are the same expense. What differs is the number of journal
// entries and when the cost lands in an interim P&L.
export type DepreciationFrequency = "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL";

export const FREQUENCY_MONTHS: Record<DepreciationFrequency, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  HALF_YEARLY: 6,
  ANNUAL: 12,
};

export function isDepreciationFrequency(v: unknown): v is DepreciationFrequency {
  return v === "MONTHLY" || v === "QUARTERLY" || v === "HALF_YEARLY" || v === "ANNUAL";
}

// Periods are anchored to the Indian financial year — 1 April — not to the
// calendar. A company on quarterly depreciation means Apr-Jun, Jul-Sep,
// Oct-Dec, Jan-Mar, which is what its quarterly results are drawn on;
// Jan-Mar quarters would put a period boundary in the middle of the year it
// is reporting.
export function periodStartFor(month: Date, frequency: DepreciationFrequency): Date {
  const span = FREQUENCY_MONTHS[frequency];
  const y = month.getUTCFullYear();
  const m = month.getUTCMonth(); // 0 = January
  // Months since the start of the financial year this month belongs to.
  const sinceApril = (m - 3 + 12) % 12;
  const fyYear = m < 3 ? y - 1 : y;
  const blocksIn = Math.floor(sinceApril / span) * span;
  return new Date(Date.UTC(fyYear, 3 + blocksIn, 1));
}

// Last day of the period that starts here. Day 0 of the following month is
// the last day of the previous one, which avoids every month-length case.
export function periodEndFor(start: Date, frequency: DepreciationFrequency): Date {
  const span = FREQUENCY_MONTHS[frequency];
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + span, 0));
}

// "YYYY-MM" or "YYYY-MM-DD" -> the first of that month in UTC.
export function monthStart(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})(-\d{2})?$/.exec(value);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-01T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}

// The method that applies to a given month: the to_method of the latest
// change effective on or before it, falling back to the organization's own
// setting when there is none.
//
// Read per month rather than stamped onto each asset, which is what lets a
// change be dated forward — a change recorded in August to start in November
// must not alter September and October.
export async function methodInForce(
  organizationId: string,
  month: Date,
  assetClassId?: string | null,
): Promise<DepreciationMethod> {
  // A class that has been given its own method keeps it even when the
  // company changes — that is what an override means. A class that never
  // has follows the company automatically, with nothing to configure.
  if (assetClassId) {
    const forClass = await prisma.depreciationMethodChange.findFirst({
      where: { organizationId, assetClassId, effectiveMonth: { lte: month } },
      orderBy: { effectiveMonth: "desc" },
      select: { toMethod: true },
    });
    if (forClass && isDepreciationMethod(forClass.toMethod)) return forClass.toMethod;
  }

  const change = await prisma.depreciationMethodChange.findFirst({
    where: { organizationId, assetClassId: null, effectiveMonth: { lte: month } },
    orderBy: { effectiveMonth: "desc" },
    select: { toMethod: true },
  });
  if (change && isDepreciationMethod(change.toMethod)) return change.toMethod;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { depreciationMethod: true },
  });
  return isDepreciationMethod(org?.depreciationMethod) ? org!.depreciationMethod as DepreciationMethod : "SLM";
}

// The frequency in force. Unlike the method this has no dated history — a
// frequency change takes effect from the next unposted period, and the
// periods already posted carry their own frequency on the run row, so
// nothing is lost by keeping only the current value.
export async function frequencyInForce(organizationId: string): Promise<DepreciationFrequency> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { depreciationFrequency: true },
  });
  return isDepreciationFrequency(org?.depreciationFrequency) ? org!.depreciationFrequency : "MONTHLY";
}

// The start of the most recently posted charge period, or null if nothing
// has ever posted. A method change cannot take effect on or before this:
// those charges are history, and a change in estimate does not reach
// backwards.
export async function lastPostedChargeMonth(organizationId: string): Promise<Date | null> {
  const run = await prisma.fixedAssetDepreciationRun.findFirst({
    where: { fixedAsset: { organizationId } },
    orderBy: { periodStart: "desc" },
    select: { periodEnd: true },
  });
  // The END of the last posted period, because a change may not land inside
  // a period already charged. Under annual depreciation, posting 2026-27
  // blocks any change before April 2027 — not merely before April 2026.
  return run?.periodEnd ?? null;
}
