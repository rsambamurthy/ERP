-- Discount (Sales Invoice, line + invoice level) and CGST/SGST/IGST GST
-- split (Sales Invoice + Purchase Bill). See ROADMAP.md's "Discount + GST
-- Split (built)" section for the full design writeup.
--
-- Run after migration_013_branch_crud.sql:
--   psql "$DATABASE_URL" -f db/migration_014_discount_gst.sql
-- Then re-seed so the new GL accounts below become available to sync:
--   npx prisma db seed
--   (existing orgs then pull them in via Chart of Accounts → Sync from Templates)

-- ---------- Item: default discount %, seeds the line when picked (editable) ----------

ALTER TABLE items
    ADD COLUMN IF NOT EXISTS default_discount_pct DECIMAL(5, 2) NOT NULL DEFAULT 0;

-- ---------- Branch / Business Partner: GST state code ----------
-- Two-digit GST state code (e.g. "29" = Karnataka). Auto-filled by parsing
-- the first 2 characters when a GSTIN is entered, but independently
-- settable — a location/party can have a state without having a GSTIN
-- (unregistered branch, B2C customer). Comparing branch.state_code against
-- the counterparty's state_code is what decides CGST+SGST (same state) vs
-- IGST (different state) at posting time. If either side's state_code is
-- unset, Sales Invoice / Purchase Bill fall back to CGST+SGST (documented
-- assumption — see routes/salesInvoices.ts / purchaseBills.ts) rather than
-- blocking posting.

ALTER TABLE branches
    ADD COLUMN IF NOT EXISTS state_code VARCHAR(2);

ALTER TABLE business_partners
    ADD COLUMN IF NOT EXISTS state_code VARCHAR(2);

-- ---------- Sales Invoice: header-level discount + GST split totals ----------

ALTER TABLE sales_invoices
    ADD COLUMN IF NOT EXISTS discount_type  VARCHAR(10) CHECK (discount_type IN ('PERCENT', 'FLAT')),
    ADD COLUMN IF NOT EXISTS discount_value DECIMAL(14, 2) NOT NULL DEFAULT 0,
    -- Total discount actually applied (line-level discounts + this
    -- invoice-level discount's prorated share) — a stored figure, not
    -- recomputed from discount_value, since it also folds in every line's
    -- own discount.
    ADD COLUMN IF NOT EXISTS discount_total DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cgst_total     DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sgst_total     DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS igst_total     DECIMAL(14, 2) NOT NULL DEFAULT 0;

ALTER TABLE sales_invoice_lines
    -- This line's own discount, before the invoice-level discount is
    -- prorated in. Type/value as entered; line_discount_amount is the
    -- computed ₹ figure either way.
    ADD COLUMN IF NOT EXISTS discount_type          VARCHAR(10) CHECK (discount_type IN ('PERCENT', 'FLAT')),
    ADD COLUMN IF NOT EXISTS discount_value          DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS line_discount_amount     DECIMAL(14, 2) NOT NULL DEFAULT 0,
    -- This line's proportional share of the invoice-level discount,
    -- prorated by its value after its own line discount — see
    -- routes/salesInvoices.ts for the exact algorithm.
    ADD COLUMN IF NOT EXISTS invoice_discount_share   DECIMAL(14, 2) NOT NULL DEFAULT 0,
    -- (qty * rate) - line_discount_amount - invoice_discount_share — what
    -- GST is actually computed on.
    ADD COLUMN IF NOT EXISTS taxable_value            DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cgst_amount              DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sgst_amount              DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS igst_amount              DECIMAL(14, 2) NOT NULL DEFAULT 0;

-- ---------- Purchase Bill: GST split totals only (no discount — see ROADMAP) ----------

ALTER TABLE purchase_bills
    ADD COLUMN IF NOT EXISTS cgst_total DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sgst_total DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS igst_total DECIMAL(14, 2) NOT NULL DEFAULT 0;

ALTER TABLE purchase_bill_lines
    ADD COLUMN IF NOT EXISTS cgst_amount DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sgst_amount DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS igst_amount DECIMAL(14, 2) NOT NULL DEFAULT 0;
