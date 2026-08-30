-- migration_053: selling stock you have not got, on purpose rather than by
-- accident.
--
-- consumeStock() refuses when the branch holds less than the line asks for,
-- and that refusal is correct for almost everything: a stock adjustment, a
-- branch transfer, a production issue and a delivery note are all movements
-- of goods that either exist or do not. A SALES INVOICE is different. By the
-- time it is raised somebody has usually already promised the customer, and
-- the shortfall is often a bookkeeping lag - the goods arrived, the purchase
-- bill has not been entered yet - rather than an empty shelf.
--
-- So the invoice gets an override. TWO LOCKS, and both have to be open:
--
--   1. organizations.allow_negative_stock  the organisation permits it at
--      all. Off by default, and off for every organisation that exists
--      today, so nothing changes for anybody until somebody decides it
--      should.
--
--   2. the invoice asks for it, explicitly, with a reason. Stored on the
--      invoice in negative_stock_reason - not a flag, a sentence, because
--      "why did this go negative" is the question somebody asks three months
--      later and a boolean cannot answer it.
--
-- Neither lock alone is enough. An organisation with the setting on still
-- refuses every ordinary invoice; an invoice that asks for the override in
-- an organisation that has not enabled it is refused with a message saying
-- so.
--
-- WHAT IT COSTS, stated plainly because somebody has to decide whether to
-- turn it on:
--
--   * COGS on that invoice is posted at the CURRENT weighted average,
--     including the part of the quantity the branch did not hold. When the
--     real purchase lands at a different rate, the margin already posted is
--     wrong and nothing goes back to fix it.
--
--   * The item's stock account goes into CREDIT for as long as the balance
--     is negative. An inventory control account with a credit balance shows
--     as a negative asset on a Schedule III balance sheet. AS 2 does not
--     contemplate negative inventory, and an auditor will ask.
--
-- FIFO IS REFUSED EVEN WITH BOTH LOCKS OPEN. Weighted average always has an
-- answer to "at what cost did this leave" - the stored average. FIFO's
-- answer is a lot, and for the shortfall no lot exists. See lib/costing.ts.
--
-- Statements stand alone - run them one at a time.
-- Idempotent: safe to re-run.


-- 1. The organisation-level permission. NOT NULL DEFAULT false, so every
--    existing organisation is explicitly opted out rather than left null and
--    ambiguous - a nullable flag would make "nobody has decided" and "no"
--    look the same to the code that reads it.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS allow_negative_stock BOOLEAN NOT NULL DEFAULT false;


-- 2. Why this invoice was allowed to go negative. NULL on every invoice that
--    did not use the override, which also makes it the filter: WHERE
--    negative_stock_reason IS NOT NULL is the list of every invoice that
--    ever did.
ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS negative_stock_reason VARCHAR(200);


-- Verify:
--   SELECT name, allow_negative_stock FROM organizations ORDER BY created_at;
--
--   -- Every invoice raised against stock that was not there:
--   SELECT invoice_number, invoice_date, negative_stock_reason
--   FROM sales_invoices
--   WHERE negative_stock_reason IS NOT NULL
--   ORDER BY invoice_date;
--
--   -- The balances those invoices left behind. This is the list somebody
--   -- has to clear, and it should normally be empty:
--   SELECT i.sku, i.name, b.name AS branch, s.quantity_on_hand, s.average_cost
--   FROM item_stock s
--   JOIN items i ON i.id = s.item_id
--   JOIN branches b ON b.id = s.branch_id
--   WHERE s.quantity_on_hand < 0
--   ORDER BY i.sku;
