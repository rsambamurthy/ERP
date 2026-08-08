-- M-PIN login (SmartAppt Gold-style phone + OTP + 4-digit PIN) — see
-- ROADMAP.md's "M-PIN Login" section.
--
-- Run after migration_015_journal_ux.sql:
--   psql "$DATABASE_URL" -f db/migration_016_mpin.sql

ALTER TABLE users
    -- Hashed the same way password_hash is (bcrypt via lib/password.ts) —
    -- null until a user has gone through the M-PIN setup flow once.
    -- Existing email/phone + password login (POST /auth/login) is
    -- untouched by this — this is an additive alternative, not a
    -- replacement.
    ADD COLUMN IF NOT EXISTS mpin_hash VARCHAR(255);
