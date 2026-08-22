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
): Promise<DepreciationMethod> {
  const change = await prisma.depreciationMethodChange.findFirst({
    where: { organizationId, effectiveMonth: { lte: month } },
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

// The month of the most recently posted depreciation charge, or null if
// nothing has ever posted. A method change cannot take effect on or before
// this month: those charges are history, and a change in estimate does not
// reach backwards.
export async function lastPostedChargeMonth(organizationId: string): Promise<Date | null> {
  const run = await prisma.fixedAssetDepreciationRun.findFirst({
    where: { fixedAsset: { organizationId } },
    orderBy: { periodMonth: "desc" },
    select: { periodMonth: true },
  });
  return run?.periodMonth ?? null;
}
