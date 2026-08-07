-- Rounds out basic user management: self-service profile edit (no schema
-- change needed — users.name/email/phone already exist), password
-- change/reset, branch assignment (org_users.branch_id already exists,
-- unused until now), and member suspension (distinct from removal — a
-- suspended member keeps their history/audit trail, a removed one loses
-- org_users entirely).
--
-- Plain SQL, no DO block — see migration_006's note on Railway's Data/Query
-- panel not parsing PL/pgSQL's $$ ... $$ body.

-- Forgot-password OTP. Lives on users (not onboarding_state, which is
-- organization-scoped and only used during signup) since password reset is
-- a per-user, not per-org, action.
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_otp_code VARCHAR(10);
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_otp_expires_at TIMESTAMPTZ;

-- A suspended member can't log in / use an existing session against this
-- org, but stays in org_users (their role, branch, and every record they
-- ever touched stay intact) — distinct from DELETE /org/users/:userId,
-- which removes membership entirely. Mirrors organizations.status /
-- branches.status's existing ACTIVE/SUSPENDED-style VARCHAR(20) convention.
ALTER TABLE org_users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE org_users DROP CONSTRAINT IF EXISTS org_users_status_check;
ALTER TABLE org_users ADD CONSTRAINT org_users_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED'));
