$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Phase D: transfer valuation, migration_044...' -ForegroundColor Cyan

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

function Set-FileText($rel, $text) {
  $p = Join-Path $repo $rel
  $dir = Split-Path $p -Parent
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [IO.File]::WriteAllText($p, $text.Replace([string][char]13, ''), (New-Object Text.UTF8Encoding $false))
  Write-Host "  wrote  $rel"
}

Set-FileText 'db/migration_044_transfer_valuation.sql' '-- Phase D: taxable branch transfers. Schema only — no route reads any of
-- this yet, so applying it changes nothing about how existing transfers
-- post. It exists so the routes built next don''t also have to carry a
-- migration mid-build.
--
-- WHAT THIS ADDS, AND WHY EACH PIECE IS SHAPED THE WAY IT IS
--
-- 1. Account 2105 Inter-Branch Payable — the receiving branch''s half of the
--    clearing pair migration_041''s 1305 Inter-Branch Account already
--    started (renamed there to 1305 Inter-Branch RECEIVABLE by this
--    migration, since a two-sided pair needs both halves named for what
--    they are). Deliberately NOT netted against 1305: AS 1 / Ind AS 1
--    prohibit offsetting an asset against a liability without a legal
--    right of set-off and an intention to settle net, and the two live in
--    different states'' books — there is no single entity in which they
--    could net at all until consolidation. They are designed to sum to
--    zero across the organisation, not within one branch''s trial balance.
--
--    Once Phase D posts, the reconciliation identity at any date is:
--
--        1305 (Receivable) + 1304 (Stock in Transit) - 2105 (Payable) = 0
--
--    1304 is in the sum because dispatch and receipt land in different
--    states'' books on different dates — see migration_043''s header on why
--    the account exists at all. A break in this identity is a real
--    posting error, not a timing difference; migration_043''s plain
--    1304-only check only holds for the untaxed, same-GSTIN case this
--    migration does not touch.
--
--    Same population as 1305: wherever 1305 already exists is where a
--    taxable transfer can eventually be posted, so that is where its
--    payable counterpart belongs too.
--
-- 2. branches.itc_eligibility — whether a branch can claim full input tax
--    credit on what it receives. Three values, though this phase only
--    ever writes FULL:
--
--      FULL           the default. Full ITC unlocks the second proviso to
--                      Rule 28 — the invoice value is deemed the open
--                      market value — which is why "at cost" is legal and
--                      is the basis this phase builds.
--      RESTRICTED      the branch makes exempt/nil-rated/non-GST outward
--                      supplies and the ITC would need reversal under
--                      s.17(2). The second proviso does not apply; a
--                      transfer into such a branch is refused rather than
--                      posted on an assumption that is wrong for it.
--      PROPORTIONATE   mixed supplies, Rule 42 apportionment. Not refused
--                      any differently from RESTRICTED today — it is a
--                      third value because collapsing it into RESTRICTED
--                      now would make a future migration rename a value
--                      in use, which is worse than a value that sits
--                      unused for a while.
--
--    A CHECK naming three values while the application writes only one is
--    the same trade made for stock_transfer_lines.valuation_basis below —
--    cheap now, a data migration later if it is not made.
--
-- 3. stock_transfers.to_branch_itc_eligibility — the receiving branch''s
--    itc_eligibility, copied onto the transfer AT DISPATCH and then
--    frozen. Same reasoning as tax_treatment already being frozen there:
--    a branch that is reclassified later must not restate a transfer
--    already made. The route decides whether to allow a taxable dispatch
--    by reading this frozen copy from here on, never the live branch row.
--
-- 4. stock_transfer_lines.valuation_basis — which Rule 28 step justifies
--    the taxable_value already on that line, recorded per line because
--    one transfer can carry both a bought-in item sold externally at a
--    known price (basis OMV) and a manufactured item with no such price
--    (basis RULE_30). All five values from the hierarchy are named even
--    though this phase computes only SECOND_PROVISO — see the note on
--    itc_eligibility above for why that is not premature.
--
-- 5. business_partners may now carry bp_type = ''BRANCH'' — the sub-ledger
--    card GSTR-1 needs for a receiving branch treated as a B2B
--    counterparty, keyed by ref_id = branches.id exactly the way an ITEM
--    partner is keyed by ref_id = items.id. Reading the GSTIN through
--    that link, rather than copying it onto the partner, is deliberate:
--    a branch''s GSTIN can only drift out of sync with itself this way,
--    never between two copies of it. Nothing creates these rows yet — the
--    posting route creates one lazily the first time a branch is actually
--    the destination of a taxable transfer, the same convention
--    items.ts already uses for ITEM partners. A branch that only ever
--    receives untaxed transfers never gets one.
--
-- 6. document_number_series — a tax invoice under Rule 46 needs a
--    consecutive serial number, and two branches are distinct persons
--    under s.25(4), so the series is scoped per branch, not per
--    organisation. Scoped per financial year too, because the numbering
--    conventionally restarts every April and the prefix itself often
--    encodes the year (GST/IBT/TN/26-27/0001) — a row per branch per year
--    keeps "restart at 1" a plain INSERT instead of a reset job someone
--    has to remember to run. prefix is NOT NULL with no default:  it is
--    meant to be set deliberately, once, per branch — not invented by
--    code the first time it is needed. series_type exists for the same
--    reason valuation_basis names codes it does not yet use: this is the
--    system''s first document-numbering table, and Sales Invoice numbering
--    is a plain row-count today (see routes/salesInvoices.ts) — a
--    candidate to move onto this same table later without another one
--    being built.
--
-- Run after migration_043_stock_transfers.sql. Statements stand alone —
-- run them one at a time.
--
-- Idempotent: safe to re-run.


