-- ============================================================
-- Migration 002 — Accounting core (Chart of Accounts, Business
-- Partners, Journal Entries) brought up to the level SmartAppt's
-- Financial Accounting module already proved out, so SmartERP
-- doesn't rebuild these from scratch.
--
-- Run this against the existing SmartERP Postgres instance AFTER
-- registration_schema_v2.sql. Additive only — safe to run on a
-- database that already has live organizations/accounts.
-- ============================================================

-- ---------- accounts: hierarchy, opening balances, activation ----------

ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS sub_type VARCHAR(60),
    ADD COLUMN IF NOT EXISTS description VARCHAR(255),
    ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES accounts(id),
    ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS opening_balance_type VARCHAR(6)
        CHECK (opening_balance_type IN ('DEBIT','CREDIT')),
    ADD COLUMN IF NOT EXISTS opening_balance_date DATE;

-- Note: is_system defaults to false for the new column. The backend's
-- provisioning step (lib/provisioning.ts) now sets is_system = true when it
-- creates accounts from coa_templates going forward — that's what makes an
-- org's standard COA protected from structural edits/deletes. Any org
-- provisioned before this migration will have its existing accounts
-- unprotected; harmless pre-launch, but worth a manual UPDATE for any real
-- org's data before go-live if that matters.

-- ---------- business_partners: becomes the actual customer/vendor master ----------
-- Previously a pure sub-ledger tag (ref_id pointing elsewhere, NOT NULL).
-- For CUSTOMER/VENDOR, the row IS the master now — ref_id stays polymorphic
-- and NULLable, still used for ITEM (-> items.id).

ALTER TABLE business_partners
    ALTER COLUMN ref_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS gstin VARCHAR(15),
    ADD COLUMN IF NOT EXISTS phone VARCHAR(20),
    ADD COLUMN IF NOT EXISTS email VARCHAR(255),
    ADD COLUMN IF NOT EXISTS address JSONB,
    ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS opening_balance_type VARCHAR(6)
        CHECK (opening_balance_type IN ('DEBIT','CREDIT')),
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- ---------- journal_entries: narration + voucher type ----------

ALTER TABLE journal_entries
    ADD COLUMN IF NOT EXISTS narration VARCHAR(255) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS voucher_type VARCHAR(4)
        CHECK (voucher_type IN ('BV','CV','JV')),
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

-- ---------- journal_lines: per-line memo ----------

ALTER TABLE journal_lines
    ADD COLUMN IF NOT EXISTS narration VARCHAR(255);

-- Fast ledger/trial-balance lookups.
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_bp ON journal_lines(business_partner_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_org_date ON journal_entries(organization_id, entry_date);
