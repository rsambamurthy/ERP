-- migration_049: a returned asset is not a disposed one.
--
-- A capitalised purchase bill line can be sent back to the vendor. That is a
-- RESCISSION of the purchase, not a sale: the asset never really belonged to
-- the company, the depreciation charged against it was charged in error, and
-- both are reversed. Filing it as DISPOSED would show an auditor reading the
-- disposals schedule a disposal that never happened, and would put a
-- fictitious gain in the P&L equal to the depreciation already taken.
--
-- So the status gets its own value. fixed_assets_status_ck is the only thing
-- that has to change; every read path that excludes DISPOSED already excludes
-- anything that is not ACTIVE.

ALTER TABLE fixed_assets
  DROP CONSTRAINT IF EXISTS fixed_assets_status_ck;

ALTER TABLE fixed_assets
  ADD CONSTRAINT fixed_assets_status_ck
  CHECK (status IN ('ACTIVE', 'FULLY_DEPRECIATED', 'DISPOSED', 'RETURNED'));

-- Verify:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conname = 'fixed_assets_status_ck';
