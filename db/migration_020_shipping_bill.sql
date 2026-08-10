-- Shipping bill (exports) / bill of entry (imports) reference fields.
-- All nullable — these documents are almost always generated after the
-- Sales Invoice / Purchase Bill is already posted, so they're captured via
-- a later PATCH (see routes/salesInvoices.ts, routes/purchaseBills.ts)
-- rather than required at creation time. NULL for every domestic
-- (INR) document, old or new.

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS shipping_bill_number VARCHAR(30),
  ADD COLUMN IF NOT EXISTS shipping_bill_date DATE,
  ADD COLUMN IF NOT EXISTS port_code VARCHAR(10);

ALTER TABLE purchase_bills
  ADD COLUMN IF NOT EXISTS bill_of_entry_number VARCHAR(30),
  ADD COLUMN IF NOT EXISTS bill_of_entry_date DATE,
  ADD COLUMN IF NOT EXISTS port_code VARCHAR(10);
