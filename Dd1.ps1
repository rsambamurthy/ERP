$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Phase D-d: migrations 047 and 048...' -ForegroundColor Cyan

# This script is pure ASCII. Every non-ASCII character travels as ~U+XXXX~
# and is decoded below, so it behaves identically whether PowerShell reads it
# as UTF-8 or as Windows-1252. No byte-order mark needed.
$decoder = [Text.RegularExpressions.MatchEvaluator] {
  param($m)
  [char]::ConvertFromUtf32([Convert]::ToInt32($m.Groups[1].Value, 16))
}
function Decode($s) {
  return [Text.RegularExpressions.Regex]::Replace($s, '~U\+([0-9A-Fa-f]{4,6})~', $decoder)
}

function Set-FileText($rel, $text) {
  $p = Join-Path $repo $rel
  $dir = Split-Path $p -Parent
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [IO.File]::WriteAllText($p, (Decode $text).Replace([string][char]13, ''), (New-Object Text.UTF8Encoding $false))
  Write-Host "  wrote  $rel"
}
$f0 = @'
-- GST snapshots on branch transfers ~U+2014~ the same fix migration_031 made for
-- sales invoices, applied to the document type Phase D just introduced.
--
-- THE DEFECT
--
-- A taxable branch transfer is reported in the sending branch's GSTR-1 as a
-- B2B supply, with the RECEIVING branch as the counterparty. Everything that
-- identifies that counterparty ~U+2014~ its GSTIN, its name, its state code, which
-- is the place of supply ~U+2014~ lives on the branches table and is read live.
--
-- So correcting a branch's GSTIN today would silently restate every transfer
-- ever sent to it, including periods already filed with the GSTN. Changing
-- its state code is worse: the place of supply moves, and a period filed as
-- IGST can come back reading CGST+SGST.
--
-- This is not hypothetical for branches specifically. A branch's GSTIN is
-- entered by hand at setup and is exactly the sort of field that gets
-- corrected a month later, once somebody looks at the registration
-- certificate properly.
--
-- migration_031 put it plainly and it is still the rule: a tax document must
-- report the facts as they stood when it was raised.
--
-- WHY NOW RATHER THAN LATER
--
-- These columns can only be populated correctly at dispatch. Adding them
-- after real transfers exist means backfilling from today's branch masters ~U+2014~
-- which is precisely the wrong data, and indistinguishable from right until
-- someone re-registers. Nothing has been dispatched yet, so every row this
-- schema will ever hold can carry a true snapshot.
--
-- WHAT IS *NOT* SNAPSHOTTED, AND WHY IT DOES NOT NEED TO BE
--
-- The tax itself. stock_transfer_lines already stores taxable_value,
-- gst_rate and the CGST/SGST/IGST split as posted, so the amounts on a
-- filed return cannot drift no matter what happens to any master.
--
-- CORRECTION: an earlier version of this header also claimed the HSN was
-- "already snapshotted in effect", on the grounds that a taxable dispatch is
-- refused when the item has none. That reasoning was wrong ~U+2014~ the exposure
-- was never a NULL HSN but a CHANGED one, and the HSN summary was in fact
-- read live from the item master. migration_048 fixes it properly.
--
-- Run after migration_046_branch_partner_control.sql. Statements stand
-- alone ~U+2014~ run them one at a time.
--
-- Idempotent: safe to re-run.


-- 1 to 5. Sized to match branches: gstin VARCHAR(15), state_code
--    VARCHAR(2), name VARCHAR(200). All nullable, because an untaxed
--    transfer between two unregistered branches has no GSTIN to record and
--    is not reported in GSTR-1 at all.

ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS from_gstin VARCHAR(15);

ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS from_state_code VARCHAR(2);

ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS to_gstin VARCHAR(15);

ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS to_state_code VARCHAR(2);

-- The receiver name that appears on the return. A branch gets renamed far
-- more casually than it gets re-registered, so this is the likeliest of all
-- of them to drift.
ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS to_branch_name VARCHAR(200);


-- 6. A TAXABLE transfer must carry the identity it was raised against.
--    Untaxed ones may leave all of it null: they are not a supply, appear in
--    no return, and there is nothing to freeze.
--
--    Dropped first because Postgres has no ADD CONSTRAINT IF NOT EXISTS,
--    and a DO block would be split by the console on its semicolons.
ALTER TABLE stock_transfers
  DROP CONSTRAINT IF EXISTS stock_transfers_gst_snapshot_ck;

