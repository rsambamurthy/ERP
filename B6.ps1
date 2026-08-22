$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Depreciation config: schema and helper...' -ForegroundColor Cyan

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

Edit-FileText 'backend/prisma/schema.prisma' '  // disclosed. Changing it is a change in accounting estimate and applies
  // prospectively — see lib/depreciationPolicy.ts and migration_036.
  depreciationMethod String @default("SLM") @map("depreciation_method") @db.VarChar(3)
  domainLockedAt      DateTime? @map("domain_locked_at")
  // Company Master data — for statutory filings (AOC-4 etc.), not used by
  // any transactional posting anywhere. All nullable and unvalidated in' '  // disclosed. Changing it is a change in accounting estimate and applies
  // prospectively — see lib/depreciationPolicy.ts and migration_036.
  depreciationMethod String @default("SLM") @map("depreciation_method") @db.VarChar(3)
  // How often depreciation is charged. The amount for a year is the same
  // whichever this is; what changes is how many journal entries there are
  // and when the expense shows up in an interim P&L. Plenty of companies
  // compute it once at close. See migration_038.
  depreciationFrequency String @default("MONTHLY") @map("depreciation_frequency") @db.VarChar(12)
  // Below this, a capitalised line is expensed instead — nobody wants a
  // fixed asset carrying a forty-rupee monthly charge. Zero means no
  // threshold, which is what every organization starts with.
  capitalisationThreshold Decimal @default(0) @map("capitalisation_threshold") @db.Decimal(14, 2)
  domainLockedAt      DateTime? @map("domain_locked_at")
  // Company Master data — for statutory filings (AOC-4 etc.), not used by
  // any transactional posting anywhere. All nullable and unvalidated in'

Edit-FileText 'backend/prisma/schema.prisma' '  // above because the default is editable and this is not. Part A paragraph
  // 3(i) measures a deviation against the statute, so editing a class must
  // never move the yardstick. See migration_035.
  scheduleIiLifeMonths    Int      @map("schedule_ii_life_months")
  defaultMethod           String   @default("SLM") @map("default_method") @db.VarChar(3)
  // 5% is the Schedule II ceiling ("shall not be more than five per cent of
  // the original cost"), not a requirement — hence a default, not a constant.' '  // above because the default is editable and this is not. Part A paragraph
  // 3(i) measures a deviation against the statute, so editing a class must
  // never move the yardstick. See migration_035.
  // What the Companies Act prescribes. Editable, because the Act itself can
  // be amended — a yardstick that could not move would make every asset look
  // like a deviation the day it was. Editing it is a different act from
  // editing the policy life above, and rarer.
  scheduleIiLifeMonths    Int      @map("schedule_ii_life_months")
  // Part A paragraph 3(i)''s justification, for a POLICY life shorter than
  // the statute. It lives here rather than on each asset because shortening
  // Computers from 72 months to 36 is one decision, not one per computer;
  // every asset copies this at capitalisation. See migration_038.
  lifePolicyNote          String?  @map("life_policy_note") @db.VarChar(500)
  defaultMethod           String   @default("SLM") @map("default_method") @db.VarChar(3)
  // 5% is the Schedule II ceiling ("shall not be more than five per cent of
  // the original cost"), not a requirement — hence a default, not a constant.'

Edit-FileText 'backend/prisma/schema.prisma' 'model FixedAssetDepreciationRun {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  fixedAssetId   String   @map("fixed_asset_id") @db.Uuid
  periodMonth    DateTime @map("period_month") @db.Date
  amount         Decimal  @db.Decimal(14, 2)
  // Stored, not recomputed on read. Under WDV each month depends on the one
  // before it, so recomputing an old figure from today''s rules would rewrite' 'model FixedAssetDepreciationRun {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  fixedAssetId   String   @map("fixed_asset_id") @db.Uuid
  // A PERIOD, not a month. An annual charge is one row covering twelve
  // months, not twelve rows summed — see migration_038. periodStart is
  // always the first of a month whichever frequency it belongs to.
  periodStart    DateTime @map("period_start") @db.Date
  periodEnd      DateTime @map("period_end") @db.Date
  // Recorded per run rather than read from the organization, because the
  // policy can change and a charge already posted has to stay explicable
  // under the frequency it was actually computed at.
  frequency      String   @db.VarChar(12)
  amount         Decimal  @db.Decimal(14, 2)
  // Stored, not recomputed on read. Under WDV each month depends on the one
  // before it, so recomputing an old figure from today''s rules would rewrite'

Edit-FileText 'backend/prisma/schema.prisma' '
  fixedAsset FixedAsset @relation(fields: [fixedAssetId], references: [id])

  @@unique([fixedAssetId, periodMonth])
  @@map("fixed_asset_depreciation_runs")
}
' '
  fixedAsset FixedAsset @relation(fields: [fixedAssetId], references: [id])

  @@unique([fixedAssetId, periodStart])
  @@map("fixed_asset_depreciation_runs")
}
'

Edit-FileText 'backend/src/lib/depreciationPolicy.ts' '
export function isDepreciationMethod(v: unknown): v is DepreciationMethod {
  return v === "SLM" || v === "WDV";
}

// "YYYY-MM" or "YYYY-MM-DD" -> the first of that month in UTC.' '
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

// "YYYY-MM" or "YYYY-MM-DD" -> the first of that month in UTC.'

Edit-FileText 'backend/src/lib/depreciationPolicy.ts' '  return isDepreciationMethod(org?.depreciationMethod) ? org!.depreciationMethod as DepreciationMethod : "SLM";
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
' '  return isDepreciationMethod(org?.depreciationMethod) ? org!.depreciationMethod as DepreciationMethod : "SLM";
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
'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green