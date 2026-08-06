-- Per-org, per-role overrides for which sidebar items a role sees. Mirrors
-- SmartAppt's menu_group_config (system.service.ts / WebMenuPage.tsx):
-- sparse by design — only cells that depart from the item's default `roles`
-- list (frontend/components/layout/navGroups.ts) are stored, so a menu item
-- added in a later release still shows up for the right roles without every
-- org having to go and enable it.
--
-- Run after migration_004_module_subscriptions.sql:
--   psql "$DATABASE_URL" -f db/migration_005_menu_config.sql

CREATE TABLE IF NOT EXISTS org_menu_config (
    organization_id UUID NOT NULL REFERENCES organizations(id),
    item_id         VARCHAR(50) NOT NULL,   -- matches NavItem.id in navGroups.ts
    role            VARCHAR(20) NOT NULL,   -- OWNER / ADMIN / ACCOUNTANT / VIEWER
    enabled         BOOLEAN NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, item_id, role)
);

CREATE INDEX IF NOT EXISTS idx_org_menu_config_org ON org_menu_config(organization_id);
