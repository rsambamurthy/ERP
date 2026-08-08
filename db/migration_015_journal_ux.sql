-- Journal Entries UI/UX rebuild (master-detail layout, voucher numbering,
-- edit for manual entries, supporting-document attachment) — see
-- ROADMAP.md's "Journal Entries UX (built)" section.
--
-- Run after migration_014_discount_gst.sql:
--   psql "$DATABASE_URL" -f db/migration_015_journal_ux.sql

ALTER TABLE journal_entries
    -- Sequential reference code for manual entries only (JV-0001/BV-0001/
    -- CV-0001) — auto-posted entries (reference_type set) keep using their
    -- own document's number (sales_invoices.invoice_number etc.) instead of
    -- this, so it stays NULL for them.
    ADD COLUMN IF NOT EXISTS voucher_number VARCHAR(30),
    -- Supporting document — one per entry, replacing on re-upload. Stored
    -- directly in Postgres (no cloud storage configured anywhere in this
    -- app yet) — fine for occasional scanned bills/receipts, not meant for
    -- high-volume or large files. 5MB cap enforced at the app layer
    -- (lib/upload.ts), same limit already used for bulk-upload xlsx files.
    ADD COLUMN IF NOT EXISTS attachment_filename  VARCHAR(255),
    ADD COLUMN IF NOT EXISTS attachment_mime_type  VARCHAR(100),
    ADD COLUMN IF NOT EXISTS attachment_size       INTEGER,
    ADD COLUMN IF NOT EXISTS attachment_data       BYTEA;

-- Unique per org among non-null voucher numbers only (a partial index,
-- since most rows — every auto-posted entry — leave this NULL and nulls
-- must not collide) — Prisma's schema language can't express a partial
-- unique index, so this is enforced at the DB level only, same convention
-- business_partners.code already uses (migration_007).
CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_org_voucher_number
    ON journal_entries (organization_id, voucher_number)
    WHERE voucher_number IS NOT NULL;