-- 1. Rename 1305 to what it now is one half of. Cosmetic — no route reads
--    account_name, only account_code — but a receivable that still says
--    "Inter-Branch Account" next to a payable of the same vintage invites
--    exactly the confusion a distinct name avoids.
UPDATE accounts SET account_name = ''Inter-Branch Receivable''
 WHERE account_code = ''1305'' AND account_name = ''Inter-Branch Account'';

UPDATE coa_templates SET account_name = ''Inter-Branch Receivable''
 WHERE account_code = ''1305'' AND account_name = ''Inter-Branch Account'';


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
--    the column itself.
ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS itc_eligibility VARCHAR(20) NOT NULL DEFAULT ''FULL'';

ALTER TABLE branches
  DROP CONSTRAINT IF EXISTS branches_itc_eligibility_ck;

ALTER TABLE branches
  ADD CONSTRAINT branches_itc_eligibility_ck
  CHECK (itc_eligibility IN (''FULL'', ''RESTRICTED'', ''PROPORTIONATE''));


-- 5. The frozen copy on the transfer.
ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS to_branch_itc_eligibility VARCHAR(20) NOT NULL DEFAULT ''FULL'';

ALTER TABLE stock_transfers
  DROP CONSTRAINT IF EXISTS stock_transfers_itc_eligibility_ck;

ALTER TABLE stock_transfers
  ADD CONSTRAINT stock_transfers_itc_eligibility_ck
  CHECK (to_branch_itc_eligibility IN (''FULL'', ''RESTRICTED'', ''PROPORTIONATE''));


-- 6. Valuation basis, per line.
ALTER TABLE stock_transfer_lines
  ADD COLUMN IF NOT EXISTS valuation_basis VARCHAR(20) NOT NULL DEFAULT ''SECOND_PROVISO'';

ALTER TABLE stock_transfer_lines
  DROP CONSTRAINT IF EXISTS stock_transfer_lines_valuation_basis_ck;

ALTER TABLE stock_transfer_lines
  ADD CONSTRAINT stock_transfer_lines_valuation_basis_ck
  CHECK (valuation_basis IN (''SECOND_PROVISO'', ''OMV'', ''NINETY_PCT'', ''LIKE_KIND'', ''RULE_30''));


-- 7. Let a business partner represent a branch.
--    Same list migration_034 last extended, plus BRANCH.
ALTER TABLE business_partners
  DROP CONSTRAINT IF EXISTS business_partners_bp_type_check;

ALTER TABLE business_partners
  ADD CONSTRAINT business_partners_bp_type_check
  CHECK (bp_type IN (''CUSTOMER'', ''VENDOR'', ''ITEM'', ''PREPAID'', ''ASSET'', ''BRANCH''));


-- 8. The invoice/document numbering series.
CREATE TABLE IF NOT EXISTS document_number_series (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id),
  branch_id         UUID NOT NULL REFERENCES branches(id),
  series_type       VARCHAR(20) NOT NULL,
  -- "2026-27" style — the label that appears in the number, not a date.
  financial_year    VARCHAR(9) NOT NULL,
  prefix            VARCHAR(20) NOT NULL,
  next_number       INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT document_number_series_type_ck CHECK (series_type IN (''STOCK_TRANSFER'')),
  CONSTRAINT document_number_series_next_ck CHECK (next_number >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS document_number_series_uq
  ON document_number_series (organization_id, branch_id, series_type, financial_year);


-- Verify:
--   SELECT account_code, account_name FROM accounts
--    WHERE account_code IN (''1305'',''2105'') ORDER BY account_code;
--   -- expect 1305 Inter-Branch Receivable, 2105 Inter-Branch Payable,
--   -- same row count for each
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = ''business_partners_bp_type_check'';
--   -- expect ... ''BRANCH''::... at the end of the ARRAY
--
--   SELECT column_name, column_default FROM information_schema.columns
--    WHERE table_name = ''branches'' AND column_name = ''itc_eligibility'';
--   -- expect default ''FULL''::character varying
--
--   SELECT table_name FROM information_schema.tables
--    WHERE table_name = ''document_number_series'';
'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green