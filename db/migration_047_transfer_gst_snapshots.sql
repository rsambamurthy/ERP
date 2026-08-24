-- GST snapshots on branch transfers — the same fix migration_031 made for
-- sales invoices, applied to the document type Phase D just introduced.
--
-- THE DEFECT
--
-- A taxable branch transfer is reported in the sending branch's GSTR-1 as a
-- B2B supply, with the RECEIVING branch as the counterparty. Everything that
-- identifies that counterparty — its GSTIN, its name, its state code, which
-- is the place of supply — lives on the branches table and is read live.
--
-- So correcting a branch's GSTIN today would silently restate every transfer
-- ever sent to it, including periods already filed with the GSTN. Changing
-- its state code is worse: the place of supply moves, and a period filed as
-- IGST can come back reading CGST+SGST.
--
-- This is not hypothetical for branches specifically. A branch's GSTIN is
-- entered by hand at setup and is exactly the sort of field that gets
-- corrected a month later, once somebody looks at the registration
-- certificate properly.
--
-- migration_031 put it plainly and it is still the rule: a tax document must
-- report the facts as they stood when it was raised.
--
-- WHY NOW RATHER THAN LATER
--
-- These columns can only be populated correctly at dispatch. Adding them
-- after real transfers exist means backfilling from today's branch masters —
-- which is precisely the wrong data, and indistinguishable from right until
-- someone re-registers. Nothing has been dispatched yet, so every row this
-- schema will ever hold can carry a true snapshot.
--
-- WHAT IS *NOT* SNAPSHOTTED, AND WHY IT DOES NOT NEED TO BE
--
-- The tax itself. stock_transfer_lines already stores taxable_value,
-- gst_rate and the CGST/SGST/IGST split as posted, so the amounts on a
-- filed return cannot drift no matter what happens to any master.
--
-- CORRECTION: an earlier version of this header also claimed the HSN was
-- "already snapshotted in effect", on the grounds that a taxable dispatch is
-- refused when the item has none. That reasoning was wrong — the exposure
-- was never a NULL HSN but a CHANGED one, and the HSN summary was in fact
-- read live from the item master. migration_048 fixes it properly.
--
-- Run after migration_046_branch_partner_control.sql. Statements stand
-- alone — run them one at a time.
--
-- Idempotent: safe to re-run.


-- 1 to 5. Sized to match branches: gstin VARCHAR(15), state_code
--    VARCHAR(2), name VARCHAR(200). All nullable, because an untaxed
--    transfer between two unregistered branches has no GSTIN to record and
--    is not reported in GSTR-1 at all.

ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS from_gstin VARCHAR(15);

ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS from_state_code VARCHAR(2);

ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS to_gstin VARCHAR(15);

ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS to_state_code VARCHAR(2);

-- The receiver name that appears on the return. A branch gets renamed far
-- more casually than it gets re-registered, so this is the likeliest of all
-- of them to drift.
ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS to_branch_name VARCHAR(200);


-- 6. A TAXABLE transfer must carry the identity it was raised against.
--    Untaxed ones may leave all of it null: they are not a supply, appear in
--    no return, and there is nothing to freeze.
--
--    Dropped first because Postgres has no ADD CONSTRAINT IF NOT EXISTS,
--    and a DO block would be split by the console on its semicolons.
ALTER TABLE stock_transfers
  DROP CONSTRAINT IF EXISTS stock_transfers_gst_snapshot_ck;

ALTER TABLE stock_transfers
  ADD CONSTRAINT stock_transfers_gst_snapshot_ck CHECK (
    tax_treatment <> 'TAXABLE'
    OR (from_gstin IS NOT NULL
        AND to_gstin IS NOT NULL
        AND to_state_code IS NOT NULL
        AND to_branch_name IS NOT NULL)
  );


-- Verify:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'stock_transfers'
--      AND column_name IN ('from_gstin','from_state_code','to_gstin',
--                          'to_state_code','to_branch_name')
--    ORDER BY column_name;
--   -- expect all five
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'stock_transfers_gst_snapshot_ck';
--
--   SELECT count(*) FROM stock_transfers WHERE tax_treatment = 'TAXABLE';
--   -- expect 0 — nothing taxable has been dispatched yet, which is why
--   -- this migration can be added without a backfill
