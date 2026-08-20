-- Prepaid expenses and straight-line amortization.
--
-- An expense paid up front — an annual insurance policy, a 12-month AMC, a
-- software licence — is not an expense of the month it was paid. It is an
-- asset that becomes an expense a slice at a time. Today SmartERP has no way
-- to say that: a SERVICE item on a Purchase Bill debits its expense head in
-- full, so a year of insurance lands entirely in one month's P&L.
--
-- This adds the missing middle. A bill line marked prepaid debits
-- Prepaid Expenses (1105) instead of the item's expense head, and creates a
-- schedule that releases the amount to that expense head one month at a time.
--
-- What is deliberately NOT spread: input tax credit. ITC attaches to the tax
-- invoice date, so the whole CGST/SGST/IGST is claimed in the month the bill
-- is booked and GSTR-3B never sees the amortization entries at all. Only the
-- net amount is scheduled.
--
-- 1105 is a control account. Each schedule gets its own sub-ledger card in
-- business_partners (bp_type = 'PREPAID'), exactly as every item gets one
-- under Inventory (1201) — see routes/items.ts. That is what makes the GL
-- balance of Prepaid Expenses provable line by line without leaving the
-- ledger: the bill debits the card for the full amount, each amortization
-- credits it, and a finished schedule is one whose card nets to zero.
--
-- Run after migration_031_gst_snapshots.sql:
--   psql "$DATABASE_URL" -f db/migration_032_prepaid_expenses.sql
--
-- Idempotent: safe to re-run.

-- ── 1a. The COA template ────────────────────────────────────────────────
-- Accounts are not created directly: lib/provisioning.ts copies coa_templates
-- into accounts when an organization is provisioned. So a new account has to
-- be added in two places — the template, for organizations provisioned from
-- now on, and the accounts table, for the ones that already exist.
--
-- domain_type_id IS NULL means "core chart of accounts, every domain" — the
-- same convention seed.ts uses for Cash, Bank and the GST accounts. Code 1105
-- continues the 11xx current-asset block that holds GST input credit (1101–04).

INSERT INTO coa_templates (
  id, domain_type_id, account_code, account_name,
  account_type, is_control_account, default_bp_type, schedule_iii_head
)
SELECT
  gen_random_uuid(), NULL, '1105', 'Prepaid Expenses',
  'ASSET', true, 'PREPAID', 'OTHER_CURRENT_ASSETS'
WHERE NOT EXISTS (
  SELECT 1 FROM coa_templates t
  WHERE t.domain_type_id IS NULL AND t.account_code = '1105'
);

-- ── 1b. The account, for organizations that already exist ───────────────
-- is_system = true to match lib/provisioning.ts, which sets it on every
-- templated account. Without it 1105 would be the single account in the core
-- chart that routes/accounts.ts allows a user to rename or delete.

INSERT INTO accounts (
  id, organization_id, account_code, account_name,
  account_type, is_group, is_control_account, default_bp_type,
  schedule_iii_head, is_system, is_active
)
SELECT
  gen_random_uuid(), o.id, '1105', 'Prepaid Expenses',
  'ASSET', false, true, 'PREPAID',
  'OTHER_CURRENT_ASSETS', true, true
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a
  WHERE a.organization_id = o.id AND a.account_code = '1105'
);

-- ── 2. The schedules ────────────────────────────────────────────────────
-- purchase_bill_id / purchase_bill_line_id are nullable so a schedule can
-- later be created for an opening balance — a prepayment that predates
-- SmartERP and has no bill in the system. Nothing creates one that way yet.
--
-- expense_account_id is a snapshot, not a live read of the item's account.
-- Same reasoning as migration_031: re-pointing a service item at a different
-- expense head should change what future bills do, not silently redirect the
-- remaining instalments of a schedule that is already half-released.

