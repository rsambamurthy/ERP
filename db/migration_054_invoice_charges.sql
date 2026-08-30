-- migration_054: freight, packing and insurance on a sales invoice.
--
-- These are NOT extra charges sitting beside the supply. Section 15(2)(c)
-- puts incidental expenses - packing, commission, and anything the supplier
-- does in respect of the supply at or before delivery - INSIDE the value of
-- the supply. And section 8(a) taxes a composite supply at the rate of the
-- PRINCIPAL supply.
--
-- So delivery charged on an invoice for pumps at 18% is taxed at 18%, under
-- the pumps' HSN. Not at 5% under SAC 9965. Billing it as its own line at
-- its own rate understates output tax on every invoice that carries one,
-- and it is a standard audit finding.
--
-- HOW THIS IMPLEMENTATION AVOIDS THAT. A charge is a DOCUMENT-level amount
-- that is prorated across the goods lines by value, exactly as the
-- invoice-level discount already is, and the proration lands in each line's
-- taxable value BEFORE GST is computed. So the rate follows the goods by
-- construction - there is no way to give a charge a rate of its own, because
-- it never has a rate of its own to give.
--
-- The consequence worth noticing: GSTR-1 and GSTR-3B need no change at all.
-- The charge is already inside every line's taxableValue, so Table 4A, the
-- HSN summary and 3B's outward figure all pick it up with nothing added. A
-- separate charge LINE would have needed its own SAC handling in both.
--
-- WHERE IT LANDS IN THE LEDGER. Each charge carries its own income account,
-- so freight recovered from customers can be set against freight paid rather
-- than disappearing into Sales Revenue. That is the whole reason for a table
-- rather than one more column on the invoice.
--
-- WHAT THIS IS NOT. A genuinely separate service - separately contracted,
-- not incidental to any goods - is a different thing with its own SAC and
-- its own rate, and it needs a sellable SERVICE item, which sales invoices
-- do not have yet (routes/salesInvoices.ts filters lines to itemKind STOCK).
-- That is the second half, deliberately not in here.
--
-- Statements stand alone - run them one at a time.
-- Idempotent: safe to re-run. Each insert skips what is already there.


