-- LUT/Bond export classification on Sales Invoice — only meaningful for a
-- foreign-currency (export) invoice; NULL for every domestic invoice,
-- old or new. See routes/salesInvoices.ts for the enforcement rules
-- (LUT/BOND must not carry any tax; WPAY may).

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS export_type VARCHAR(10),
  ADD COLUMN IF NOT EXISTS lut_bond_number VARCHAR(40),
  ADD COLUMN IF NOT EXISTS lut_bond_date DATE;
