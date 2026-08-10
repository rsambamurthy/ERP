-- 3-way match price tolerance + Purchase Bill approval workflow. A
-- PO-linked Purchase Bill whose rate varies from the PO by more than the
-- org's tolerance now holds at PENDING_APPROVAL (no journal entry, no
-- stock movement, no billedQuantity impact) instead of posting
-- immediately, until POST /purchase-bills/:id/approve or .../reject.
-- See ROADMAP.md's "3-Way Match & Purchase Bill Approval" section.
--
-- Run after migration_023_goods_receipt_notes.sql:
--   psql "$DATABASE_URL" -f db/migration_024_bill_approval.sql
-- No new GL accounts, no `prisma db seed` step.

-- Null (the default) means 0% tolerance — any price variance at all
-- requires approval. Same "null = most cautious" convention as
-- po_approval_threshold.
ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS price_variance_tolerance_pct DECIMAL(5, 2);

-- Every existing bill was posted immediately (this feature didn't exist
-- yet) — DEFAULT 'POSTED' backfills them correctly with no further data
-- migration needed.
ALTER TABLE purchase_bills
    ALTER COLUMN journal_entry_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'POSTED',
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(500),
    ADD COLUMN IF NOT EXISTS variance_note VARCHAR(500);

ALTER TABLE purchase_bills
    DROP CONSTRAINT IF EXISTS purchase_bills_status_check;
ALTER TABLE purchase_bills
    ADD CONSTRAINT purchase_bills_status_check
    CHECK (status IN ('POSTED', 'PENDING_APPROVAL', 'REJECTED'));

CREATE INDEX IF NOT EXISTS idx_purchase_bills_status ON purchase_bills(organization_id, status);
