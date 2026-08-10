-- Sales Order workflow (the sales-side mirror of migration_022's Purchase
-- Order): Draft -> Submit -> (auto-approve under threshold, or Pending
-- Approval) -> Approve/Reject -> Delivery Note (physical dispatch, moves
-- stock) -> Sales Invoice (with qty tracking against the Delivery Note,
-- 3-way match: SO -> DN -> Invoice). See ROADMAP.md's "Sales Order
-- Workflow" and "Delivery Note" sections for the full design.
--
-- Run after migration_024_bill_approval.sql:
--   psql "$DATABASE_URL" -f db/migration_025_sales_orders.sql
-- No new GL accounts and no `prisma db seed` step needed — a Sales Order
-- never posts to the journal, and a Delivery Note posts stock movements
-- (StockMovement/ItemStock/StockLot) only, never a journal entry — same as
-- PurchaseOrder/GoodsReceiptNote.

-- Org-level setting: a submitted SO whose grand_total is strictly below
-- this amount auto-approves instead of requiring a human approval. NULL
-- (the default) means "always require manual approval" — same "null =
-- most cautious" convention as po_approval_threshold.
ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS so_approval_threshold DECIMAL(14, 2);

CREATE TABLE IF NOT EXISTS sales_orders (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id        UUID NOT NULL REFERENCES organizations(id),
    branch_id              UUID REFERENCES branches(id),
    business_partner_id    UUID NOT NULL REFERENCES business_partners(id),
    so_number              VARCHAR(30) NOT NULL,
    so_date                DATE NOT NULL,
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
    UNIQUE (organization_id, so_number)
);
CREATE INDEX IF NOT EXISTS idx_sales_orders_org ON sales_orders(organization_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_customer ON sales_orders(business_partner_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON sales_orders(organization_id, status);

CREATE TABLE IF NOT EXISTS sales_order_lines (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sales_order_id UUID NOT NULL REFERENCES sales_orders(id),
    item_id        UUID NOT NULL REFERENCES items(id),
    quantity       DECIMAL(14, 4) NOT NULL,
    rate           DECIMAL(14, 2) NOT NULL,
    tax_rate       DECIMAL(5, 2) NOT NULL,
    line_subtotal  DECIMAL(14, 2) NOT NULL,
    tax_amount     DECIMAL(14, 2) NOT NULL,
    line_total     DECIMAL(14, 2) NOT NULL,
    -- Running total already dispatched against this line, across every
    -- Delivery Note. Never exceeds `quantity` — enforced in
    -- routes/deliveryNotes.ts at delivery-note-post time, not by a DB
    -- constraint (same convention as every other qty/amount invariant in
    -- this app).
    delivered_quantity DECIMAL(14, 4) NOT NULL DEFAULT 0,
    -- Running total already invoiced against this line, across every
    -- linked Sales Invoice. Never exceeds `quantity` — enforced in
    -- routes/salesInvoices.ts at invoice-post time.
    billed_quantity    DECIMAL(14, 4) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sales_order_lines_so ON sales_order_lines(sales_order_id);

CREATE TABLE IF NOT EXISTS delivery_notes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES organizations(id),
    branch_id           UUID NOT NULL REFERENCES branches(id),
    business_partner_id UUID NOT NULL REFERENCES business_partners(id),
    sales_order_id      UUID NOT NULL REFERENCES sales_orders(id),
    dn_number           VARCHAR(30) NOT NULL,
    dn_date             DATE NOT NULL,
    narration           VARCHAR(255) NOT NULL DEFAULT '',
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, dn_number)
);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_org ON delivery_notes(organization_id);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_so ON delivery_notes(sales_order_id);

CREATE TABLE IF NOT EXISTS delivery_note_lines (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_note_id    UUID NOT NULL REFERENCES delivery_notes(id),
    sales_order_line_id UUID NOT NULL REFERENCES sales_order_lines(id),
    item_id             UUID NOT NULL REFERENCES items(id),
    quantity_delivered  DECIMAL(14, 4) NOT NULL,
    -- Carried in at the SO line's own selling rate — see the
    -- schema.prisma comment on this column; descriptive only.
    rate                DECIMAL(14, 2) NOT NULL,
    -- The actual blended cost consumeStock returned when this note posted
    -- — see the schema.prisma comment; reused by the eventual SO-linked
    -- Sales Invoice's COGS journal line instead of re-consuming stock.
    unit_cost           DECIMAL(14, 4) NOT NULL,
    -- Running total already invoiced against this specific Delivery Note
    -- line, across every linked Sales Invoice. Never exceeds
    -- quantity_delivered — enforced in routes/salesInvoices.ts at
    -- invoice-post time. This is the 3-way match.
    billed_quantity     DECIMAL(14, 4) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_dn_lines_dn ON delivery_note_lines(delivery_note_id);
CREATE INDEX IF NOT EXISTS idx_dn_lines_so_line ON delivery_note_lines(sales_order_line_id);

-- Sales Invoice <-> Sales Order link — both nullable, since most invoices
-- still won't originate from an SO.
ALTER TABLE sales_invoices
    ADD COLUMN IF NOT EXISTS sales_order_id UUID REFERENCES sales_orders(id);

ALTER TABLE sales_invoice_lines
    ADD COLUMN IF NOT EXISTS sales_order_line_id UUID REFERENCES sales_order_lines(id),
    ADD COLUMN IF NOT EXISTS delivery_note_line_id UUID REFERENCES delivery_note_lines(id);

CREATE INDEX IF NOT EXISTS idx_sales_invoices_so ON sales_invoices(sales_order_id) WHERE sales_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_so_line ON sales_invoice_lines(sales_order_line_id) WHERE sales_order_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_dn_line ON sales_invoice_lines(delivery_note_line_id) WHERE delivery_note_line_id IS NOT NULL;
