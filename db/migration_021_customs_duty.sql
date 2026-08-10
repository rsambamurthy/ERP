-- Import-side customs duty (Basic Customs Duty) + correcting import IGST to
-- be computed on (goods value + duty) instead of goods value alone. See
-- ROADMAP.md's "Customs Duty / Import IGST as ITC (built)" section.
--
-- Design: BCD is non-creditable and folds straight into landed inventory
-- cost. Import IGST IS creditable (ITC) but must be computed on the correct
-- base. Neither duty nor import IGST is actually owed to the foreign
-- vendor, so both credit a new "Customs Duty Payable" account (2105)
-- instead of Trade Payables — Trade Payables on an import bill reflects
-- only the goods value. See routes/purchaseBills.ts for the posting split.
--
-- Run after migration_020_shipping_bill.sql:
--   psql "$DATABASE_URL" -f db/migration_021_customs_duty.sql
-- Then re-seed so the new "Customs Duty Payable" GL account becomes
-- available to sync:
--   npx prisma db seed
--   (existing orgs then pull it in via Chart of Accounts → Sync from Templates)

ALTER TABLE purchase_bills
    ADD COLUMN IF NOT EXISTS customs_duty_total DECIMAL(14, 2) NOT NULL DEFAULT 0;

ALTER TABLE purchase_bill_lines
    -- Entered as a % of this line's INR taxable value (goods value only,
    -- before duty) — null/0 on a domestic bill.
    ADD COLUMN IF NOT EXISTS customs_duty_rate   DECIMAL(5, 2),
    ADD COLUMN IF NOT EXISTS customs_duty_amount DECIMAL(14, 2) NOT NULL DEFAULT 0;