CREATE TABLE IF NOT EXISTS prepaid_schedules (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID NOT NULL REFERENCES organizations(id),
  branch_id              UUID REFERENCES branches(id),
  purchase_bill_id       UUID REFERENCES purchase_bills(id),
  purchase_bill_line_id  UUID REFERENCES purchase_bill_lines(id),
  -- This schedule's sub-ledger card under 1105.
  business_partner_id    UUID NOT NULL REFERENCES business_partners(id),
  name                   VARCHAR(200) NOT NULL,
  prepaid_account_id     UUID NOT NULL REFERENCES accounts(id),
  expense_account_id     UUID NOT NULL REFERENCES accounts(id),
  -- Net of GST.
  total_amount           NUMERIC(14,2) NOT NULL,
  -- Always the first of the month, like recurring_expenses.start_month.
  start_month            DATE NOT NULL,
  months                 INTEGER NOT NULL,
  status                 VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
  -- Set when a schedule is cancelled before it finished; the remaining
  -- balance is written off to expense_account_id in that month.
  cancelled_at           TIMESTAMP,
  cancelled_by           UUID REFERENCES users(id),
  created_by             UUID REFERENCES users(id),
  created_at             TIMESTAMP NOT NULL DEFAULT now(),
  deleted_at             TIMESTAMP,
  CONSTRAINT prepaid_schedules_months_ck  CHECK (months >= 1 AND months <= 600),
  CONSTRAINT prepaid_schedules_amount_ck  CHECK (total_amount > 0),
  CONSTRAINT prepaid_schedules_status_ck  CHECK (status IN ('ACTIVE','COMPLETED','CANCELLED')),
  CONSTRAINT prepaid_schedules_start_ck   CHECK (date_trunc('month', start_month) = start_month)
);

CREATE INDEX IF NOT EXISTS prepaid_schedules_org_status_idx
  ON prepaid_schedules (organization_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS prepaid_schedules_bill_idx
  ON prepaid_schedules (purchase_bill_id);

-- One schedule per bill line. A line either is prepaid or isn't.
CREATE UNIQUE INDEX IF NOT EXISTS prepaid_schedules_line_uq
  ON prepaid_schedules (purchase_bill_line_id)
  WHERE purchase_bill_line_id IS NOT NULL;

-- ── 3. The instalments actually posted ──────────────────────────────────
-- The UNIQUE on (prepaid_schedule_id, period_month) is the idempotency
-- guard, and it is load-bearing rather than decorative: two accountants
-- clicking Post at the same moment means the second INSERT raises a unique
-- violation and rolls its whole transaction back — including the journal
-- entry it had already written — instead of releasing the same instalment
-- twice. Identical to recurring_expense_runs in migration_030.

CREATE TABLE IF NOT EXISTS prepaid_schedule_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prepaid_schedule_id  UUID NOT NULL REFERENCES prepaid_schedules(id),
  -- First of the month being released.
  period_month         DATE NOT NULL,
  -- 1-based, so instalment_no = months is the final, balancing one.
  instalment_no        INTEGER NOT NULL,
  amount               NUMERIC(14,2) NOT NULL,
  journal_entry_id     UUID NOT NULL REFERENCES journal_entries(id),
  -- WRITE_OFF marks the single entry that clears the remaining balance when
  -- a schedule is cancelled early; AMORTIZATION is the normal monthly slice.
  run_type             VARCHAR(14) NOT NULL DEFAULT 'AMORTIZATION',
  generated_by         UUID REFERENCES users(id),
  generated_at         TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT prepaid_schedule_runs_uq UNIQUE (prepaid_schedule_id, period_month),
  CONSTRAINT prepaid_schedule_runs_type_ck CHECK (run_type IN ('AMORTIZATION','WRITE_OFF')),
  CONSTRAINT prepaid_schedule_runs_month_ck CHECK (date_trunc('month', period_month) = period_month)
);

CREATE INDEX IF NOT EXISTS prepaid_schedule_runs_period_idx
  ON prepaid_schedule_runs (period_month);

-- ── Verification ────────────────────────────────────────────────────────
-- Every organization should now have exactly one 1105, flagged as a control
-- account for the PREPAID sub-ledger:
--
--   SELECT count(*) FROM organizations;
--   SELECT count(*) FROM accounts
--     WHERE account_code = '1105' AND is_control_account AND default_bp_type = 'PREPAID';
--
-- Those two numbers must match. And both new tables should exist and be empty:
--
--   SELECT count(*) FROM prepaid_schedules;
--   SELECT count(*) FROM prepaid_schedule_runs;
