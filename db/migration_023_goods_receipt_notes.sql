-- Goods Receipt Note (GRN): records physical receipt of goods against an
-- APPROVED Purchase Order. This is now the real stock-in event for the
-- PO-linked procurement path — Purchase Bill no longer moves stock for
-- lines that reference a GRN line (3-way match: PO -> GRN -> Bill). A
-- Purchase Bill raised without a purchaseOrderId is completely unaffected
-- and keeps moving its own stock exactly as it always has.
-- See ROADMAP.md's "Goods Receipt Note" section for the full design.
--
-- Run after migration_022_purchase_orders.sql:
--   psql "$DATABASE_URL" -f db/migration_023_goods_receipt_notes.sql
-- No new GL accounts and no `prisma db seed` step needed here either — a
-- GRN posts stock movements (StockMovement/ItemStock/StockLot), never a
-- journal entry.

-- Running total of quantity already received against this line, across
-- every GRN. Never exceeds `quantity` — enforced in
-- routes/goodsReceiptNotes.ts at GRN-post time, not by a DB constraint
-- (same convention as billed_quantity above it).
ALTER TABLE purchase_order_lines
    ADD COLUMN IF NOT EXISTS received_quantity DECIMAL(14, 4) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS goods_receipt_notes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES organizations(id),
    branch_id           UUID NOT NULL REFERENCES branches(id),
    business_partner_id UUID NOT NULL REFERENCES business_partners(id),
    purchase_order_id   UUID NOT NULL REFERENCES purchase_orders(id),
    grn_number          VARCHAR(30) NOT NULL,
    grn_date            DATE NOT NULL,
    narration           VARCHAR(255) NOT NULL DEFAULT '',
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, grn_number)
);
CREATE INDEX IF NOT EXISTS idx_grn_org ON goods_receipt_notes(organization_id);
CREATE INDEX IF NOT EXISTS idx_grn_po ON goods_receipt_notes(purchase_order_id);

CREATE TABLE IF NOT EXISTS goods_receipt_note_lines (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goods_receipt_note_id  UUID NOT NULL REFERENCES goods_receipt_notes(id),
    purchase_order_line_id UUID NOT NULL REFERENCES purchase_order_lines(id),
    item_id                UUID NOT NULL REFERENCES items(id),
    quantity_received      DECIMAL(14, 4) NOT NULL,
    -- Carried in at the PO line's own rate — see the schema.prisma comment
    -- on this column for why a GRN doesn't introduce a new price.
    unit_cost              DECIMAL(14, 2) NOT NULL,
    -- Running total already billed against this specific GRN line, across
    -- every linked Purchase Bill. Never exceeds quantity_received —
    -- enforced in routes/purchaseBills.ts at bill-post time. This is the
    -- 3-way match.
    billed_quantity        DECIMAL(14, 4) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_grn_lines_grn ON goods_receipt_note_lines(goods_receipt_note_id);
CREATE INDEX IF NOT EXISTS idx_grn_lines_po_line ON goods_receipt_note_lines(purchase_order_line_id);

-- Purchase Bill line -> GRN line link. Nullable — only ever set on a bill
-- line whose parent bill has a purchase_order_id (enforced at the route
-- level, not by a DB constraint, same convention as purchase_order_line_id
-- above it).
ALTER TABLE purchase_bill_lines
    ADD COLUMN IF NOT EXISTS goods_receipt_note_line_id UUID REFERENCES goods_receipt_note_lines(id);

CREATE INDEX IF NOT EXISTS idx_purchase_bill_lines_grn_line ON purchase_bill_lines(goods_receipt_note_line_id) WHERE goods_receipt_note_line_id IS NOT NULL;
