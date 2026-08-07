-- Custom org roles, layered on top of the fixed OWNER/ADMIN/ACCOUNTANT/VIEWER
-- roles (those stay hardcoded — OWNER's un-demotable/un-removable guarantee
-- and ADMIN's self-lock protection don't change). An org can additionally
-- define its own named roles, each a subset of a fixed catalogue of
-- module-level permissions (see backend/src/lib/permissions.ts for the
-- authoritative list) — e.g. a "Sales Clerk" role that can post Sales
-- Invoices but nothing else.
--
-- Deliberately NOT included in the assignable permission catalogue:
-- managing team members/roles and configuring menu visibility. Both stay
-- OWNER/ADMIN-only (checked via requireRole, not requirePermission)
-- because either one, handed to a custom role, would let that role holder
-- create a more powerful role and assign it to themselves — the classic
-- self-escalation hole in a permissions-that-can-grant-permissions model.
--
-- Plain SQL, no DO block — see migration_006's note on Railway's Data/Query
-- panel not parsing PL/pgSQL's $$ ... $$ body.

CREATE TABLE IF NOT EXISTS org_roles (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES organizations(id),
    name             VARCHAR(50) NOT NULL,
    permissions      TEXT[] NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, name)
);

-- A member/invite assigned a custom role gets role = 'CUSTOM' plus this FK,
-- instead of one of the four fixed role strings. Nullable, since most rows
-- still use a fixed role and have no custom role.
ALTER TABLE org_users ADD COLUMN IF NOT EXISTS custom_role_id UUID REFERENCES org_roles(id);
ALTER TABLE org_invites ADD COLUMN IF NOT EXISTS custom_role_id UUID REFERENCES org_roles(id);

CREATE INDEX IF NOT EXISTS idx_org_roles_org ON org_roles(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_users_custom_role ON org_users(custom_role_id);
CREATE INDEX IF NOT EXISTS idx_org_invites_custom_role ON org_invites(custom_role_id);
