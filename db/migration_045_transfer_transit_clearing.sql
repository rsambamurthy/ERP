-- One more column on stock_transfers: the THIRD journal entry a taxable
-- branch transfer needs.
--
-- This belongs with migration_044 and was missed there. It is separate rather
-- than folded in because 044 has already been applied.
--
-- WHY A THIRD ENTRY
--
-- A journal entry carries one branch_id, and a taxable transfer touches two
-- registrations that are DISTINCT PERSONS under section 25(4) — two separate
-- trial balances that must each stand up on their own. Three events, not two:
--
--   DISPATCH — sending branch
--     Dr 1304 Stock in Transit        cost
--     Dr 1305 Inter-Branch Receivable tax
--       Cr the item's stock account   cost
--       Cr Output CGST/SGST/IGST      tax
--
--   RECEIPT — receiving branch
--     Dr the item's stock account     cost
--     Dr Input CGST/SGST/IGST (ITC)   tax
--       Cr 2106 Inter-Branch Payable  cost + tax
--
--   RECEIPT — sending branch  ← THIS ENTRY
--     Dr 1305 Inter-Branch Receivable cost
--       Cr 1304 Stock in Transit      cost
--
-- The third entry is what converts the transit asset into a receivable at
-- the moment the goods land. Without it, either the sending branch keeps
-- 1304 on its books forever, or the receiving branch has to credit 1304 —
-- an account belonging to the other registration's balance sheet, which is
-- exactly the thing distinct-person treatment forbids.
--
-- With all three posted, taking 2106 as a positive credit balance:
--
--     1305 + 1304 - 2106 = invoice value of transfers dispatched
--                          but NOT YET RECEIVED
--
-- In transit:  1305 = tax,        1304 = cost, 2106 = 0          -> cost + tax
-- Received:    1305 = cost + tax, 1304 = 0,    2106 = cost + tax -> 0
--
-- Zero whenever nothing is on a lorry, and otherwise exactly what is on one.
--
-- THE UNTAXED CASE IS NOT CHANGED
--
-- A same-GSTIN transfer is one legal person with one balance sheet, and
-- migration_043's two-entry shape (receiving branch credits 1304 directly)
-- stays exactly as it is. This column is null for those, which is what the
-- CHECK below permits.
--
-- Run after migration_044_transfer_valuation.sql. Statements stand alone —
-- run them one at a time.
--
-- Idempotent: safe to re-run.


-- 1. The column.
ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS transit_clearing_journal_entry_id UUID REFERENCES journal_entries(id);


-- 2. A journal entry belongs to one transfer, in one role — the same
--    guarantee migration_043 gave the other two entries.
CREATE UNIQUE INDEX IF NOT EXISTS stock_transfers_transit_clearing_je_uq
  ON stock_transfers (transit_clearing_journal_entry_id)
  WHERE transit_clearing_journal_entry_id IS NOT NULL;


-- 3. A RECEIVED taxable transfer must have all three entries. A received
--    untaxed one must not have this one at all — a null here is not
--    "not filled in yet", it is a positive statement that this transfer
--    was between two branches of a single registration.
--
--    Dropped first because Postgres has no ADD CONSTRAINT IF NOT EXISTS,
--    and a DO block would be split by the console on its semicolons.
ALTER TABLE stock_transfers
  DROP CONSTRAINT IF EXISTS stock_transfers_transit_clearing_ck;

ALTER TABLE stock_transfers
  ADD CONSTRAINT stock_transfers_transit_clearing_ck CHECK (
    CASE
      WHEN tax_treatment <> 'TAXABLE' THEN transit_clearing_journal_entry_id IS NULL
      WHEN status = 'RECEIVED'        THEN transit_clearing_journal_entry_id IS NOT NULL
      ELSE true
    END
  );


-- Verify:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'stock_transfers'
--      AND column_name = 'transit_clearing_journal_entry_id';
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'stock_transfers_transit_clearing_ck';
--
--   SELECT count(*) FROM stock_transfers
--    WHERE transit_clearing_journal_entry_id IS NOT NULL;
--   -- expect 0 — nothing writes this until the route does
