-- Minimal, interim employee-details fields on org_users (address, PAN,
-- Aadhar) — deliberately NOT a separate Employee master table. That's the
-- bigger feature discussed and deferred; this is the "for now" version:
-- OWNER/ADMIN fills these in per team member from the Team screen.
--
-- Aadhar handling caveat: stored as plain text here, same as any other
-- column — there is no encryption-at-rest in this MVP. The application
-- layer (see PATCH /org/users/:userId/employee-details in orgUsers.ts)
-- never returns the full number in any API response, only a masked
-- "XXXX XXXX 1234" form, which limits accidental exposure through the API
-- surface — but this does NOT satisfy UIDAI storage requirements for
-- production use. Treat this as a placeholder until real encryption/
-- tokenization is built, if Aadhar capture becomes a real compliance need.
--
-- Plain SQL, no DO block — see migration_006's note on Railway's Data/Query
-- panel not parsing PL/pgSQL's $$ ... $$ body.

ALTER TABLE org_users ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE org_users ADD COLUMN IF NOT EXISTS pan VARCHAR(10);
ALTER TABLE org_users ADD COLUMN IF NOT EXISTS aadhar VARCHAR(12);
