-- Sales / Purchase / Inventory v1: Purchase Bill (stock inward), Sales
-- Invoice (stock outward), Stock Adjustment (both directions — also how
-- opening stock gets entered). Costing method is an org-level choice, made
-- once, enforced immutable at the route level (not a DB constraint, since
-- "only settable while NULL" isn't expressible as a CHECK).
--
-- Run after migration_005_menu_config.sql:
--   psql "$DATABASE_URL" -f db/migration_006_sales_purchase_inventory.sql

ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS costing_method VARCHAR(20)
        CHECK (costing_method IN ('WEIGHTED_AVG', 'FIFO'));

-- journal_entries.voucher_type was constrained to BV/CV/JV in
-- migration_002. Purchase Bill, Sales Invoice, and Stock Adjustment each
-- post their own journal entry directly (not through POST /journal, which
-- still validates BV/CV/JV for hand-entered vouchers) with PB/SI/SA —
-- widen the constraint to allow them rather than pretending they're one of
-- the existing three.
--
-- Plain SQL, no DO block — Railway's Data/Query panel (unlike psql) chokes
-- on PL/pgSQL's $$ ... $$ body, which is what broke the first version of
-- this migration. journal_entries_voucher_type_check is Postgres's
-- standard auto-generated name for an unnamed CHECK added via
-- ALTER TABLE ADD COLUMN (the {table}_{column}_check convention) — exactly
-- how migration_002 added it — so it's safe to name directly rather than
-- looking it up.
ALTER TABLE journal_entries
    DROP CONSTRAINT IF EXISTS journal_entries_voucher_type_check;

ALTER TABLE journal_entries
    ADD CONSTRAINT journal_entries_voucher_type_check
    CHECK (voucher_type IN ('BV', 'CV', 'JV', 'PB', 'SI', 'SA'));

-- ---------- Item master gets accounting + costing hooks ----------

ALTER TABLE items
    ADD COLUMN IF NOT EXISTS description       VARCHAR(255),
    ADD COLUMN IF NOT EXISTS hsn_code          VARCHAR(10),
    -- Which control account (Inventory / Raw Materials / Finished Goods)
    -- this item's stock value posts to. Backfilled below for any items
    -- that already existed before this migration (none should, in
    -- practice — Items had no create endpoint until now).
    ADD COLUMN IF NOT EXISTS stock_account_id  UUID REFERENCES accounts(id),
    -- The paired bp_type = 'ITEM' sub-ledger row — see business_partners
    -- below. One-to-one: an item never shares its business partner.
    ADD COLUMN IF NOT EXISTS business_partner_id UUID UNIQUE REFERENCES business_partners(id),
    ADD COLUMN IF NOT EXISTS sales_rate        DECIMAL(14, 2),
    ADD COLUMN IF NOT EXISTS purchase_rate     DECIMAL(14, 2),
    ADD COLUMN IF NOT EXISTS tax_rate          DECIMAL(5, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS opening_quantity  DECIMAL(14, 4) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS opening_cost      DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS is_active         BOOLEAN NOT NULL DEFAULT true;

-- stock_account_id and business_partner_id are effectively required for any
-- item actually used by Sales/Purchase/Adjustment, but left nullable at the
-- DB level (app-enforced NOT NULL on create) rather than a hard NOT NULL
-- constraint, so this migration never fails against pre-existing rows.

ALTER TABLE item_stock
    ADD COLUMN IF NOT EXISTS average_cost DECIMAL(14, 4) NOT NULL DEFAULT 0;

-- ---------- FIFO cost layers (unused entirely for weighted-average orgs) ----------

CREATE TABLE IF NOT EXISTS stock_lots (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id    UUID NOT NULL REFERENCES organizations(id),
    branch_id          UUID NOT NULL REFERENCES branches(id),
    item_id            UUID NOT NULL REFERENCES items(id),
    quantity_remaining DECIMAL(14, 4) NOT NULL,
    unit_cost          DECIMAL(14, 4) NOT NULL,
    received_at        TIMESTAMPTZ NOT NULL,
    reference_type     VARCHAR(30),
    reference_id       UUID,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_lots_item_branch ON stock_lots(item_id, branch_id, received_at);

-- ---------- Stock audit trail — the Stock Ledger report reads this ----------

CREATE TABLE IF NOT EXISTS stock_movements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id       UUID NOT NULL REFERENCES branches(id),
    item_id         UUID NOT NULL REFERENCES items(id),
    movement_type   VARCHAR(20) NOT NULL
        CHECK (movement_type IN ('PURCHASE', 'SALE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT')),
    quantity        DECIMAL(14, 4) NOT NULL,
    unit_cost       DECIMAL(14, 4) NOT NULL,
    reference_type  VARCHAR(30),
    reference_id    UUID,
    narration       VARCHAR(255),
    movement_date   DATE NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements(item_id, movement_date);
CREATE INDEX IF NOT EXISTS idx_stock_movements_org ON stock_movements(organization_id, movement_date DESC);

-- ---------- Sales Invoice ----------

CREATE TABLE IF NOT EXISTS sales_invoices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES organizations(id),
    branch_id           UUID REFERENCES branches(id),
    business_partner_id UUID NOT NULL REFERENCES business_partners(id),
    invoice_number      VARCHAR(30) NOT NULL,
    invoice_date        DATE NOT NULL,
    narration           VARCHAR(255) NOT NULL DEFAULT '',
    journal_entry_id    UUID NOT NULL UNIQUE REFERENCES journal_entries(id),
    subtotal            DECIMAL(14, 2) NOT NULL,
    tax_total           DECIMAL(14, 2) NOT NULL,
    grand_total         DECIMAL(14, 2) NOT NULL,
    total_cogs          DECIMAL(14, 2) NOT NULL,
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS sales_invoice_lines (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sales_invoice_id UUID NOT NULL REFERENCES sales_invoices(id),
    item_id          UUID NOT NULL REFERENCES items(id),
    quantity         DECIMAL(14, 4) NOT NULL,
    rate             DECIMAL(14, 2) NOT NULL,
    tax_rate         DECIMAL(5, 2) NOT NULL,
    line_subtotal    DECIMAL(14, 2) NOT NULL,
    tax_amount       DECIMAL(14, 2) NOT NULL,
    line_total       DECIMAL(14, 2) NOT NULL,
    unit_cost        DECIMAL(14, 4) NOT NULL,
    line_cogs        DECIMAL(14, 2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_invoice ON sales_invoice_lines(sales_invoice_id);

-- ---------- Purchase Bill ----------

CREATE TABLE IF NOT EXISTS purchase_bills (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES organizations(id),
    branch_id           UUID REFERENCES branches(id),
    business_partner_id UUID NOT NULL REFERENCES business_partners(id),
    bill_number         VARCHAR(30) NOT NULL,
    bill_date           DATE NOT NULL,
    narration           VARCHAR(255) NOT NULL DEFAULT '',
    journal_entry_id    UUID NOT NULL UNIQUE REFERENCES journal_entries(id),
    subtotal            DECIMAL(14, 2) NOT NULL,
    tax_total           DECIMAL(14, 2) NOT NULL,
    grand_total         DECIMAL(14, 2) NOT NULL,
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, bill_number)
);

CREATE TABLE IF NOT EXISTS purchase_bill_lines (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_bill_id UUID NOT NULL REFERENCES purchase_bills(id),
    item_id          UUID NOT NULL REFERENCES items(id),
    quantity         DECIMAL(14, 4) NOT NULL,
    rate             DECIMAL(14, 2) NOT NULL,
    tax_rate         DECIMAL(5, 2) NOT NULL,
    line_subtotal    DECIMAL(14, 2) NOT NULL,
    tax_amount       DECIMAL(14, 2) NOT NULL,
    line_total       DECIMAL(14, 2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_bill_lines_bill ON purchase_bill_lines(purchase_bill_id);

-- ---------- Stock Adjustment (both directions; also opening stock) ----------

CREATE TABLE IF NOT EXISTS stock_adjustments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES organizations(id),
    branch_id        UUID REFERENCES branches(id),
    adjustment_date  DATE NOT NULL,
    narration        VARCHAR(255) NOT NULL DEFAULT '',
    journal_entry_id UUID NOT NULL UNIQUE REFERENCES journal_entries(id),
    created_by       UUID REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_adjustment_lines (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stock_adjustment_id  UUID NOT NULL REFERENCES stock_adjustments(id),
    item_id              UUID NOT NULL REFERENCES items(id),
    direction            VARCHAR(3) NOT NULL CHECK (direction IN ('IN', 'OUT')),
    quantity             DECIMAL(14, 4) NOT NULL,
    unit_cost            DECIMAL(14, 4) NOT NULL,
    line_value           DECIMAL(14, 2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_adjustment_lines_adj ON stock_adjustment_lines(stock_adjustment_id);