ALTER TABLE stock_transfers
  ADD CONSTRAINT stock_transfers_gst_snapshot_ck CHECK (
    tax_treatment <> 'TAXABLE'
    OR (from_gstin IS NOT NULL
        AND to_gstin IS NOT NULL
        AND to_state_code IS NOT NULL
        AND to_branch_name IS NOT NULL)
  );


-- Verify:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'stock_transfers'
--      AND column_name IN ('from_gstin','from_state_code','to_gstin',
--                          'to_state_code','to_branch_name')
--    ORDER BY column_name;
--   -- expect all five
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'stock_transfers_gst_snapshot_ck';
--
--   SELECT count(*) FROM stock_transfers WHERE tax_treatment = 'TAXABLE';
--   -- expect 0 ~U+2014~ nothing taxable has been dispatched yet, which is why
--   -- this migration can be added without a backfill
'@
Set-FileText 'db/migration_047_transfer_gst_snapshots.sql' $f0
$f1 = @'
-- Line-level GST snapshots on branch transfers.
--
-- migration_047 froze WHO the counterparty was. This freezes WHAT was
-- supplied, which is the other half of the same defect and which
-- migration_047's own header got wrong.
--
-- WHAT 047 CLAIMED, AND WHY IT WAS WRONG
--
-- It said the HSN "is likewise already snapshotted in effect", reasoning
-- that a taxable dispatch is refused when the item has no HSN, so the
-- column cannot be null at report time. That is true and beside the point.
-- The exposure was never a NULL HSN ~U+2014~ it was a CHANGED one.
--
-- lib/gstReports.ts builds the HSN summary for a transfer from
-- items.hsn_code, items.name and items.uom, read live. Correct a pump's HSN
-- from 8413 to 8414 in September and August's filed GSTR-1 re-runs reporting
-- that taxable value under 8414. sales_invoice_lines snapshots all three
-- columns for exactly this reason (migration_031); stock_transfer_lines did
-- not, so the one document type migration_047 was written about was the one
-- still exposed.
--
-- WHY THE TAX FIGURES WERE NEVER AT RISK
--
-- taxable_value, gst_rate and the CGST/SGST/IGST split are already stored on
-- the line as posted. Only the CLASSIFICATION ~U+2014~ which HSN the value is
-- reported under, and the description and unit beside it ~U+2014~ came from the
-- master.
--
-- Nothing has been dispatched yet, so every row this schema will ever hold
-- can carry a true snapshot rather than a backfill from today's masters.
--
-- Run after migration_047_transfer_gst_snapshots.sql. Statements stand
-- alone ~U+2014~ run them one at a time.
--
-- Idempotent: safe to re-run.


-- 1 to 3. Sized to match items: hsn_code VARCHAR(10), name VARCHAR(200),
--    uom VARCHAR(20). Nullable, because an untaxed transfer appears in no
--    return and has nothing to freeze.

ALTER TABLE stock_transfer_lines
  ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(10);

ALTER TABLE stock_transfer_lines
  ADD COLUMN IF NOT EXISTS item_name VARCHAR(200);

ALTER TABLE stock_transfer_lines
  ADD COLUMN IF NOT EXISTS uom VARCHAR(20);


-- Deliberately NO CHECK constraint tying these to tax_treatment.
--
-- The obvious one ~U+2014~ "a taxable line must have an HSN" ~U+2014~ would have to reach
-- across to stock_transfers.tax_treatment, and a CHECK cannot see another
-- table. A trigger could, but a trigger that fires on every transfer line to
-- restate a rule the route already enforces (a taxable dispatch is refused
-- outright when an item has no HSN) buys nothing and hides the enforcement
-- somewhere nobody reading the route will look.


-- Verify:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'stock_transfer_lines'
--      AND column_name IN ('hsn_code','item_name','uom')
--    ORDER BY column_name;
--   -- expect all three
--
--   SELECT count(*) FROM stock_transfer_lines;
--   -- expect 0 ~U+2014~ nothing dispatched yet, which is why no backfill is needed
'@
Set-FileText 'db/migration_048_transfer_line_snapshots.sql' $f1
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green