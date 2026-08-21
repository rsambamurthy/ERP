$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Writing migration_034_depreciation.sql...' -ForegroundColor Cyan

function Set-FileText($rel, $text) {
  $p = Join-Path $repo $rel
  $dir = Split-Path $p -Parent
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [IO.File]::WriteAllText($p, $text.Replace([string][char]13, ''), (New-Object Text.UTF8Encoding $false))
  Write-Host ('  wrote  ' + $rel)
}

Set-FileText 'db/migration_034_depreciation.sql' '-- Depreciation: fixed asset register, Companies Act books, Income Tax blocks.
--
-- An asset bought today is not an expense of today. Schedule II of the
-- Companies Act spreads it over the asset''s useful life; Section 32 of the
-- Income Tax Act spreads it at a prescribed rate over a pool of similar
-- assets. The two never agree, and both are correct — they answer different
-- questions under different statutes.
--
-- Only the first one posts. This migration builds one register that serves
-- both: every asset carries a Schedule II useful life AND an income-tax block
-- code. The monthly journal comes from the first. The block-of-assets
-- schedule for the tax return is derived from the second and writes nothing.
--
-- The book/tax difference this creates is what deferred tax accounts for.
-- Nothing here computes deferred tax; that is a deliberate omission, not an
-- oversight.
--
-- Run after migration_033_bp_type_prepaid.sql:
--   psql "$DATABASE_URL" -f db/migration_034_depreciation.sql
--
-- Idempotent: safe to re-run.

BEGIN;

-- ── 1. Let an asset have a sub-ledger card ──────────────────────────────
-- Each asset gets its own card under both its cost account and its
-- accumulated-depreciation account, so one asset''s gross block, accumulated
-- depreciation and net book value are all readable from the ledger itself —
-- the fixed-asset schedule an auditor asks for becomes a sub-ledger report
-- rather than a bespoke query.
--
-- business_partners.bp_type carries a CHECK constraint listing its permitted
-- values, and Prisma models that column as a plain String — so neither
-- `prisma generate` nor `tsc` can see this constraint. Forgetting to extend
-- it is invisible until Postgres rejects the insert at runtime, which is
-- exactly how it went wrong for PREPAID in migration_033. Extend it FIRST.

ALTER TABLE business_partners
  DROP CONSTRAINT IF EXISTS business_partners_bp_type_check;

ALTER TABLE business_partners
  ADD CONSTRAINT business_partners_bp_type_check
  CHECK (bp_type IN (''CUSTOMER'', ''VENDOR'', ''ITEM'', ''PREPAID'', ''ASSET''));

-- ── 2. The accounts ─────────────────────────────────────────────────────
-- Ten balance-sheet accounts (five asset classes, five contra) plus three
-- P&L accounts. Accumulated depreciation is a SEPARATE contra-asset account,
-- never a credit against the asset: Schedule III requires gross block,
-- accumulated depreciation and net block to be shown separately, and netting
-- them at posting time destroys that information permanently.
--
-- As in migration_032, an account has to be added in two places:
-- coa_templates for organizations provisioned from now on, and accounts for
-- the ones that already exist. domain_type_id IS NULL means "core chart,
-- every domain".

CREATE TEMP TABLE _dep_accounts (
  account_code       VARCHAR(20),
  account_name       VARCHAR(120),
  account_type       VARCHAR(20),
  is_control_account BOOLEAN,
  default_bp_type    VARCHAR(20),
  schedule_iii_head  VARCHAR(60)
) ON COMMIT DROP;

INSERT INTO _dep_accounts VALUES
  (''1401'', ''Land & Buildings'',                        ''ASSET'',   true,  ''ASSET'', ''FIXED_ASSETS''),
  (''1402'', ''Plant & Machinery'',                       ''ASSET'',   true,  ''ASSET'', ''FIXED_ASSETS''),
  (''1403'', ''Furniture & Fixtures'',                    ''ASSET'',   true,  ''ASSET'', ''FIXED_ASSETS''),
  (''1404'', ''Vehicles'',                                ''ASSET'',   true,  ''ASSET'', ''FIXED_ASSETS''),
  (''1405'', ''Computers & Equipment'',                   ''ASSET'',   true,  ''ASSET'', ''FIXED_ASSETS''),
  (''1451'', ''Accumulated Depreciation - Buildings'',    ''ASSET'',   true,  ''ASSET'', ''FIXED_ASSETS''),
  (''1452'', ''Accumulated Depreciation - Plant & Machinery'', ''ASSET'', true, ''ASSET'', ''FIXED_ASSETS''),
  (''1453'', ''Accumulated Depreciation - Furniture'',    ''ASSET'',   true,  ''ASSET'', ''FIXED_ASSETS''),
  (''1454'', ''Accumulated Depreciation - Vehicles'',     ''ASSET'',   true,  ''ASSET'', ''FIXED_ASSETS''),
  (''1455'', ''Accumulated Depreciation - Computers'',    ''ASSET'',   true,  ''ASSET'', ''FIXED_ASSETS''),
  (''4020'', ''Depreciation & Amortisation'',             ''EXPENSE'', false, NULL,    NULL),
  (''4021'', ''Loss on Disposal of Assets'',              ''EXPENSE'', false, NULL,    NULL),
  (''5010'', ''Gain on Disposal of Assets'',              ''INCOME'',  false, NULL,    NULL);

