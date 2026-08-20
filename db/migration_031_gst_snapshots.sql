-- GST snapshots — stop filed returns from rewriting themselves.
--
-- lib/gstReports.ts builds GSTR-1 and GSTR-3B by reading master data live:
--
--   * B2B / B2C   -> business_partners.gstin, .name, .state_code
--   * HSN Summary -> items.hsn_code, .name, .uom
--   * Credit Notes and both return types in 3B -> the partner's state code,
--     because neither return line table ever stored its own CGST/SGST/IGST
--     split; it was recomputed on every read.
--
-- So correcting a customer's GSTIN today silently restates every invoice
-- ever raised to them, including periods already filed with the GSTN.
-- Changing a partner's state code is worse: invoices migrate between B2B
-- and B2C, place of supply moves, and the intra/inter-state split flips —
-- turning CGST+SGST into IGST on returns that were filed the other way.
--
-- A tax document must report the facts as they stood when it was raised.
-- These columns capture those facts at posting time. The pattern already
-- exists in this schema: sales_invoice_lines.unit_cost is snapshotted the
-- same way, for the same reason.
--
-- Run after migration_030_recurring_expenses.sql:
--   psql "$DATABASE_URL" -f db/migration_031_gst_snapshots.sql

-- ── 1. Party identity on the documents that appear in GSTR-1 ────────────
-- Sized to match business_partners: gstin VARCHAR(15), name VARCHAR(200),
-- state_code VARCHAR(2). Nullable because a B2C customer legitimately has
-- no GSTIN, and older organisations may have partners with no state code.

ALTER TABLE sales_invoices
    ADD COLUMN IF NOT EXISTS party_gstin      VARCHAR(15),
    ADD COLUMN IF NOT EXISTS party_name       VARCHAR(200),
    ADD COLUMN IF NOT EXISTS party_state_code VARCHAR(2);

ALTER TABLE sales_returns
    ADD COLUMN IF NOT EXISTS party_gstin      VARCHAR(15),
    ADD COLUMN IF NOT EXISTS party_name       VARCHAR(200),
    ADD COLUMN IF NOT EXISTS party_state_code VARCHAR(2);

-- ── 2. Item identity on invoice lines, for the HSN summary ──────────────
-- Sized to match items: hsn_code VARCHAR(10), name VARCHAR(200),
-- uom VARCHAR(20).

ALTER TABLE sales_invoice_lines
    ADD COLUMN IF NOT EXISTS hsn_code  VARCHAR(10),
    ADD COLUMN IF NOT EXISTS item_name VARCHAR(200),
    ADD COLUMN IF NOT EXISTS uom       VARCHAR(20);

-- ── 3. The tax split on return lines ────────────────────────────────────
-- Same Decimal(14,2) shape the invoice lines already use. DEFAULT 0 so the
-- columns are non-null from the start and the reports never have to guard
-- for a missing split.

ALTER TABLE sales_return_lines
    ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS igst_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE purchase_return_lines
    ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS igst_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

-- ── 4. Backfill ─────────────────────────────────────────────────────────
-- Existing rows get today's master values. That is not the same as what was
-- true when they were raised — if a partner has already been edited, the
-- damage predates this migration and is not recoverable from the data we
-- have. It is still strictly better than recomputing forever: from here on
-- the figures are pinned and stop drifting.
--
-- WHERE party_name IS NULL keeps this idempotent, so re-running the file
-- cannot overwrite a snapshot taken later at posting time.

UPDATE sales_invoices si
   SET party_gstin      = bp.gstin,
       party_name       = bp.name,
       party_state_code = bp.state_code
  FROM business_partners bp
 WHERE bp.id = si.business_partner_id
   AND si.party_name IS NULL;

UPDATE sales_returns sr
   SET party_gstin      = bp.gstin,
       party_name       = bp.name,
       party_state_code = bp.state_code
  FROM business_partners bp
 WHERE bp.id = sr.business_partner_id
   AND sr.party_name IS NULL;

UPDATE sales_invoice_lines sil
   SET hsn_code  = i.hsn_code,
       item_name = i.name,
       uom       = i.uom
  FROM items i
 WHERE i.id = sil.item_id
   AND sil.item_name IS NULL;

-- Return splits: intra-state (branch state = partner state, or either
-- unknown) halves the tax into CGST + SGST with the remainder going to
-- CGST; inter-state puts all of it in IGST. This mirrors splitGst() in
-- lib/discountGst.ts exactly — round2(tax/2) for CGST, tax - CGST for SGST,
-- so the two always re-add to the original figure with no rounding drift.
--
-- Only touches rows still sitting at the 0/0/0 default AND carrying tax,
-- so a genuinely zero-rated line is left alone and a re-run is a no-op.

UPDATE sales_return_lines srl
   SET cgst_amount = CASE WHEN inter THEN 0 ELSE ROUND(srl.tax_amount / 2, 2) END,
       sgst_amount = CASE WHEN inter THEN 0 ELSE srl.tax_amount - ROUND(srl.tax_amount / 2, 2) END,
       igst_amount = CASE WHEN inter THEN srl.tax_amount ELSE 0 END
  FROM (
        SELECT sr.id AS return_id,
               (b.state_code IS NOT NULL
                AND bp.state_code IS NOT NULL
                AND b.state_code <> bp.state_code) AS inter
          FROM sales_returns sr
          JOIN business_partners bp ON bp.id = sr.business_partner_id
          LEFT JOIN branches b      ON b.id  = sr.branch_id
       ) x
 WHERE x.return_id = srl.sales_return_id
   AND srl.tax_amount <> 0
   AND srl.cgst_amount = 0
   AND srl.sgst_amount = 0
   AND srl.igst_amount = 0;

UPDATE purchase_return_lines prl
   SET cgst_amount = CASE WHEN inter THEN 0 ELSE ROUND(prl.tax_amount / 2, 2) END,
       sgst_amount = CASE WHEN inter THEN 0 ELSE prl.tax_amount - ROUND(prl.tax_amount / 2, 2) END,
       igst_amount = CASE WHEN inter THEN prl.tax_amount ELSE 0 END
  FROM (
        SELECT pr.id AS return_id,
               (b.state_code IS NOT NULL
                AND bp.state_code IS NOT NULL
                AND b.state_code <> bp.state_code) AS inter
          FROM purchase_returns pr
          JOIN business_partners bp ON bp.id = pr.business_partner_id
          LEFT JOIN branches b      ON b.id  = pr.branch_id
       ) x
 WHERE x.return_id = prl.purchase_return_id
   AND prl.tax_amount <> 0
   AND prl.cgst_amount = 0
   AND prl.sgst_amount = 0
   AND prl.igst_amount = 0;

-- Verification — every count should be 0.
--
--   SELECT count(*) FROM sales_invoices        WHERE party_name IS NULL;
--   SELECT count(*) FROM sales_returns         WHERE party_name IS NULL;
--   SELECT count(*) FROM sales_invoice_lines   WHERE item_name  IS NULL;
--   SELECT count(*) FROM sales_return_lines
--     WHERE tax_amount <> 0 AND cgst_amount = 0 AND sgst_amount = 0 AND igst_amount = 0;
--   SELECT count(*) FROM purchase_return_lines
--     WHERE tax_amount <> 0 AND cgst_amount = 0 AND sgst_amount = 0 AND igst_amount = 0;
