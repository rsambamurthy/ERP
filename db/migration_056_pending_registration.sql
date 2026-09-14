-- Staged company registration, held until the emailed verification link is
-- clicked. No organizations/users row exists for a signup until then — see
-- POST /auth/verify-email in routes/auth.ts. Replaces the old "create the
-- org immediately, gate it as unverified" approach: nothing is persisted as
-- a real account pre-verification.
--
-- Run after migration_055_charge_types.sql:
--   psql "$DATABASE_URL" -f db/migration_056_pending_registration.sql
CREATE TABLE IF NOT EXISTS pending_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token VARCHAR(64) NOT NULL UNIQUE,
    business_name VARCHAR(200) NOT NULL,
    name VARCHAR(150) NOT NULL,
    -- Both required for this flow (no SMS gateway to deliver a link by
    -- phone) — unlike users.email/users.phone, which stay independently
    -- nullable since not every login identifier needs both.
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    -- DomainDetailsMap — same shape POST /onboarding/domain always accepted,
    -- just staged here instead of written straight to org_domains since no
    -- organization exists yet. Populated by POST /onboarding/domain (against
    -- this row's id), read by POST /auth/verify-email.
    domains JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    -- Set once POST /auth/verify-email successfully turns this into a real
    -- organization — makes a second click on the same link an idempotent
    -- replay (look up created_organization_id) rather than an error.
    consumed_at TIMESTAMPTZ,
    created_organization_id UUID REFERENCES organizations(id)
);

CREATE INDEX IF NOT EXISTS idx_pending_registrations_email ON pending_registrations(email);
CREATE INDEX IF NOT EXISTS idx_pending_registrations_phone ON pending_registrations(phone);
