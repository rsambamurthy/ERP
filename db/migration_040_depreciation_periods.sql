-- A run is a thing that happened, so it gets a row.
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
-- Reversal, which finds a run's entries through the charge rows at that
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
  -- Stored so a run's own figure can be compared against the charge rows,
  -- which is how a partial write would be noticed.
  total_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  asset_count       INTEGER NOT NULL DEFAULT 0,
  posted_by         UUID,
  posted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT dep_periods_start_ck  CHECK (period_start = date_trunc('month', period_start)::date),
  CONSTRAINT dep_periods_period_ck CHECK (period_end >= period_start),
  CONSTRAINT dep_periods_freq_ck   CHECK (frequency IN ('MONTHLY','QUARTERLY','HALF_YEARLY','ANNUAL')),
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
--    WHERE table_name = 'depreciation_periods' ORDER BY ordinal_position;
--
--   SELECT indexname FROM pg_indexes WHERE tablename = 'depreciation_periods';
--   -- expect depreciation_periods_pkey, dep_periods_org_end_idx,
--   -- dep_periods_org_start_uq
--
--   SELECT count(*) AS periods FROM depreciation_periods;
--   -- expect 0 on a register that has never been run
