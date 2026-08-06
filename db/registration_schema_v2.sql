-- ============================================================
-- Registration & Domain Provisioning Schema  (rev. 2)
-- New standalone MSME ERP project.
--
-- Revision 2 changes, per product decisions:
--   1. An org can hold MULTIPLE domains at once (Trading + Manufacturing).
--      domain_type_id on organizations is replaced by org_domains (M:N).
--   2. Domain set is editable only until the org's first transaction.
--      organizations.domain_locked_at is set automatically (trigger below)
--      the moment a journal_entry is posted; org_domains becomes read-only
--      after that.
--   3. Building Association is NOT part of this schema. It stays on
--      SmartAppt's existing unit-based schema as a separate product.
--   4. Trading/Manufacturing orgs have branches. GSTIN moves from
--      organizations to branches (GST registration is state-wise in
--      India). journal_entries and stock gain branch scoping.
--
-- Reused from SmartAppt (structure only — this project gets its own
-- instances of these tables, same shape):
--   journal_entries(id, organization_id, ...)          -- + branch_id (new)
--   journal_lines(id, journal_entry_id, account_id, business_partner_id, debit, credit, ...)
--   business_partners(id, organization_id, bp_type_id, ref_id, name, ...)
-- bp_type is generalized from SmartAppt's unit-only anchor to
-- CUSTOMER / VENDOR / ITEM.
-- ============================================================

-- ---------- Domain configuration ----------

CREATE TABLE domain_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(30) UNIQUE NOT NULL,        -- TRADING, MANUFACTURING only — Building Association is a separate product
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(30) UNIQUE NOT NULL,        -- INVENTORY, BOM, SALES, PURCHASE, ACCOUNTING
    name VARCHAR(100) NOT NULL
);

CREATE TABLE domain_modules (
    domain_type_id UUID NOT NULL REFERENCES domain_types(id),
    module_id UUID NOT NULL REFERENCES modules(id),
    is_default BOOLEAN NOT NULL DEFAULT true,
    PRIMARY KEY (domain_type_id, module_id)
);

-- coa_templates.domain_type_id is nullable: NULL rows are the "core" set
-- (cash, bank, trade receivables/payables, admin expense) applied to every
-- org regardless of which domain(s) it picks. This avoids account_code
-- collisions when an org has both Trading and Manufacturing enabled —
-- provisioning applies core once, then each selected domain's overlay.
CREATE TABLE coa_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_type_id UUID REFERENCES domain_types(id),   -- NULL = core/shared
    account_code VARCHAR(10) NOT NULL,
    account_name VARCHAR(100) NOT NULL,
    account_type VARCHAR(20) NOT NULL,       -- ASSET, LIABILITY, EQUITY, INCOME, EXPENSE
    is_control_account BOOLEAN NOT NULL DEFAULT false,
    default_bp_type VARCHAR(20),             -- CUSTOMER, VENDOR, ITEM -- null if not a control account
    UNIQUE (domain_type_id, account_code)
);

-- ---------- Tenancy & registration ----------

CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING_VERIFICATION',
        -- PENDING_VERIFICATION -> PENDING_DOMAIN -> PENDING_PROVISION -> ACTIVE
    domain_locked_at TIMESTAMPTZ,            -- set on first journal_entry; org_domains frozen after this
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- Which domain(s) an org operates in. Multi-row per org is expected
-- (e.g. Trading + Manufacturing). Editable only pre-transaction — see
-- trg_lock_org_domains below.
CREATE TABLE org_domains (
    organization_id UUID NOT NULL REFERENCES organizations(id),
    domain_type_id UUID NOT NULL REFERENCES domain_types(id),
    domain_details JSONB,                    -- business_type/industry_type, has_bom, categories...
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, domain_type_id)
);

-- One row per physical/registered location. The first branch (head office)
-- is auto-created during provisioning from the registration address/GSTIN.
CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    code VARCHAR(20) NOT NULL,
    name VARCHAR(200) NOT NULL,
    gstin VARCHAR(15),                       -- state-wise GST registration; distinct per branch
    address JSONB,
    is_head_office BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (organization_id, code)
);

