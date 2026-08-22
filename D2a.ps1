$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Depreciation run: migration 040 and schema...' -ForegroundColor Cyan

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

Set-FileText 'db/migration_040_depreciation_periods.sql' '-- A run is a thing that happened, so it gets a row.
--
-- WHY THIS EXISTS
--
-- Up to now "which period has been posted" was inferred from the charge rows
-- — max(period_start) across fixed_asset_depreciation_runs. That is right
-- almost always and wrong in a way that costs real money when it is.
--
-- A run charges every period each asset still owes up to the target. Usually
-- that is the target itself. But an asset can owe several EARLIER periods and
-- nothing at the target: an opening-balance asset entered by hand with a
-- backdated in-use date and a life that already expired. Post it, and the run
-- writes a journal entry and a fistful of charge rows at old periods — and
-- not one row at the target. max(period_start) therefore does not move.
--
-- Everything downstream then goes quietly wrong. The same period is offered
-- again and posts a SECOND journal entry with the same date and narration.
-- Reversal, which finds a run''s entries through the charge rows at that
-- period, cannot see the first entry at all. And if that asset was the only
-- one with anything outstanding, the next attempt answers "nothing is due"
-- forever while a journal entry for the period sits in the ledger.
--
-- The fix is to stop inferring. A run records itself.
--
-- WHAT IT DOES NOT DO
--
-- It does not hold the charges — those stay on
-- fixed_asset_depreciation_runs, one row per asset per period, because that
-- is the grain the register and the schedule need. This table is the header:
-- one row per period actually run.
--
-- UNIQUE (organization_id, period_start) is the second guard. Even if the
-- inference logic above were reintroduced by accident, the database would
-- refuse the duplicate rather than write it.
--
-- Run after migration_039_class_level_method.sql. Statements stand alone —
-- run them one at a time.
--
-- Idempotent: safe to re-run.


-- 1. The table.
CREATE TABLE IF NOT EXISTS depreciation_periods (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  -- Always the first of a month, whichever frequency the period belongs to —
  -- the same rule fixed_asset_depreciation_runs.period_start follows.
  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,
  -- Recorded per run rather than read from the organization, because the
  -- policy can change and a period already posted has to stay explicable
  -- under the frequency it was actually computed at.
  frequency         VARCHAR(12) NOT NULL,
  -- What the run charged in total, including catch-up for earlier periods.
  -- Stored so a run''s own figure can be compared against the charge rows,
  -- which is how a partial write would be noticed.
  total_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  asset_count       INTEGER NOT NULL DEFAULT 0,
  posted_by         UUID,
  posted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT dep_periods_start_ck  CHECK (period_start = date_trunc(''month'', period_start)::date),
  CONSTRAINT dep_periods_period_ck CHECK (period_end >= period_start),
  CONSTRAINT dep_periods_freq_ck   CHECK (frequency IN (''MONTHLY'',''QUARTERLY'',''HALF_YEARLY'',''ANNUAL'')),
  CONSTRAINT dep_periods_amount_ck CHECK (total_amount >= 0)
);


-- 2. One run per period per organization.
CREATE UNIQUE INDEX IF NOT EXISTS dep_periods_org_start_uq
  ON depreciation_periods (organization_id, period_start);


-- 3. "What is posted through" is read on every visit to the due screen.
CREATE INDEX IF NOT EXISTS dep_periods_org_end_idx
  ON depreciation_periods (organization_id, period_end DESC);


-- 4. Backfill, for any organization that posted before this table existed.
--    Groups the existing charge rows by their period and reconstructs a
--    header from them. Under the old logic those runs all had a charge at
--    their own period — the case this table fixes could not have been posted
--    without leaving the run stuck — so grouping by period_start is exact.
INSERT INTO depreciation_periods (organization_id, period_start, period_end, frequency, total_amount, asset_count)
SELECT fa.organization_id, r.period_start, MAX(r.period_end), MIN(r.frequency),
       SUM(r.amount), COUNT(DISTINCT r.fixed_asset_id)
  FROM fixed_asset_depreciation_runs r
  JOIN fixed_assets fa ON fa.id = r.fixed_asset_id
 WHERE NOT EXISTS (
         SELECT 1 FROM depreciation_periods p
          WHERE p.organization_id = fa.organization_id
            AND p.period_start = r.period_start
       )
 GROUP BY fa.organization_id, r.period_start;


-- Verify:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = ''depreciation_periods'' ORDER BY ordinal_position;
--
--   SELECT indexname FROM pg_indexes WHERE tablename = ''depreciation_periods'';
--   -- expect depreciation_periods_pkey, dep_periods_org_end_idx,
--   -- dep_periods_org_start_uq
--
--   SELECT count(*) AS periods FROM depreciation_periods;
--   -- expect 0 on a register that has never been run
'

Edit-FileText 'backend/prisma/schema.prisma' '  prepaidSchedules PrepaidSchedule[]
  assetClasses     AssetClass[]
  fixedAssets      FixedAsset[]
  depreciationMethodChanges DepreciationMethodChange[]
  stockAdjustments StockAdjustment[]
  salesReturns     SalesReturn[]
  purchaseReturns  PurchaseReturn[]
  stockMovements   StockMovement[]
