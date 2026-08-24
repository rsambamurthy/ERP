$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Phase D-b: migration_046, sub-ledger integrity...' -ForegroundColor Cyan

function Set-FileText($rel, $text) {
  $p = Join-Path $repo $rel
  $dir = Split-Path $p -Parent
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [IO.File]::WriteAllText($p, $text.Replace([string][char]13, ''), (New-Object Text.UTF8Encoding $false))
  Write-Host "  wrote  $rel"
}
$f0 = @'
-- Two corrections found by reviewing the branch-transfer posting code before
-- it went live. Neither changes what the route computes; both stop a
-- sub-ledger from silently coming apart.
--
-- 1. ONE CARD PER THING
--
-- business_partners rows with a ref_id are sub-ledger CARDS: one per item
-- (bp_type='ITEM'), one per prepaid schedule ('PREPAID'), one per fixed asset
-- ('ASSET'), and now one per branch ('BRANCH'). Every one of them is supposed
-- to be unique for the thing it points at, and until now nothing enforced it.
--
-- routes/stockTransfers.ts creates a BRANCH card lazily, the first time a
-- branch is one end of a taxable transfer: read, and create if absent. Two
-- transfers into the same branch dispatched at the same moment both read
-- nothing and both create — two cards for one branch. From then on the
-- dispatch side of a transfer can be tagged to one card and the receipt side
-- to the other, and the 1305/2106 sub-ledger for that branch never nets to
-- zero again. That is precisely the reconciliation migration_044 exists to
-- make possible.
--
-- A unique index turns the second create into a constraint violation the
-- route can handle, instead of silent data damage nobody notices for months.
--
-- Partial, on ref_id IS NOT NULL, because a CUSTOMER or VENDOR partner is not
-- a card for anything and has no ref_id to be unique on.
--
-- CHECK FOR EXISTING DUPLICATES FIRST. If statement 2 fails with
-- "could not create unique index", run the query in statement 1 to see what
-- is already doubled up and merge those rows before retrying.
--
-- 2. 1305 AND 2106 ARE CONTROL ACCOUNTS
--
-- Both carry a per-branch card on every line the transfer route writes, which
-- is what makes an inter-branch balance breakable down branch by branch. But
-- they were created with is_control_account = false, and that flag is what
-- routes/journal.ts checks before REQUIRING a business partner on a manual
-- journal line.
--
-- So an accountant writing off an inter-branch difference by hand could post
-- to 1305 with no card at all, and the account would hold tagged transfer
-- lines plus untagged manual ones — reconcilable to nothing. Same pattern
-- Trade Receivables and Inventory already follow, applied to the two accounts
-- that now need it.
--
-- Run after migration_045_transfer_transit_clearing.sql. Statements stand
-- alone — run them one at a time.
--
-- Idempotent: safe to re-run.


-- 1. DIAGNOSTIC, not a change. Run this first. It should return no rows.
--    Anything it returns must be merged by hand before statement 2 will
--    succeed: repoint journal_lines.business_partner_id from the duplicate
--    to the keeper, then soft-delete the duplicate.
SELECT organization_id, bp_type, ref_id, count(*) AS cards
  FROM business_partners
 WHERE ref_id IS NOT NULL AND deleted_at IS NULL
 GROUP BY organization_id, bp_type, ref_id
HAVING count(*) > 1;


-- 2. One card per (organisation, kind, thing).
--    Scoped to deleted_at IS NULL so a card that was soft-deleted and
--    recreated is not treated as a duplicate of its own replacement.
CREATE UNIQUE INDEX IF NOT EXISTS business_partners_ref_uq
  ON business_partners (organization_id, bp_type, ref_id)
  WHERE ref_id IS NOT NULL AND deleted_at IS NULL;


-- 3 and 4. Make the two inter-branch accounts control accounts with a
--    BRANCH sub-ledger, in the templates and on every organisation that has
--    them. is_control_account is what makes a manual journal entry demand a
--    card; default_bp_type is what tells the picker which cards to offer.
UPDATE coa_templates
   SET is_control_account = true, default_bp_type = 'BRANCH'
 WHERE account_code IN ('1305', '2106');

UPDATE accounts
   SET is_control_account = true, default_bp_type = 'BRANCH'
 WHERE account_code IN ('1305', '2106') AND is_system;


-- Verify:
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'business_partners' AND indexname = 'business_partners_ref_uq';
--
--   SELECT account_code, account_name, is_control_account, default_bp_type
--     FROM accounts WHERE account_code IN ('1305','2106')
--    ORDER BY account_code, organization_id LIMIT 20;
--   -- expect is_control_account = t and default_bp_type = BRANCH on every row

'@
Set-FileText 'db/migration_046_branch_partner_control.sql' $f0
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green