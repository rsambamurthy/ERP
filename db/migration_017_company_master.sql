-- Company Master data (for statutory filings like AOC-4) + Schedule III
-- Balance Sheet classification — see ROADMAP.md's "Company Master + Schedule
-- III Balance Sheet" section.
--
-- Run after migration_016_mpin.sql:
--   psql "$DATABASE_URL" -f db/migration_017_company_master.sql

ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS cin                        VARCHAR(21),
    ADD COLUMN IF NOT EXISTS company_pan                 VARCHAR(10),
    ADD COLUMN IF NOT EXISTS company_type                VARCHAR(30),
    ADD COLUMN IF NOT EXISTS incorporation_date           DATE,
    ADD COLUMN IF NOT EXISTS registered_office_address    JSONB;

CREATE TABLE IF NOT EXISTS directors (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES organizations(id),
    name             VARCHAR(150) NOT NULL,
    din              VARCHAR(20),
    designation      VARCHAR(50),
    appointment_date DATE,
    cessation_date   DATE,
    is_active        BOOLEAN NOT NULL DEFAULT true,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_directors_org ON directors (organization_id);

CREATE TABLE IF NOT EXISTS auditors (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id           UUID NOT NULL REFERENCES organizations(id),
    name                      VARCHAR(150) NOT NULL,
    membership_number         VARCHAR(20),
    firm_registration_number  VARCHAR(20),
    appointment_date          DATE,
    tenure_end_date           DATE,
    is_active                 BOOLEAN NOT NULL DEFAULT true,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auditors_org ON auditors (organization_id);

-- Schedule III classification — only meaningful for ASSET/LIABILITY/EQUITY
-- accounts. Null (unclassified) for everything until either a template
-- default applies it, or someone tags it manually via Chart of Accounts.
ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS schedule_iii_head VARCHAR(40);

ALTER TABLE coa_templates
    ADD COLUMN IF NOT EXISTS schedule_iii_head VARCHAR(40);

-- Backfill the default classification onto every template this app ships
-- with (see lib/scheduleIII.ts for the full catalog) — so provisioning a
-- brand-new org classifies most of its COA automatically. INCOME/EXPENSE
-- templates (4001/4002/4003/4008/5001) are left NULL — Schedule III P&L
-- formatting isn't built yet, only the Balance Sheet side.
UPDATE coa_templates SET schedule_iii_head = 'CASH_AND_CASH_EQUIVALENTS' WHERE account_code IN ('1001', '1002');
UPDATE coa_templates SET schedule_iii_head = 'TRADE_RECEIVABLES'        WHERE account_code = '1005';
UPDATE coa_templates SET schedule_iii_head = 'TRADE_PAYABLES'           WHERE account_code = '2001';
UPDATE coa_templates SET schedule_iii_head = 'OTHER_CURRENT_ASSETS'     WHERE account_code IN ('1101', '1102', '1103', '1104');
UPDATE coa_templates SET schedule_iii_head = 'OTHER_CURRENT_LIABILITIES' WHERE account_code IN ('2101', '2102', '2103', '2104');
UPDATE coa_templates SET schedule_iii_head = 'INVENTORIES'              WHERE account_code IN ('1201', '1301', '1302', '1303');

-- Same backfill onto every already-provisioned org's accounts — only the
-- system (templated) ones; a manually-created EQUITY/ASSET/LIABILITY
-- account stays unclassified until someone tags it via Chart of Accounts.
UPDATE accounts SET schedule_iii_head = 'CASH_AND_CASH_EQUIVALENTS' WHERE is_system AND account_code IN ('1001', '1002');
UPDATE accounts SET schedule_iii_head = 'TRADE_RECEIVABLES'        WHERE is_system AND account_code = '1005';
UPDATE accounts SET schedule_iii_head = 'TRADE_PAYABLES'           WHERE is_system AND account_code = '2001';
UPDATE accounts SET schedule_iii_head = 'OTHER_CURRENT_ASSETS'     WHERE is_system AND account_code IN ('1101', '1102', '1103', '1104');
UPDATE accounts SET schedule_iii_head = 'OTHER_CURRENT_LIABILITIES' WHERE is_system AND account_code IN ('2101', '2102', '2103', '2104');
UPDATE accounts SET schedule_iii_head = 'INVENTORIES'              WHERE is_system AND account_code IN ('1201', '1301', '1302', '1303');
