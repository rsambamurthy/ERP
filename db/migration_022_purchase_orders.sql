-- Purchase Order workflow: Draft -> Submit -> (auto-approve under threshold,
-- or Pending Approval) -> Approve/Reject -> Bill (with qty tracking).
-- See ROADMAP.md's "Purchase Order Workflow" section for the full design.
--
-- Run after migration_021_customs_duty.sql:
--   psql "$DATABASE_URL" -f db/migration_022_purchase_orders.sql
-- Then re-seed is NOT needed for this migration (no new GL accounts — a
-- Purchase Order never posts to the journal).

-- Org-level setting: a submitted PO whose grand_total is strictly below
-- this amount auto-approves instead of requiring a human approval. NULL
-- (the default) means "always require manual approval" — the safe default
-- until an org explicitly configures a threshold.
ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS po_approval_threshold DECIMAL(14, 2);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id        UUID NOT NULL REFERENCES organizations(id),
    branch_id              UUID REFERENCES branches(id),
    business_partner_id    UUID NOT NULL REFERENCES business_partners(id),
    po_number              VARCHAR(30) NOT NULL,
    po_date                DATE NOT NULL,
    expected_delivery_date DATE,
    narration              VARCHAR(255) NOT NULL DEFAULT '',
    status                 VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED', 'CLOSED')),
    subtotal               DECIMAL(14, 2) NOT NULL DEFAULT 0,
    tax_total               DECIMAL(14, 2) NOT NULL DEFAULT 0,
    grand_total             DECIMAL(14, 2) NOT NULL DEFAULT 0,
    submitted_by            UUID REFERENCES users(id),
    submitted_at            TIMESTAMPTZ,
    approved_by             UUID REFERENCES users(id),
    approved_at             TIMESTAMPTZ,
    auto_approved           BOOLEAN NOT NULL DEFAULT false,
    rejected_by             UUID REFERENCES users(id),
    rejected_at             TIMESTAMPTZ,
    rejection_reason        VARCHAR(500),
    cancelled_by            UUID REFERENCES users(id),
    cancelled_at            TIMESTAMPTZ,
    created_by              UUID REFERENCES users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, po_number)
);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_org ON purchase_orders(organization_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor ON purchase_orders(business_partner_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(organization_id, status);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id),
    item_id           UUID NOT NULL REFERENCES items(id),
    quantity          DECIMAL(14, 4) NOT NULL,
    rate              DECIMAL(14, 2) NOT NULL,
    tax_rate          DECIMAL(5, 2) NOT NULL,
    line_subtotal     DECIMAL(14, 2) NOT NULL,
    tax_amount        DECIMAL(14, 2) NOT NULL,
    line_total        DECIMAL(14, 2) NOT NULL,
    -- Running total already billed against this line, across every linked
    -- Purchase Bill. Never exceeds `quantity` — enforced in
    -- routes/purchaseBills.ts at bill-post time, not by a DB constraint
    -- (same convention as every other qty/amount invariant in this app).
    billed_quantity   DECIMAL(14, 4) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_po ON purchase_order_lines(purchase_order_id);

-- Purchase Bill <-> Purchase Order link — both nullable, since most bills
-- still won't originate from a PO (this app had no PO concept until now).
ALTER TABLE purchase_bills
    ADD COLUMN IF NOT EXISTS purchase_order_id UUID REFERENCES purchase_orders(id);

ALTER TABLE purchase_bill_lines
    ADD COLUMN IF NOT EXISTS purchase_order_line_id UUID REFERENCES purchase_order_lines(id);

CREATE INDEX IF NOT EXISTS idx_purchase_bills_po ON purchase_bills(purchase_order_id) WHERE purchase_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_bill_lines_po_line ON purchase_bill_lines(purchase_order_line_id) WHERE purchase_order_line_id IS NOT NULL;
