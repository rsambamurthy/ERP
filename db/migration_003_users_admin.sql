-- ============================================================
-- Migration 003 — Platform admin + org user management
--
-- Two things this project didn't have until now:
--   1. A platform-operator ("superuser") who isn't a member of any
--      organization but can see every org, toggle their subscription
--      status, and read the audit trail.
--   2. More than one login per organization. Previously only the
--      OWNER created at registration could log in at all — no invite
--      flow, no other roles. org_users.role now takes OWNER / ADMIN /
--      ACCOUNTANT / VIEWER (still just a VARCHAR — no CHECK constraint
--      change needed, it was never constrained).
-- ============================================================

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (subscription_status IN ('ACTIVE', 'SUSPENDED'));

-- Pending invitations. A row here becomes a real users/org_users pair once
-- the invitee visits /accept-invite?token=... and sets a password.
CREATE TABLE IF NOT EXISTS org_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    email VARCHAR(255),
    phone VARCHAR(20),
    role VARCHAR(20) NOT NULL,
    invited_by UUID NOT NULL REFERENCES users(id),
    token VARCHAR(64) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

-- Platform-wide audit trail — who did what, across every org. Written to
-- from key mutation endpoints (accounts, business partners, journal
-- entries, user management, subscription changes). organization_id is
-- nullable for platform-admin-only actions (e.g. toggling a subscription
-- is logged against the *target* org, but a future platform-level action
-- with no single org would leave it null).
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id),
    actor_user_id UUID REFERENCES users(id),
    action VARCHAR(50) NOT NULL,        -- CREATE, UPDATE, DELETE, TOGGLE, INVITE, REVOKE, SUSPEND, ...
    entity_type VARCHAR(50) NOT NULL,   -- account, business_partner, journal_entry, org_user, organization, ...
    entity_id UUID,
    summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org ON audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_invites_org ON org_invites(organization_id);

-- To make yourself (or anyone) a platform admin, run this manually once —
-- there's no self-serve signup for it on purpose:
--   UPDATE users SET is_platform_admin = true WHERE email = 'you@example.com';
-- Or use `npm run create-admin -- --email you@example.com --password ...`
-- (backend/scripts/create-admin.ts) which also creates the user if needed.
