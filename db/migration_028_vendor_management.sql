-- Vendor Management (Phase 1): profile depth + a minimal approval
-- workflow on the existing Business Partner (bp_type = 'VENDOR') record.
-- No new entity, no new permission — everything here rides on the
-- existing businessPartners.manage permission and is designed to be a
-- thin, swappable placeholder: a single-step status field + approve/
-- reject, same shape as purchase_bills.status (migration_024), so a
-- future generic Workflow Management System can drive this same field
-- later instead of a direct API call, with no data migration needed.
--
-- Run after migration_027_po_so_currency.sql:
--   psql "$DATABASE_URL" -f db/migration_028_vendor_management.sql

-- DEFAULT 'APPROVED' backfills every existing business partner (customer
-- or vendor) as already approved — this feature didn't exist before, so
-- nothing that already works should suddenly be blocked.
ALTER TABLE business_partners
    ADD COLUMN IF NOT EXISTS vendor_category VARCHAR(30),
    ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'APPROVED',
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(500),
    -- International tax registration — deliberately separate from `gstin`
    -- above, never read by the India GST engine (isInterState/splitGst
    -- key off gstin/state_code only). Display-only: a foreign vendor's
    -- own tax reference (EIN, GST/HST No., VAT No., ...) for the org's
    -- own records. tax_id_type is unconstrained (app-layer dropdown),
    -- same convention as opening_balance_type having no CHECK either.
    ADD COLUMN IF NOT EXISTS tax_id_type VARCHAR(20),
    ADD COLUMN IF NOT EXISTS tax_id VARCHAR(50);

ALTER TABLE business_partners
    DROP CONSTRAINT IF EXISTS business_partners_approval_status_check;
ALTER TABLE business_partners
    ADD CONSTRAINT business_partners_approval_status_check
    CHECK (approval_status IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED'));

CREATE INDEX IF NOT EXISTS idx_business_partners_approval_status
    ON business_partners(organization_id, approval_status);

-- Multiple contacts per vendor (buyer's own contact list at the vendor —
-- name/phone/email, not a login). Reused generically for either bp_type
-- even though only Vendor create/edit screens expose it in Phase 1.
CREATE TABLE IF NOT EXISTS vendor_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_partner_id UUID NOT NULL REFERENCES business_partners(id),
    name VARCHAR(200) NOT NULL,
    designation VARCHAR(100),
    phone VARCHAR(20),
    email VARCHAR(255),
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendor_contacts_bp ON vendor_contacts(business_partner_id);

-- Multiple labeled addresses per vendor (Registered / Billing / Shipping /
-- Warehouse, freeform label). The existing business_partners.address JSON
-- column is untouched (still whatever bulk-upload/legacy single-address
-- callers use) — this table is the new, richer, multi-address structure.
CREATE TABLE IF NOT EXISTS vendor_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_partner_id UUID NOT NULL REFERENCES business_partners(id),
    label VARCHAR(30) NOT NULL DEFAULT 'Registered',
    line1 VARCHAR(200),
    line2 VARCHAR(200),
    city VARCHAR(100),
    state VARCHAR(100),
    state_code VARCHAR(2),
    pincode VARCHAR(10),
    country VARCHAR(100) NOT NULL DEFAULT 'India',
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendor_addresses_bp ON vendor_addresses(business_partner_id);

-- Vendor's own bank details, captured for a future Accounts
-- Payable/payments module (this app has no payment-execution feature at
-- all yet — this is master data capture only, never used to move money).
-- ifsc_code (India), swift_code (international wire), routing_number (US
-- ABA / Canada institution+transit) all coexist, all optional — which
-- ones are filled depends on the vendor's own country, never enforced
-- here.
CREATE TABLE IF NOT EXISTS vendor_bank_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_partner_id UUID NOT NULL REFERENCES business_partners(id),
    account_holder_name VARCHAR(200),
    bank_name VARCHAR(150),
    account_number VARCHAR(40),
    ifsc_code VARCHAR(11),
    swift_code VARCHAR(11),
    routing_number VARCHAR(20),
    branch_name VARCHAR(150),
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendor_bank_accounts_bp ON vendor_bank_accounts(business_partner_id);
