-- User's display name (was never captured — the header showed the org role
-- instead because that's all a session held), and an optional Business
-- Partner code (needed so a bulk-upload row can reliably match an existing
-- customer/vendor for update rather than only ever creating new ones).
--
-- Plain SQL, no DO block — see migration_006's note on why: Railway's
-- Data/Query panel can't parse a PL/pgSQL $$ ... $$ body.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS name VARCHAR(150);

ALTER TABLE business_partners
    ADD COLUMN IF NOT EXISTS code VARCHAR(30);

-- Unique per org, but only when actually set — most manually-created
-- partners will never have one, and NULL never conflicts with NULL under a
-- partial index (a plain UNIQUE constraint would let only one NULL through
-- total, which is wrong here).
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_partners_org_code
    ON business_partners (organization_id, code)
    WHERE code IS NOT NULL AND deleted_at IS NULL;
