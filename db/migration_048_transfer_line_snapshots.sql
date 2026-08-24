-- Line-level GST snapshots on branch transfers.
--
-- migration_047 froze WHO the counterparty was. This freezes WHAT was
-- supplied, which is the other half of the same defect and which
-- migration_047's own header got wrong.
--
-- WHAT 047 CLAIMED, AND WHY IT WAS WRONG
--
-- It said the HSN "is likewise already snapshotted in effect", reasoning
-- that a taxable dispatch is refused when the item has no HSN, so the
-- column cannot be null at report time. That is true and beside the point.
-- The exposure was never a NULL HSN — it was a CHANGED one.
--
-- lib/gstReports.ts builds the HSN summary for a transfer from
-- items.hsn_code, items.name and items.uom, read live. Correct a pump's HSN
-- from 8413 to 8414 in September and August's filed GSTR-1 re-runs reporting
-- that taxable value under 8414. sales_invoice_lines snapshots all three
-- columns for exactly this reason (migration_031); stock_transfer_lines did
-- not, so the one document type migration_047 was written about was the one
-- still exposed.
--
-- WHY THE TAX FIGURES WERE NEVER AT RISK
--
-- taxable_value, gst_rate and the CGST/SGST/IGST split are already stored on
-- the line as posted. Only the CLASSIFICATION — which HSN the value is
-- reported under, and the description and unit beside it — came from the
-- master.
--
-- Nothing has been dispatched yet, so every row this schema will ever hold
-- can carry a true snapshot rather than a backfill from today's masters.
--
-- Run after migration_047_transfer_gst_snapshots.sql. Statements stand
-- alone — run them one at a time.
--
-- Idempotent: safe to re-run.


-- 1 to 3. Sized to match items: hsn_code VARCHAR(10), name VARCHAR(200),
--    uom VARCHAR(20). Nullable, because an untaxed transfer appears in no
--    return and has nothing to freeze.

ALTER TABLE stock_transfer_lines
  ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(10);

ALTER TABLE stock_transfer_lines
  ADD COLUMN IF NOT EXISTS item_name VARCHAR(200);

ALTER TABLE stock_transfer_lines
  ADD COLUMN IF NOT EXISTS uom VARCHAR(20);


-- Deliberately NO CHECK constraint tying these to tax_treatment.
--
-- The obvious one — "a taxable line must have an HSN" — would have to reach
-- across to stock_transfers.tax_treatment, and a CHECK cannot see another
-- table. A trigger could, but a trigger that fires on every transfer line to
-- restate a rule the route already enforces (a taxable dispatch is refused
-- outright when an item has no HSN) buys nothing and hides the enforcement
-- somewhere nobody reading the route will look.


-- Verify:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'stock_transfer_lines'
--      AND column_name IN ('hsn_code','item_name','uom')
--    ORDER BY column_name;
--   -- expect all three
--
--   SELECT count(*) FROM stock_transfer_lines;
--   -- expect 0 — nothing dispatched yet, which is why no backfill is needed
