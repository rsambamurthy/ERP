-- migration_052: a cancelled branch transfer needs a credit note, not silence.
--
-- Cancelling a TAXABLE stock transfer reverses the ledger completely, and that
-- part has always been right. What it does not do is undo the INVOICE. A tax
-- invoice was issued, numbered out of a consecutive series, and reported - or
-- about to be reported - as an outward supply. Section 34(1) says an invoice
-- in that position is undone by a CREDIT NOTE, which is itself a numbered
-- document that goes in Table 9B of the return for the month it is issued.
--
-- Until now SmartERP raised none. computeGstr1 surfaced the problem honestly
-- in its cancelledTransfers list - "this invoice number needs manual
-- treatment" - which is better than hiding it and worse than doing it.
--
-- TWO COLUMNS, on the transfer itself
--
-- One cancellation produces exactly one credit note, and a cancellation is
-- terminal: the status guard in /cancel means it cannot happen twice. So the
-- note belongs on the transfer row beside document_number, which already
-- holds the invoice it reverses, rather than in a table of its own.
--
--   credit_note_number  CN-nnnn, counted per organisation inside the
--                       cancellation transaction. The same scheme
--                       SalesReturn.return_number already uses, and that
--                       number is already what GSTR-1 files as a credit note
--                       for a sales return - so this follows a precedent in
--                       your own code rather than inventing a second one.
--
--   credit_note_date    when the note was issued, which is the cancellation
--                       date. It is a SEPARATE date from transfer_date on
--                       purpose: the supply falls in one period and the note
--                       may fall in the next, and the two returns have to be
--                       able to say so.
--
-- Both are NULL for every transfer that is not a cancelled taxable one, and
-- NULL for cancellations that happened before this migration. Those older
-- rows keep appearing in the cancelledTransfers list, which is correct - they
-- still need a note raising by hand, and nothing here can invent one.
--
-- Statements stand alone - run them one at a time.
-- Idempotent: safe to re-run.


-- 1. The number.
ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS credit_note_number VARCHAR(30);


-- 2. The date it was issued.
ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS credit_note_date DATE;


-- 3. Unique per organisation, and only where one exists. A partial index
--    rather than a plain unique constraint: the overwhelming majority of
--    transfers have no credit note at all, and NULLs do not collide in
--    Postgres but there is no reason to index a column that is null on
--    almost every row.
CREATE UNIQUE INDEX IF NOT EXISTS stock_transfers_credit_note_uq
  ON stock_transfers (organization_id, credit_note_number)
  WHERE credit_note_number IS NOT NULL;


-- 4. Both together or neither. A number with no date could not be placed in
--    a return period, and a date with no number is not a document.
ALTER TABLE stock_transfers
  DROP CONSTRAINT IF EXISTS stock_transfers_credit_note_ck;

ALTER TABLE stock_transfers
  ADD CONSTRAINT stock_transfers_credit_note_ck
  CHECK ((credit_note_number IS NULL) = (credit_note_date IS NULL));


-- 5. A credit note only ever undoes an issued invoice. Belt and braces
--    against a future code path numbering a note for an untaxed challan,
--    which has no invoice to undo and belongs in no return.
ALTER TABLE stock_transfers
  DROP CONSTRAINT IF EXISTS stock_transfers_credit_note_needs_invoice_ck;

ALTER TABLE stock_transfers
  ADD CONSTRAINT stock_transfers_credit_note_needs_invoice_ck
  CHECK (credit_note_number IS NULL
         OR (tax_treatment = 'TAXABLE' AND document_number IS NOT NULL
             AND status = 'CANCELLED'));


-- Verify:
--   SELECT transfer_number, document_number, credit_note_number,
--          credit_note_date, status, tax_treatment
--   FROM stock_transfers
--   WHERE status = 'CANCELLED' AND tax_treatment = 'TAXABLE'
--   ORDER BY transfer_date;
--
--   -- Cancelled taxable transfers still owing a note by hand:
--   SELECT count(*) FROM stock_transfers
--   WHERE status = 'CANCELLED' AND tax_treatment = 'TAXABLE'
--     AND document_number IS NOT NULL AND credit_note_number IS NULL;
