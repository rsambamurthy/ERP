-- Upgrades org_modules from a bare enable flag into a real per-module
-- subscription record — status/expiry/billing fields — so the platform
-- admin console can grant, renew, and cancel one module for one org at a
-- time. Mirrors SmartAppt's association_modules (see
-- subscriptions.routes.ts / entitlement.service.ts).
--
-- Run after migration_003_users_admin.sql:
--   psql "$DATABASE_URL" -f db/migration_004_module_subscriptions.sql

ALTER TABLE org_modules
    ADD COLUMN IF NOT EXISTS status      VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'TRIAL', 'CANCELLED')),
    ADD COLUMN IF NOT EXISTS starts_on   DATE NOT NULL DEFAULT CURRENT_DATE,
    ADD COLUMN IF NOT EXISTS expires_on  DATE,               -- NULL = perpetual
    ADD COLUMN IF NOT EXISTS amount      DECIMAL(10, 2),
    ADD COLUMN IF NOT EXISTS reference   VARCHAR(100),
    ADD COLUMN IF NOT EXISTS note        TEXT,
    ADD COLUMN IF NOT EXISTS granted_by  UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_org_modules_expires_on ON org_modules (expires_on)
    WHERE expires_on IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_modules_status ON org_modules (status);