-- The org's actual chart of accounts, instantiated from coa_templates at
-- provisioning. journal_lines.account_id points here (not at the template).
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    account_code VARCHAR(10) NOT NULL,
    account_name VARCHAR(100) NOT NULL,
    account_type VARCHAR(20) NOT NULL,
    is_control_account BOOLEAN NOT NULL DEFAULT false,
    default_bp_type VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (organization_id, account_code)
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(20) UNIQUE,
    password_hash TEXT NOT NULL,
    is_verified BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE TABLE org_users (
    organization_id UUID NOT NULL REFERENCES organizations(id),
    user_id UUID NOT NULL REFERENCES users(id),
    role VARCHAR(20) NOT NULL DEFAULT 'OWNER',   -- OWNER, STAFF
    branch_id UUID REFERENCES branches(id),      -- NULL = access to all branches (typical for OWNER)
    PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE onboarding_state (
    organization_id UUID PRIMARY KEY REFERENCES organizations(id),
    step VARCHAR(20) NOT NULL DEFAULT 'SIGNUP',
        -- SIGNUP -> VERIFIED -> DOMAIN_SELECTED -> PROVISIONED
    otp_code VARCHAR(10),
    otp_expires_at TIMESTAMPTZ,
    provisioned_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE org_modules (
    organization_id UUID NOT NULL REFERENCES organizations(id),
    module_id UUID NOT NULL REFERENCES modules(id),
    enabled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, module_id)
);

-- ---------- Domain-specific master data ----------

CREATE TABLE items (                         -- Trading + Manufacturing, org-level catalog
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    sku VARCHAR(50) NOT NULL,
    name VARCHAR(200) NOT NULL,
    uom VARCHAR(20) NOT NULL DEFAULT 'EA',
    is_finished_good BOOLEAN NOT NULL DEFAULT false,   -- true for Manufacturing outputs
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (organization_id, sku)
);

-- Stock is branch-scoped even though the item catalog is shared org-wide.
CREATE TABLE item_stock (
    item_id UUID NOT NULL REFERENCES items(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    quantity_on_hand NUMERIC(14,4) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (item_id, branch_id)
);

CREATE TABLE bom_lines (                     -- Manufacturing only
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    finished_item_id UUID NOT NULL REFERENCES items(id),
    component_item_id UUID NOT NULL REFERENCES items(id),
    qty_per_unit NUMERIC(14,4) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sub-ledger, generalized from SmartAppt's unit-only anchor. ref_id is
-- polymorphic (points at customers/vendors/items depending on bp_type) so
-- there's no FK on it -- enforced at the application layer.
CREATE TABLE business_partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    bp_type VARCHAR(20) NOT NULL CHECK (bp_type IN ('CUSTOMER','VENDOR','ITEM')),
    ref_id UUID NOT NULL,
    name VARCHAR(200) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- ---------- Financial core (reused shape from SmartAppt, new instance) ----------

CREATE TABLE journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID REFERENCES branches(id),  -- new vs. SmartAppt: branch-wise books
    entry_date DATE NOT NULL,
    reference_type VARCHAR(30),
    posted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE journal_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id UUID NOT NULL REFERENCES journal_entries(id),
    account_id UUID NOT NULL REFERENCES accounts(id),
    business_partner_id UUID REFERENCES business_partners(id),  -- sub-ledger tag
    debit NUMERIC(14,2) NOT NULL DEFAULT 0,
    credit NUMERIC(14,2) NOT NULL DEFAULT 0
);

-- ---------- Domain lock: first transaction freezes org_domains ----------

CREATE OR REPLACE FUNCTION lock_org_domains() RETURNS TRIGGER AS $$
BEGIN
    UPDATE organizations
       SET domain_locked_at = now()
     WHERE id = NEW.organization_id
       AND domain_locked_at IS NULL;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lock_org_domains
AFTER INSERT ON journal_entries
FOR EACH ROW EXECUTE FUNCTION lock_org_domains();

-- Any future domain-specific transaction tables (sales_orders,
-- purchase_orders, production_orders, ...) should carry the same
-- AFTER INSERT trigger calling lock_org_domains(), since "before any
-- transaction — financial or domain-specific" is the stated rule, not
-- just journal_entries.

-- Application-layer guard (belt-and-braces, since a trigger only fires on
-- write): reject POST/DELETE on org_domains when
--   SELECT domain_locked_at FROM organizations WHERE id = :org_id
-- is NOT NULL.

-- ---------- Seed example: core (shared) + Trading overlay ----------
-- INSERT INTO coa_templates (domain_type_id, account_code, account_name, account_type, is_control_account, default_bp_type) VALUES
-- (NULL,          '1001', 'Cash in Hand',      'ASSET',     false, null),   -- core
-- (NULL,          '1002', 'Bank Account',      'ASSET',     false, null),   -- core
-- (NULL,          '4008', 'Administrative',    'EXPENSE',   false, null),   -- core
-- (:trading_id,   '1005', 'Trade Receivables', 'ASSET',     true,  'CUSTOMER'),
-- (:trading_id,   '1201', 'Inventory',         'ASSET',     true,  'ITEM'),
-- (:trading_id,   '2001', 'Trade Payables',    'LIABILITY', true,  'VENDOR'),
-- (:mfg_id,       '1301', 'Raw Materials',     'ASSET',     true,  'ITEM'),
-- (:mfg_id,       '1302', 'Work in Progress',  'ASSET',     false, null),
-- (:mfg_id,       '1303', 'Finished Goods',    'ASSET',     true,  'ITEM');
