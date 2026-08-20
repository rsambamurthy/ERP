-- Recurring Expenses (Phase 2 — configuration only).
--
-- A template describing an expense that repeats monthly: which vendor, which
-- service items, what amount, which day. Nothing here posts anything. Phase 3
-- adds the due list and the generate step that turns a template into a real
-- Purchase Bill.
--
-- Purchase Bill rather than Journal Entry is deliberate: lib/gstReports.ts
-- sources GSTR-3B's ITC exclusively from purchase_bills, so a JV-based
-- recurring expense would silently forfeit input credit on rent, telecom and
-- professional fees. That's what migration_029's SERVICE items exist for.
--
-- Run after migration_029_service_items.sql:
--   psql "$DATABASE_URL" -f db/migration_030_recurring_expenses.sql

CREATE TABLE IF NOT EXISTS recurring_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID REFERENCES branches(id),
    name VARCHAR(200) NOT NULL,
    business_partner_id UUID NOT NULL REFERENCES business_partners(id),
    -- Capped at 28 on purpose. Allowing 29-31 means deciding what "the 31st
    -- of February" is, and every system that allows it grows a clamping rule
    -- nobody remembers. A genuine month-end schedule is a later feature with
    -- an explicit flag, not an ambiguous number.
    day_of_month SMALLINT NOT NULL DEFAULT 1,
    -- Both pinned to the 1st of their month. A DATE sorts, ranges and
    -- compares natively where a year/month integer pair does not.
    start_month DATE NOT NULL,
    end_month DATE,
    -- FIXED  — lines carry a rate; the due screen pre-fills it.
    -- PROMPTED — rate is entered each month (electricity, usage-based telecom).
    amount_mode VARCHAR(10) NOT NULL DEFAULT 'FIXED',
    narration VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id),
    deleted_at TIMESTAMPTZ
);

ALTER TABLE recurring_expenses DROP CONSTRAINT IF EXISTS recurring_expenses_day_check;
ALTER TABLE recurring_expenses
    ADD CONSTRAINT recurring_expenses_day_check CHECK (day_of_month BETWEEN 1 AND 28);

ALTER TABLE recurring_expenses DROP CONSTRAINT IF EXISTS recurring_expenses_amount_mode_check;
ALTER TABLE recurring_expenses
    ADD CONSTRAINT recurring_expenses_amount_mode_check CHECK (amount_mode IN ('FIXED', 'PROMPTED'));

CREATE INDEX IF NOT EXISTS idx_recurring_expenses_org
    ON recurring_expenses(organization_id, is_active);

CREATE TABLE IF NOT EXISTS recurring_expense_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recurring_expense_id UUID NOT NULL REFERENCES recurring_expenses(id),
    -- A SERVICE item (migration_029). The API rejects a STOCK one: a
    -- recurring rent template pointing at an inventory item would post to a
    -- stock account and try to receive goods that never arrive.
    item_id UUID NOT NULL REFERENCES items(id),
    quantity NUMERIC(14,3) NOT NULL DEFAULT 1,
    -- Null is legal only when the parent is PROMPTED.
    rate NUMERIC(14,2),
    tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
    sort_order SMALLINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_recurring_expense_lines_parent
    ON recurring_expense_lines(recurring_expense_id);

-- One generated bill per template per month. The unique index below is what
-- makes Phase 3's Post button idempotent: a double click, two accountants
-- clicking at once, or a retry after a network blip all collide here rather
-- than double-booking a payable.
CREATE TABLE IF NOT EXISTS recurring_expense_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recurring_expense_id UUID NOT NULL REFERENCES recurring_expenses(id),
    period_month DATE NOT NULL,
    purchase_bill_id UUID NOT NULL REFERENCES purchase_bills(id),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    generated_by UUID REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_recurring_expense_run
    ON recurring_expense_runs(recurring_expense_id, period_month);