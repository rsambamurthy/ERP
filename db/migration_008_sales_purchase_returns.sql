-- Sales Return (Credit Note) and Purchase Return (Debit Note) — each always
-- tied to the original Sales Invoice / Purchase Bill (never freeform), so a
-- line can never return more than (invoiced qty - already returned qty).
-- Sales Return lines carry a GOOD/DAMAGED condition: GOOD re-enters
-- sellable stock, DAMAGED reverses the sale but writes the cost off to
-- Inventory Adjustments instead, with no stock movement at all. Purchase
-- Return has no condition split — stock is leaving to the vendor either way.
--
-- Plain SQL, no DO block — see migration_006's note: Railway's Data/Query
-- panel can't parse PL/pgSQL's $$ ... $$ body. Both CHECK constraint names
-- below are Postgres's standard auto-generated names for an unnamed CHECK
-- (the {table}_{column}_check convention), exactly how migration_002 and
-- migration_006 added them — safe to name directly.

ALTER TABLE journal_entries
    DROP CONSTRAINT IF EXISTS journal_entries_voucher_type_check;

ALTER TABLE journal_entries
    ADD CONSTRAINT journal_entries_voucher_type_check
    CHECK (voucher_type IN ('BV', 'CV', 'JV', 'PB', 'SI', 'SA', 'SR', 'PR'));

ALTER TABLE stock_movements
    DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;

ALTER TABLE stock_movements
    ADD CONSTRAINT stock_movements_movement_type_check
    CHECK (movement_type IN ('PURCHASE', 'SALE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'SALES_RETURN_IN', 'PURCHASE_RETURN_OUT'));

-- ---------- Sales Return (Credit Note) ----------

CREATE TABLE IF NOT EXISTS sales_returns (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id       UUID NOT NULL REFERENCES organizations(id),
    branch_id             UUID REFERENCES branches(id),
    sales_invoice_id      UUID NOT NULL REFERENCES sales_invoices(id),
    business_partner_id   UUID NOT NULL REFERENCES business_partners(id),
    return_number         VARCHAR(30) NOT NULL,
    return_date           DATE NOT NULL,
    narration             VARCHAR(255) NOT NULL DEFAULT '',
    journal_entry_id      UUID NOT NULL UNIQUE REFERENCES journal_entries(id),
    subtotal              DECIMAL(14, 2) NOT NULL,
    tax_total              DECIMAL(14, 2) NOT NULL,
    grand_total            DECIMAL(14, 2) NOT NULL,
    total_cogs_reversed    DECIMAL(14, 2) NOT NULL,
    created_by            UUID REFERENCES users(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, return_number)
);

CREATE TABLE IF NOT EXISTS sales_return_lines (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sales_return_id        UUID NOT NULL REFERENCES sales_returns(id),
    sales_invoice_line_id  UUID NOT NULL REFERENCES sales_invoice_lines(id),
    item_id                UUID NOT NULL REFERENCES items(id),
    quantity               DECIMAL(14, 4) NOT NULL,
    condition              VARCHAR(10) NOT NULL CHECK (condition IN ('GOOD', 'DAMAGED')),
    rate                   DECIMAL(14, 2) NOT NULL,
    tax_rate               DECIMAL(5, 2) NOT NULL,
    line_subtotal          DECIMAL(14, 2) NOT NULL,
    tax_amount             DECIMAL(14, 2) NOT NULL,
    line_total             DECIMAL(14, 2) NOT NULL,
    unit_cost              DECIMAL(14, 4) NOT NULL,
    line_cogs_reversed     DECIMAL(14, 2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_return_lines_return ON sales_return_lines(sales_return_id);
CREATE INDEX IF NOT EXISTS idx_sales_return_lines_invoice_line ON sales_return_lines(sales_invoice_line_id);

-- ---------- Purchase Return (Debit Note) ----------

CREATE TABLE IF NOT EXISTS purchase_returns (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id       UUID NOT NULL REFERENCES organizations(id),
    branch_id             UUID REFERENCES branches(id),
    purchase_bill_id      UUID NOT NULL REFERENCES purchase_bills(id),
    business_partner_id   UUID NOT NULL REFERENCES business_partners(id),
    return_number         VARCHAR(30) NOT NULL,
    return_date           DATE NOT NULL,
    narration             VARCHAR(255) NOT NULL DEFAULT '',
    journal_entry_id      UUID NOT NULL UNIQUE REFERENCES journal_entries(id),
    subtotal              DECIMAL(14, 2) NOT NULL,
    tax_total             DECIMAL(14, 2) NOT NULL,
    grand_total           DECIMAL(14, 2) NOT NULL,
    created_by            UUID REFERENCES users(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, return_number)
);

CREATE TABLE IF NOT EXISTS purchase_return_lines (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_return_id     UUID NOT NULL REFERENCES purchase_returns(id),
    purchase_bill_line_id  UUID NOT NULL REFERENCES purchase_bill_lines(id),
    item_id                UUID NOT NULL REFERENCES items(id),
    quantity               DECIMAL(14, 4) NOT NULL,
    rate                   DECIMAL(14, 2) NOT NULL,
    tax_rate               DECIMAL(5, 2) NOT NULL,
    line_subtotal          DECIMAL(14, 2) NOT NULL,
    tax_amount             DECIMAL(14, 2) NOT NULL,
    line_total             DECIMAL(14, 2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_return_lines_return ON purchase_return_lines(purchase_return_id);
CREATE INDEX IF NOT EXISTS idx_purchase_return_lines_bill_line ON purchase_return_lines(purchase_bill_line_id);
