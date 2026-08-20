-- Service items (Recurring Expenses, Phase 1).
--
-- Purchase Bill lines debit their item's stock account and write a stock
-- movement, so there has never been a correct way to book a GST-bearing
-- expense — rent, telecom, professional fees. Booking one through a Journal
-- Entry gets the ledger right but loses the input credit, because
-- lib/gstReports.ts sources GSTR-3B's ITC exclusively from purchase_bills.
--
-- A SERVICE item is the same record with two differences: it debits an
-- EXPENSE account rather than a stock control account, and no stock movement
-- is written for it. Everything else — GST input split, Trade Payables, the
-- vendor sub-ledger, the ITC aggregate — is untouched.
--
-- Run after migration_028_vendor_management.sql:
--   psql "$DATABASE_URL" -f db/migration_029_service_items.sql

-- DEFAULT 'STOCK' backfills every existing item as what it already is, so
-- nothing that works today changes behaviour.
ALTER TABLE items
    ADD COLUMN IF NOT EXISTS item_kind VARCHAR(10) NOT NULL DEFAULT 'STOCK';

ALTER TABLE items DROP CONSTRAINT IF EXISTS items_item_kind_check;
ALTER TABLE items
    ADD CONSTRAINT items_item_kind_check CHECK (item_kind IN ('STOCK', 'SERVICE'));

-- The pickers and every stock-touching route filter on this, so it is worth
-- an index even though item counts are modest.
CREATE INDEX IF NOT EXISTS idx_items_org_kind ON items(organization_id, item_kind);

-- NOTE: stock_account_id is deliberately reused rather than renamed. For a
-- SERVICE item it holds the EXPENSE account the line debits. Renaming it
-- would touch every existing row, query and report for no functional gain —
-- see the column comment in schema.prisma.
COMMENT ON COLUMN items.stock_account_id IS
    'Account this item posts against: a stock control account for item_kind=STOCK, an EXPENSE account for item_kind=SERVICE.';