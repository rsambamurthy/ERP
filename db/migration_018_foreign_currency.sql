-- Foreign currency support on Sales Invoices (exports) and Purchase Bills
-- (imports). Every existing row already has an implicit currency of INR and
-- exchange rate of 1, so the DEFAULTs below make old rows correct without
-- any backfill — the *_fc columns stay NULL for them (not applicable).
--
-- currency/exchange_rate are NOT NULL (every invoice/bill has *some*
-- currency, even if it's always been INR); the *_fc columns are nullable
-- display-only convenience figures — INR remains the sole figure GST/
-- accounting/reports rely on (see lib/currencies.ts and
-- routes/salesInvoices.ts / purchaseBills.ts for why).

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(12, 6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS grand_total_fc DECIMAL(14, 2);

ALTER TABLE sales_invoice_lines
  ADD COLUMN IF NOT EXISTS rate_fc DECIMAL(14, 4),
  ADD COLUMN IF NOT EXISTS line_total_fc DECIMAL(14, 2);

ALTER TABLE purchase_bills
  ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(12, 6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS grand_total_fc DECIMAL(14, 2);

ALTER TABLE purchase_bill_lines
  ADD COLUMN IF NOT EXISTS rate_fc DECIMAL(14, 4),
  ADD COLUMN IF NOT EXISTS line_total_fc DECIMAL(14, 2);