' '  prepaidSchedules PrepaidSchedule[]
  assetClasses     AssetClass[]
  fixedAssets      FixedAsset[]
  depreciationMethodChanges DepreciationMethodChange[]
  depreciationPeriods DepreciationPeriod[]
  stockAdjustments StockAdjustment[]
  salesReturns     SalesReturn[]
  purchaseReturns  PurchaseReturn[]
  stockMovements   StockMovement[]
'

Edit-FileText 'backend/prisma/schema.prisma' '  @@index([organizationId, assetClassId, effectiveMonth])
  @@map("depreciation_method_changes")
}

model FixedAssetDepreciationRun {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  fixedAssetId   String   @map("fixed_asset_id") @db.Uuid
  // A PERIOD, not a month. An annual charge is one row covering twelve
' '  @@index([organizationId, assetClassId, effectiveMonth])
  @@map("depreciation_method_changes")
}

model DepreciationPeriod {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId String   @map("organization_id") @db.Uuid
  // A run is a thing that happened, so it gets a row. Which period has been
  // posted used to be inferred from max(period_start) across the charge rows,
  // which is wrong for a run whose charges all landed on EARLIER periods —
  // see migration_040. Inference replaced by a record.
  periodStart    DateTime @map("period_start") @db.Date
  periodEnd      DateTime @map("period_end") @db.Date
  frequency      String   @db.VarChar(12)
  totalAmount    Decimal  @default(0) @map("total_amount") @db.Decimal(14, 2)
  assetCount     Int      @default(0) @map("asset_count")
  postedBy       String?  @map("posted_by") @db.Uuid
  postedAt       DateTime @default(now()) @map("posted_at")

  organization Organization @relation(fields: [organizationId], references: [id])

  @@unique([organizationId, periodStart], map: "dep_periods_org_start_uq")
  @@index([organizationId, periodEnd])
  @@map("depreciation_periods")
}

model FixedAssetDepreciationRun {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  fixedAssetId   String   @map("fixed_asset_id") @db.Uuid
  // A PERIOD, not a month. An annual charge is one row covering twelve
'

Edit-FileText 'backend/src/lib/depreciationPolicy.ts' '// has ever posted. A method change cannot take effect on or before this:
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
' '// has ever posted. A method change cannot take effect on or before this:
// those charges are history, and a change in estimate does not reach
// backwards.
export async function lastPostedChargeMonth(organizationId: string): Promise<Date | null> {
  // Read from the run header, not from the charge rows. A run whose charges
  // all fell on earlier periods writes no charge row at its own period, so
  // max(period_start) across the charges can lag behind what has actually
  // been posted — and a method change let in behind it would be reaching
  // into a period already closed. See migration_040.
  const run = await prisma.depreciationPeriod.findFirst({
    where: { organizationId },
    orderBy: { periodEnd: "desc" },
    select: { periodEnd: true },
  });
  // The END of the last posted period, because a change may not land inside
  // a period already charged. Under annual depreciation, posting 2026-27
'

Edit-FileText 'backend/src/routes/depreciationPolicy.ts' 'import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import {
  isDepreciationFrequency, isDepreciationMethod, lastPostedChargeMonth,
  methodInForce, monthStart,
} from "../lib/depreciationPolicy";

// Configuration > Depreciation. Everything about how this company
// depreciates, in one place:
' 'import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import {
  isDepreciationFrequency, isDepreciationMethod, lastPostedChargeMonth,
  methodInForce, monthStart, periodEndFor, periodStartFor,
} from "../lib/depreciationPolicy";

// Configuration > Depreciation. Everything about how this company
// depreciates, in one place:
'

Edit-FileText 'backend/src/routes/depreciationPolicy.ts' '  if (frequency !== undefined) {
    if (!isDepreciationFrequency(frequency)) {
      return res.status(400).json({ message: "frequency must be MONTHLY, QUARTERLY, HALF_YEARLY or ANNUAL." });
    }
    data.depreciationFrequency = frequency;
  }

  if (capitalisationThreshold !== undefined) {
' '  if (frequency !== undefined) {
    if (!isDepreciationFrequency(frequency)) {
      return res.status(400).json({ message: "frequency must be MONTHLY, QUARTERLY, HALF_YEARLY or ANNUAL." });
    }

    // A longer frequency can only start where the posted history stops on one
    // of its own boundaries. Post April and May monthly, switch to quarterly,
    // and the next quarterly period is April to June — which overlaps two
    // periods already charged. Refusing it here is better than letting the
    // run refuse it later, because here the fix is one more monthly posting
    // and there it looks like the run is broken.
    const postedTo = await lastPostedChargeMonth(organizationId);
    if (postedTo) {
      const boundary = periodEndFor(periodStartFor(postedTo, frequency), frequency);
      if (boundary.getTime() !== postedTo.getTime()) {
        return res.status(409).json({
          message: `Depreciation is posted up to ${postedTo.toISOString().slice(0, 10)}, which is not where a ${String(frequency).toLowerCase().replace("_", "-")} period ends. Post up to ${boundary.toISOString().slice(0, 10)} at the current frequency first, then change it.`,
        });
      }
    }

    data.depreciationFrequency = frequency;
  }

  if (capitalisationThreshold !== undefined) {
'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green