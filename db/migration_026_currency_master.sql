-- Currency Master: effective-dated FX rates. The currency code/symbol/name
-- list itself stays the small hardcoded array in
-- backend/src/lib/currencies.ts (display metadata only) — this table is
-- what's actually new: per-org, per-currency, per-effective-date "1 unit =
-- X INR" rows, any number of them per currency code. See ROADMAP.md's
-- "Currency Master" section for the full design.
--
-- Run after migration_025_sales_orders.sql:
--   psql "$DATABASE_URL" -f db/migration_026_currency_master.sql
-- No new GL accounts, no `prisma db seed` step — this table is never
-- posted to, never a foreign-key target (Sales Invoice / Purchase Bill
-- still snapshot their own exchange_rate value directly, same as before
-- this feature existed). Purely a lookup a create-invoice/bill form can
-- query to pre-fill that field.

CREATE TABLE IF NOT EXISTS currency_rates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    currency_code   VARCHAR(3) NOT NULL,
    effective_from  DATE NOT NULL,
    rate            DECIMAL(14, 6) NOT NULL,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, currency_code, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_currency_rates_org ON currency_rates(organization_id);
-- The lookup query (routes/currencyRates.ts GET /lookup) is exactly:
-- WHERE organization_id = ? AND currency_code = ? AND effective_from <= ?
-- ORDER BY effective_from DESC LIMIT 1 — this composite index covers it.
CREATE INDEX IF NOT EXISTS idx_currency_rates_lookup ON currency_rates(organization_id, currency_code, effective_from DESC);
