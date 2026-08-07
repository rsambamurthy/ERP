-- Lets a custom role (org_roles) be configured in Access Control the same
-- way the four fixed roles already are. A custom role's row in
-- org_menu_config is keyed "custom:<org_roles.id>" (36-char UUID + 7-char
-- prefix = 43 chars) — VARCHAR(20) was only ever sized for fixed role names
-- like "ACCOUNTANT", too narrow for that. Widening a varchar column's
-- length is a metadata-only change in Postgres (no table rewrite).
--
-- Plain SQL, no DO block — see migration_006's note on Railway's Data/Query
-- panel not parsing PL/pgSQL's $$ ... $$ body.

ALTER TABLE org_menu_config ALTER COLUMN role TYPE VARCHAR(50);
