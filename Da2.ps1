$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Fix: Inter-Branch Payable moves from 2105 to 2106...' -ForegroundColor Cyan

function Edit-FileText($rel, $old, $new) {
  $p = Join-Path $repo $rel
  if (-not (Test-Path -LiteralPath $p)) { throw "Missing file: $rel" }
  $old = $old.Replace([string][char]13, '')
  $new = $new.Replace([string][char]13, '')
  $t = [IO.File]::ReadAllText($p).Replace([string][char]13, '')
  if ($t.Contains($new)) { Write-Host "  skip   $rel"; return }
  $i = $t.IndexOf($old)
  if ($i -lt 0) { throw "Anchor not found in $rel." }
  if ($t.IndexOf($old, $i + 1) -ge 0) { throw "Anchor is not unique in $rel." }
  $t = $t.Substring(0, $i) + $new + $t.Substring($i + $old.Length)
  [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
  Write-Host "  edit   $rel"
}

Edit-FileText 'db/migration_044_transfer_valuation.sql' '-- migration mid-build.
--
-- WHAT THIS ADDS, AND WHY EACH PIECE IS SHAPED THE WAY IT IS
--
-- 1. Account 2105 Inter-Branch Payable — the receiving branch''s half of the
--    clearing pair migration_041''s 1305 Inter-Branch Account already
--    started (renamed there to 1305 Inter-Branch RECEIVABLE by this
--    migration, since a two-sided pair needs both halves named for what
--    they are). Deliberately NOT netted against 1305: AS 1 / Ind AS 1
' '-- migration mid-build.
--
-- WHAT THIS ADDS, AND WHY EACH PIECE IS SHAPED THE WAY IT IS
--
-- 1. Account 2106 Inter-Branch Payable — the receiving branch''s half of the
--    clearing pair migration_041''s 1305 Inter-Branch Account already
--    started (renamed there to 1305 Inter-Branch RECEIVABLE by this
--    migration, since a two-sided pair needs both halves named for what
--    they are). Deliberately NOT netted against 1305: AS 1 / Ind AS 1
'

Edit-FileText 'db/migration_044_transfer_valuation.sql' '--    zero across the organisation, not within one branch''s trial balance.
--
--    Once Phase D posts, the reconciliation identity at any date is:
--
--        1305 (Receivable) + 1304 (Stock in Transit) - 2105 (Payable) = 0
--
--    1304 is in the sum because dispatch and receipt land in different
--    states'' books on different dates — see migration_043''s header on why
--    the account exists at all. A break in this identity is a real
' '--    zero across the organisation, not within one branch''s trial balance.
--
--    Once Phase D posts, the reconciliation identity at any date is:
--
--        1305 (Receivable) + 1304 (Stock in Transit) - 2106 (Payable) = 0
--
--    1304 is in the sum because dispatch and receipt land in different
--    states'' books on different dates — see migration_043''s header on why
--    the account exists at all. A break in this identity is a real
'

Edit-FileText 'db/migration_044_transfer_valuation.sql' '
-- 2. The payable counterpart, in the templates, wherever 1305''s template
--    already lives.
INSERT INTO coa_templates (domain_type_id, account_code, account_name, account_type, is_control_account, schedule_iii_head)
SELECT t.domain_type_id, ''2105'', ''Inter-Branch Payable'', ''LIABILITY'', false, ''OTHER_CURRENT_LIABILITIES''
  FROM coa_templates t
 WHERE t.account_code = ''1305''
   AND NOT EXISTS (
         SELECT 1 FROM coa_templates x
          WHERE x.domain_type_id IS NOT DISTINCT FROM t.domain_type_id
            AND x.account_code = ''2105'');


-- 3. The payable counterpart, on every organisation that already has 1305.
INSERT INTO accounts (organization_id, account_code, account_name, account_type, is_control_account, schedule_iii_head, is_system)
SELECT a.organization_id, ''2105'', ''Inter-Branch Payable'', ''LIABILITY'', false, ''OTHER_CURRENT_LIABILITIES'', true
  FROM accounts a
 WHERE a.account_code = ''1305''
   AND NOT EXISTS (
         SELECT 1 FROM accounts x
          WHERE x.organization_id = a.organization_id AND x.account_code = ''2105'');


-- 4. A branch''s own ITC posture. ADD COLUMN IF NOT EXISTS is natively
--    idempotent, unlike ADD CONSTRAINT — no drop-then-add dance needed for
' '
-- 2. The payable counterpart, in the templates, wherever 1305''s template
--    already lives.
INSERT INTO coa_templates (domain_type_id, account_code, account_name, account_type, is_control_account, schedule_iii_head)
SELECT t.domain_type_id, ''2106'', ''Inter-Branch Payable'', ''LIABILITY'', false, ''OTHER_CURRENT_LIABILITIES''
  FROM coa_templates t
 WHERE t.account_code = ''1305''
   AND NOT EXISTS (
         SELECT 1 FROM coa_templates x
          WHERE x.domain_type_id IS NOT DISTINCT FROM t.domain_type_id
            AND x.account_code = ''2106'');


-- 3. The payable counterpart, on every organisation that already has 1305.
INSERT INTO accounts (organization_id, account_code, account_name, account_type, is_control_account, schedule_iii_head, is_system)
SELECT a.organization_id, ''2106'', ''Inter-Branch Payable'', ''LIABILITY'', false, ''OTHER_CURRENT_LIABILITIES'', true
  FROM accounts a
 WHERE a.account_code = ''1305''
   AND NOT EXISTS (
         SELECT 1 FROM accounts x
          WHERE x.organization_id = a.organization_id AND x.account_code = ''2106'');


-- 4. A branch''s own ITC posture. ADD COLUMN IF NOT EXISTS is natively
--    idempotent, unlike ADD CONSTRAINT — no drop-then-add dance needed for
'

Edit-FileText 'db/migration_044_transfer_valuation.sql' '

-- Verify:
--   SELECT account_code, account_name FROM accounts
--    WHERE account_code IN (''1305'',''2105'') ORDER BY account_code;
--   -- expect 1305 Inter-Branch Receivable, 2105 Inter-Branch Payable,
--   -- same row count for each
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = ''business_partners_bp_type_check'';
' '

-- Verify:
--   SELECT account_code, account_name FROM accounts
--    WHERE account_code IN (''1305'',''2106'') ORDER BY account_code;
--   -- expect 1305 Inter-Branch Receivable, 2106 Inter-Branch Payable,
--   -- same row count for each
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = ''business_partners_bp_type_check'';
'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green