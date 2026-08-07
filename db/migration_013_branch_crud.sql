-- Branch Master: phone/email fields (code, name, gstin, address, isHeadOffice,
-- status already existed but had no real CRUD around them — see
-- backend/src/routes/branches.ts). No new table needed.
--
-- Plain SQL, no DO block — see migration_006's note on Railway's Data/Query
-- panel not parsing PL/pgSQL's $$ ... $$ body.

ALTER TABLE branches ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS email VARCHAR(255);
