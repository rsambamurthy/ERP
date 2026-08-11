-- Foreign-currency support on Purchase Order / Sales Order — exact mirror
-- of migration_018_foreign_currency.sql's Purchase Bill/Sales Invoice
-- columns. `rate` on each line stays the authoritative INR figure
-- (computed as round2(rate_fc * exchange_rate)) either way, so nothing
-- downstream (Goods Receipt Note's unitCost sourcing, Delivery Note's
-- descriptive rate, stock valuation) needs to change — see ROADMAP.md's
-- "Purchase/Sales Order Foreign Currency" section for the full design.
--
-- Run after migration_026_currency_master.sql:
--   psql "$DATABASE_URL" -f db/migration_027_po_so_currency.sql
-- No new GL accounts, no `prisma db seed` step — a PO/SO never posts to
-- the journal either way.

ALTER TABLE purchase_orders
    ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(12, 6) NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS grand_total_fc DECIMAL(14, 2);

ALTER TABLE purchase_order_lines
    ADD COLUMN IF NOT EXISTS rate_fc DECIMAL(14, 4),
    ADD COLUMN IF NOT EXISTS line_total_fc DECIMAL(14, 2);

ALTER TABLE sales_orders
    ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(12, 6) NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS grand_total_fc DECIMAL(14, 2);

ALTER TABLE sales_order_lines
    ADD COLUMN IF NOT EXISTS rate_fc DECIMAL(14, 4),
    ADD COLUMN IF NOT EXISTS line_total_fc DECIMAL(14, 2);