-- 1. The charges themselves. One row per charge per invoice.
--
--    amount is what the customer is charged, exclusive of tax - the tax on
--    it is already in the lines, because that is where the proration put it.
--    Storing it here as well would be storing the same rupee twice and
--    inviting the two to disagree.
CREATE TABLE IF NOT EXISTS sales_invoice_charges (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_invoice_id UUID NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  label            VARCHAR(60) NOT NULL,
  account_id       UUID NOT NULL REFERENCES accounts(id),
  amount           NUMERIC(14,2) NOT NULL,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_invoice_charges_invoice_idx
  ON sales_invoice_charges (sales_invoice_id);


-- 2. A charge is a positive amount. A negative one is a discount, and the
--    invoice already has two ways to express that; a third, hidden inside a
--    line called "Freight", would be a way to reduce a taxable value without
--    it looking like a discount to anybody reading the document.
ALTER TABLE sales_invoice_charges
  DROP CONSTRAINT IF EXISTS sales_invoice_charges_amount_ck;

ALTER TABLE sales_invoice_charges
  ADD CONSTRAINT sales_invoice_charges_amount_ck CHECK (amount > 0);


-- 3. Templates for the three income heads, so newly provisioned
--    organisations get them. Derived from wherever 5001 Sales Revenue
--    already lives rather than naming a domain this file does not know -
--    migration_041's pattern, the same one 051 followed.
INSERT INTO coa_templates (domain_type_id, account_code, account_name, account_type, is_control_account, schedule_iii_head)
SELECT t.domain_type_id, '5002', 'Freight & Delivery Recovered', 'INCOME', false, NULL
  FROM coa_templates t
 WHERE t.account_code = '5001'
   AND NOT EXISTS (
         SELECT 1 FROM coa_templates x
          WHERE x.domain_type_id IS NOT DISTINCT FROM t.domain_type_id
            AND x.account_code = '5002');


-- 4. Packing & forwarding.
INSERT INTO coa_templates (domain_type_id, account_code, account_name, account_type, is_control_account, schedule_iii_head)
SELECT t.domain_type_id, '5003', 'Packing & Forwarding Recovered', 'INCOME', false, NULL
  FROM coa_templates t
 WHERE t.account_code = '5001'
   AND NOT EXISTS (
         SELECT 1 FROM coa_templates x
          WHERE x.domain_type_id IS NOT DISTINCT FROM t.domain_type_id
            AND x.account_code = '5003');


-- 5. Insurance.
INSERT INTO coa_templates (domain_type_id, account_code, account_name, account_type, is_control_account, schedule_iii_head)
SELECT t.domain_type_id, '5004', 'Insurance Recovered', 'INCOME', false, NULL
  FROM coa_templates t
 WHERE t.account_code = '5001'
   AND NOT EXISTS (
         SELECT 1 FROM coa_templates x
          WHERE x.domain_type_id IS NOT DISTINCT FROM t.domain_type_id
            AND x.account_code = '5004');


-- 6. And back-fill every organisation that already has 5001 - which is every
--    organisation that can raise a sales invoice at all. Unlike the equity
--    accounts in 050 this needs no decision: an income head nobody posts to
--    is inert, and an organisation that cannot separate recovered freight
--    from sales is the thing being fixed.
INSERT INTO accounts (organization_id, account_code, account_name, account_type, is_control_account, schedule_iii_head, is_system)
SELECT a.organization_id, '5002', 'Freight & Delivery Recovered', 'INCOME', false, NULL, true
  FROM accounts a
 WHERE a.account_code = '5001'
   AND NOT EXISTS (
         SELECT 1 FROM accounts x
          WHERE x.organization_id = a.organization_id
            AND x.account_code = '5002');


-- 7.
INSERT INTO accounts (organization_id, account_code, account_name, account_type, is_control_account, schedule_iii_head, is_system)
SELECT a.organization_id, '5003', 'Packing & Forwarding Recovered', 'INCOME', false, NULL, true
  FROM accounts a
 WHERE a.account_code = '5001'
   AND NOT EXISTS (
         SELECT 1 FROM accounts x
          WHERE x.organization_id = a.organization_id
            AND x.account_code = '5003');


-- 8.
INSERT INTO accounts (organization_id, account_code, account_name, account_type, is_control_account, schedule_iii_head, is_system)
SELECT a.organization_id, '5004', 'Insurance Recovered', 'INCOME', false, NULL, true
  FROM accounts a
 WHERE a.account_code = '5001'
   AND NOT EXISTS (
         SELECT 1 FROM accounts x
          WHERE x.organization_id = a.organization_id
            AND x.account_code = '5004');


-- Verify:
--   SELECT account_code, account_name FROM accounts
--   WHERE organization_id = '<org>' AND account_code IN ('5001','5002','5003','5004')
--   ORDER BY account_code;
--
--   -- Charges raised, and what they were credited to:
--   SELECT i.invoice_number, c.label, c.amount, a.account_code, a.account_name
--   FROM sales_invoice_charges c
--   JOIN sales_invoices i ON i.id = c.sales_invoice_id
--   JOIN accounts a ON a.id = c.account_id
--   ORDER BY i.invoice_date, c.sort_order;
--
--   -- The tie that matters: taxable value on the lines equals goods net of
--   -- discount PLUS the charges. If these ever differ, the proration is
--   -- wrong and the GST on the invoice is wrong with it.
--   SELECT i.invoice_number,
--          round(sum(l.taxable_value), 2)                        AS lines_taxable,
--          round(i.subtotal - i.discount_total, 2)               AS goods_net,
--          (SELECT coalesce(sum(c.amount),0) FROM sales_invoice_charges c
--            WHERE c.sales_invoice_id = i.id)                    AS charges
--   FROM sales_invoices i JOIN sales_invoice_lines l ON l.sales_invoice_id = i.id
--   GROUP BY i.id, i.invoice_number, i.subtotal, i.discount_total
--   ORDER BY i.invoice_number;