INSERT INTO coa_templates (
  id, domain_type_id, account_code, account_name,
  account_type, is_control_account, default_bp_type, schedule_iii_head
)
SELECT
  gen_random_uuid(), NULL, d.account_code, d.account_name,
  d.account_type, d.is_control_account, d.default_bp_type, d.schedule_iii_head
FROM _dep_accounts d
WHERE NOT EXISTS (
  SELECT 1 FROM coa_templates t
  WHERE t.domain_type_id IS NULL AND t.account_code = d.account_code
);

-- is_system = true to match lib/provisioning.ts, which sets it on every
-- templated account — without it these would be the only core accounts a
-- user could rename or delete through routes/accounts.ts.
INSERT INTO accounts (
  id, organization_id, account_code, account_name,
  account_type, is_group, is_control_account, default_bp_type,
  schedule_iii_head, is_system, is_active
)
SELECT
  gen_random_uuid(), o.id, d.account_code, d.account_name,
  d.account_type, false, d.is_control_account, d.default_bp_type,
  d.schedule_iii_head, true, true
FROM organizations o
CROSS JOIN _dep_accounts d
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a
  WHERE a.organization_id = o.id AND a.account_code = d.account_code
);

-- ── 3. Asset classes ────────────────────────────────────────────────────
-- Seeded per organization and editable, NOT hardcoded. Rates move with each
-- Finance Act and Schedule II lets a company justify a different life for its
-- own circumstances, so these are defaults an org can change — and each asset
-- pins its own life and rate at capitalisation rather than reading this table
-- forever.
--
-- Lives are Schedule II; block rates are the Income Tax prescribed rates.
-- Residual defaults to 5%, which is the Schedule II CEILING ("shall not be
-- more than five per cent of the original cost") rather than a requirement.

CREATE TABLE IF NOT EXISTS asset_classes (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id            UUID NOT NULL REFERENCES organizations(id),
  name                       VARCHAR(120) NOT NULL,
  asset_account_id           UUID NOT NULL REFERENCES accounts(id),
  accum_dep_account_id       UUID NOT NULL REFERENCES accounts(id),
  dep_expense_account_id     UUID NOT NULL REFERENCES accounts(id),
  default_useful_life_months INTEGER NOT NULL,
  default_method             VARCHAR(3) NOT NULL DEFAULT ''SLM'',
  default_residual_pct       NUMERIC(5,2) NOT NULL DEFAULT 5.00,
  -- Free text rather than an enum: the block list is statutory and changes.
  default_it_block_code      VARCHAR(30) NOT NULL,
  default_it_rate            NUMERIC(5,2) NOT NULL,
  is_active                  BOOLEAN NOT NULL DEFAULT true,
  sort_order                 INTEGER NOT NULL DEFAULT 0,
  created_at                 TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT asset_classes_name_uq     UNIQUE (organization_id, name),
  CONSTRAINT asset_classes_method_ck   CHECK (default_method IN (''SLM'',''WDV'')),
  CONSTRAINT asset_classes_life_ck     CHECK (default_useful_life_months BETWEEN 1 AND 1200),
  CONSTRAINT asset_classes_residual_ck CHECK (default_residual_pct >= 0 AND default_residual_pct <= 100),
  CONSTRAINT asset_classes_it_rate_ck  CHECK (default_it_rate >= 0 AND default_it_rate <= 100)
);

CREATE TEMP TABLE _dep_classes (
  name        VARCHAR(120),
  asset_code  VARCHAR(20),
  accum_code  VARCHAR(20),
  life_months INTEGER,
  it_block    VARCHAR(30),
  it_rate     NUMERIC(5,2),
  sort_order  INTEGER
) ON COMMIT DROP;

INSERT INTO _dep_classes VALUES
  (''Buildings - factory'',            ''1401'', ''1451'',  360, ''BUILDING_10'', 10.00, 10),
  (''Buildings - other (RCC frame)'',  ''1401'', ''1451'',  720, ''BUILDING_10'', 10.00, 20),
  (''Buildings - residential'',        ''1401'', ''1451'',  720, ''BUILDING_05'',  5.00, 30),
  (''Plant & machinery - general'',    ''1402'', ''1452'',  180, ''PM_15'',       15.00, 40),
  (''Electrical installations'',       ''1402'', ''1452'',  120, ''PM_15'',       15.00, 50),
  (''Furniture & fittings'',           ''1403'', ''1453'',  120, ''FF_10'',       10.00, 60),
  (''Vehicles - commercial'',          ''1404'', ''1454'',   72, ''MV_15'',       15.00, 70),
  (''Vehicles - other'',               ''1404'', ''1454'',   96, ''MV_15'',       15.00, 80),
  (''Motorcycles & scooters'',         ''1404'', ''1454'',  120, ''MV_15'',       15.00, 90),
  (''Computers - servers & networks'', ''1405'', ''1455'',   72, ''COMP_40'',     40.00, 100),
  (''Computers - desktops & laptops'', ''1405'', ''1455'',   36, ''COMP_40'',     40.00, 110),
  (''Office equipment'',               ''1405'', ''1455'',   60, ''OE_15'',       15.00, 120);

INSERT INTO asset_classes (
  id, organization_id, name,
  asset_account_id, accum_dep_account_id, dep_expense_account_id,
  default_useful_life_months, default_method, default_residual_pct,
  default_it_block_code, default_it_rate, sort_order
)
SELECT
  gen_random_uuid(), o.id, c.name,
  aa.id, ad.id, de.id,
  c.life_months, ''SLM'', 5.00,
  c.it_block, c.it_rate, c.sort_order
FROM organizations o
CROSS JOIN _dep_classes c
JOIN accounts aa ON aa.organization_id = o.id AND aa.account_code = c.asset_code
JOIN accounts ad ON ad.organization_id = o.id AND ad.account_code = c.accum_code
JOIN accounts de ON de.organization_id = o.id AND de.account_code = ''4020''
WHERE NOT EXISTS (
  SELECT 1 FROM asset_classes x
  WHERE x.organization_id = o.id AND x.name = c.name
);

-- ── 4. The assets ───────────────────────────────────────────────────────
-- purchase_bill_id / purchase_bill_line_id are nullable so an asset owned
-- before SmartARP existed can be opened by hand. Nothing creates one that way
-- yet.
--
-- The three account ids are snapshots, not live reads of the class: moving a
-- class to a different account later must change what future assets do, never
-- redirect the remaining charges of an asset already half-depreciated. Same
-- reasoning as migration_031''s GST snapshots and migration_032''s expense
-- account.
--
-- in_use_date, not purchase_date, is what depreciation runs from — Schedule
-- II charges "on a pro rata basis from the date of such addition", and an
-- asset sitting in a crate is not yet in use.

CREATE TABLE IF NOT EXISTS fixed_assets (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID NOT NULL REFERENCES organizations(id),
  branch_id              UUID REFERENCES branches(id),
  asset_class_id         UUID NOT NULL REFERENCES asset_classes(id),
  purchase_bill_id       UUID REFERENCES purchase_bills(id),
  purchase_bill_line_id  UUID REFERENCES purchase_bill_lines(id),
  -- This asset''s sub-ledger card, tagged on both balance-sheet accounts.
  business_partner_id    UUID NOT NULL REFERENCES business_partners(id),
  asset_code             VARCHAR(30) NOT NULL,
  name                   VARCHAR(200) NOT NULL,
  asset_account_id       UUID NOT NULL REFERENCES accounts(id),
  accum_dep_account_id   UUID NOT NULL REFERENCES accounts(id),
  dep_expense_account_id UUID NOT NULL REFERENCES accounts(id),
  -- Depreciable base is gross_cost - residual_value.
  gross_cost             NUMERIC(14,2) NOT NULL,
  residual_value         NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Section 16(3): claim the input tax credit OR capitalise the GST and
  -- depreciate it, never both. true means the GST is inside gross_cost.
  gst_capitalised        BOOLEAN NOT NULL DEFAULT false,
  purchase_date          DATE NOT NULL,
  in_use_date            DATE NOT NULL,
  method                 VARCHAR(3) NOT NULL DEFAULT ''SLM'',
  useful_life_months     INTEGER NOT NULL,
  -- Pinned per asset: block rates change by Finance Act, and an asset keeps
  -- computing at the rate it was capitalised under.
  it_block_code          VARCHAR(30) NOT NULL,
  it_rate                NUMERIC(5,2) NOT NULL,
  status                 VARCHAR(20) NOT NULL DEFAULT ''ACTIVE'',
  disposal_date            DATE,
  disposal_proceeds        NUMERIC(14,2),
  disposal_journal_entry_id UUID REFERENCES journal_entries(id),
  created_by             UUID REFERENCES users(id),
  created_at             TIMESTAMP NOT NULL DEFAULT now(),
  deleted_at             TIMESTAMP,
  CONSTRAINT fixed_assets_code_uq     UNIQUE (organization_id, asset_code),
  CONSTRAINT fixed_assets_cost_ck     CHECK (gross_cost > 0),
  CONSTRAINT fixed_assets_residual_ck CHECK (residual_value >= 0 AND residual_value < gross_cost),
  CONSTRAINT fixed_assets_life_ck     CHECK (useful_life_months BETWEEN 1 AND 1200),
  CONSTRAINT fixed_assets_method_ck   CHECK (method IN (''SLM'',''WDV'')),
  CONSTRAINT fixed_assets_status_ck   CHECK (status IN (''ACTIVE'',''FULLY_DEPRECIATED'',''DISPOSED'')),
  -- An asset cannot be in use before it was bought.
  CONSTRAINT fixed_assets_dates_ck    CHECK (in_use_date >= purchase_date),
  CONSTRAINT fixed_assets_rate_ck     CHECK (it_rate >= 0 AND it_rate <= 100)
);

CREATE INDEX IF NOT EXISTS fixed_assets_org_status_idx
  ON fixed_assets (organization_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS fixed_assets_bill_idx
  ON fixed_assets (purchase_bill_id);

CREATE INDEX IF NOT EXISTS fixed_assets_block_idx
  ON fixed_assets (organization_id, it_block_code)
  WHERE deleted_at IS NULL;

-- One asset per bill line: a line either is capitalised or isn''t.
CREATE UNIQUE INDEX IF NOT EXISTS fixed_assets_line_uq
  ON fixed_assets (purchase_bill_line_id)
  WHERE purchase_bill_line_id IS NOT NULL;

-- ── 5. The charges actually posted ──────────────────────────────────────
-- The UNIQUE on (fixed_asset_id, period_month) is the idempotency guard, and
-- it is load-bearing rather than decorative: two people posting the same
-- month at once means the second INSERT raises a unique violation and rolls
-- its whole transaction back — including the journal entry it had already
-- written — instead of charging depreciation twice. Identical to
-- recurring_expense_runs (migration_030) and prepaid_schedule_runs (032).
--
-- opening_wdv / closing_wdv are stored rather than recomputed on read. Under
-- WDV each month''s charge depends on the one before it, so recomputing a
-- five-year-old figure from today''s rules would silently rewrite history —
-- the same class of bug migration_031 fixed for GST.

CREATE TABLE IF NOT EXISTS fixed_asset_depreciation_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixed_asset_id   UUID NOT NULL REFERENCES fixed_assets(id),
  -- First of the month being charged.
  period_month     DATE NOT NULL,
  amount           NUMERIC(14,2) NOT NULL,
  opening_wdv      NUMERIC(14,2) NOT NULL,
  closing_wdv      NUMERIC(14,2) NOT NULL,
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(id),
  -- DISPOSAL_CATCHUP is the pro-rata charge up to a disposal date, posted
  -- with the disposal rather than on the monthly run.
  run_type         VARCHAR(20) NOT NULL DEFAULT ''MONTHLY'',
  generated_by     UUID REFERENCES users(id),
  generated_at     TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT fa_dep_runs_uq       UNIQUE (fixed_asset_id, period_month),
  CONSTRAINT fa_dep_runs_type_ck  CHECK (run_type IN (''MONTHLY'',''DISPOSAL_CATCHUP'')),
  CONSTRAINT fa_dep_runs_month_ck CHECK (date_trunc(''month'', period_month) = period_month),
  CONSTRAINT fa_dep_runs_amount_ck CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS fa_dep_runs_period_idx
  ON fixed_asset_depreciation_runs (period_month);

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────
--
--   SELECT count(*) AS orgs FROM organizations;
--
--   -- 13 accounts per organization
--   SELECT count(*) AS dep_accounts FROM accounts
--     WHERE account_code IN (''1401'',''1402'',''1403'',''1404'',''1405'',
--                            ''1451'',''1452'',''1453'',''1454'',''1455'',
--                            ''4020'',''4021'',''5010'');
--
--   -- 12 classes per organization
--   SELECT count(*) AS classes FROM asset_classes;
--
--   -- the constraint now admits ASSET
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conname = ''business_partners_bp_type_check'';
--
--   -- both new tables exist and are empty
--   SELECT count(*) AS assets FROM fixed_assets;
--   SELECT count(*) AS runs FROM fixed_asset_depreciation_runs;
--
-- dep_accounts must be orgs x 13, and classes orgs x 12.
'

Write-Host ''
Write-Host 'Done. Open the file and run its SQL on Railway.' -ForegroundColor Green