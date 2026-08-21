-- migration_033: allow bp_type = 'PREPAID' on business_partners
--
-- migration_032 gave account 1105 Prepaid Expenses a sub-ledger: one card per
-- schedule, so the Prepaid Expenses balance breaks down schedule by schedule
-- the same way Inventory breaks down item by item. Those cards are
-- business_partners rows with bp_type = 'PREPAID'.
--
-- What migration_032 missed is that business_partners.bp_type carries a CHECK
-- constraint from the original schema:
--
--     bp_type VARCHAR(20) NOT NULL CHECK (bp_type IN ('CUSTOMER','VENDOR','ITEM'))
--
-- Prisma models that column as a plain String, so nothing in the application
-- layer knew the constraint existed. Posting a bill with a prepaid line
-- therefore failed at the database with 23514 —
-- "violates check constraint business_partners_bp_type_check" — and, because
-- the card is created inside the same transaction as the bill, the whole bill
-- rolled back. No partial data was written; the bill simply could not post.
--
-- Idempotent: safe to run more than once.

BEGIN;

ALTER TABLE business_partners
  DROP CONSTRAINT IF EXISTS business_partners_bp_type_check;

ALTER TABLE business_partners
  ADD CONSTRAINT business_partners_bp_type_check
  CHECK (bp_type IN ('CUSTOMER', 'VENDOR', 'ITEM', 'PREPAID'));

COMMIT;

-- NOTE for whoever builds depreciation: the fixed-asset design gives each
-- asset its own card under the asset-cost and accumulated-depreciation
-- control accounts, with bp_type = 'ASSET'. That value is deliberately NOT
-- added here — a constraint that permits values nothing can create misstates
-- what the table holds. The depreciation migration must extend this same
-- constraint again, exactly as this one does.

-- Verify:
--   SELECT pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conname = 'business_partners_bp_type_check';
--   -- expect: CHECK (bp_type::text = ANY (ARRAY['CUSTOMER'::..., 'VENDOR'::...,
--   --          'ITEM'::..., 'PREPAID'::...]))
