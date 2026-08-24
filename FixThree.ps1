$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Phase D cleanup: three files back in line...' -ForegroundColor Cyan

# Pure ASCII. Non-ASCII travels as ~U+XXXX~ and is decoded here, so this
# script behaves identically whether PowerShell reads it as UTF-8 or as
# Windows-1252. No byte-order mark needed.
$decoder = [Text.RegularExpressions.MatchEvaluator] {
  param($m)
  [char]::ConvertFromUtf32([Convert]::ToInt32($m.Groups[1].Value, 16))
}
function Decode($s) {
  return [Text.RegularExpressions.Regex]::Replace($s, '~U\+([0-9A-Fa-f]{4,6})~', $decoder)
}

function Edit-FileText($rel, $old, $new) {
  $p = Join-Path $repo $rel
  if (-not (Test-Path -LiteralPath $p)) { throw "Missing file: $rel" }
  $old = (Decode $old).Replace([string][char]13, '')
  $new = (Decode $new).Replace([string][char]13, '')
  $t = [IO.File]::ReadAllText($p).Replace([string][char]13, '')
  if ($t.Contains($new)) { Write-Host "  skip   $rel"; return }
  $i = $t.IndexOf($old)
  if ($i -lt 0) { throw "Anchor not found in $rel." }
  if ($t.IndexOf($old, $i + 1) -ge 0) { throw "Anchor is not unique in $rel." }
  $t = $t.Substring(0, $i) + $new + $t.Substring($i + $old.Length)
  [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
  Write-Host "  edit   $rel"
}

# 1. One em-dash left mangled in transferValuation.ts by Db3b (no BOM).
#    -join, NOT '+': PowerShell's + on two [char] does integer arithmetic.
$mangled = -join ([char]0x00E2, [char]0x20AC, [char]0x201D)
$rel = 'backend/src/lib/transferValuation.ts'
$p = Join-Path $repo $rel
$t = [IO.File]::ReadAllText($p).Replace([string][char]13, '')
$n = ([regex]::Matches($t, [regex]::Escape($mangled))).Count
if ($n -gt 0) {
  $t = $t.Replace($mangled, [string][char]0x2014)
  [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
  Write-Host ("  fixed  {0} ({1} mangled em-dash)" -f $rel, $n)
} else { Write-Host "  clean  $rel" }

# 2 and 3. The identity wording Db2c never reached -- it threw at edit 4.
$o0 = @'
--    different states' books ~U+2014~ there is no single entity in which they
--    could net at all until consolidation. They are designed to sum to
--    zero across the organisation, not within one branch's trial balance.
--
--    Once Phase D posts, the reconciliation identity at any date is:
--
--        1305 (Receivable) + 1304 (Stock in Transit) - 2106 (Payable) = 0
--
--    1304 is in the sum because dispatch and receipt land in different
--    states' books on different dates ~U+2014~ see migration_043's header on why
--    the account exists at all. A break in this identity is a real
--    posting error, not a timing difference; migration_043's plain
--    1304-only check only holds for the untaxed, same-GSTIN case this
--    migration does not touch.
--
--    Same population as 1305: wherever 1305 already exists is where a
--    taxable transfer can eventually be posted, so that is where its
--    payable counterpart belongs too.
'@
$n0 = @'
--    different states' books ~U+2014~ there is no single entity in which they
--    could net at all until consolidation. They are designed to sum to
--    zero across the organisation, not within one branch's trial balance.
--
--    Once Phase D posts, taking 2106 as a positive credit balance:
--
--        1305 + 1304 - 2106 = invoice value of transfers dispatched
--                             but NOT YET RECEIVED
--
--    so it is ZERO whenever nothing is on a lorry, and otherwise equals
--    exactly what is on one ~U+2014~ checkable against the transfers table. The
--    two halves arrive at different moments because the tax is incurred at
--    dispatch (section 12, on issue of the invoice) while the goods are
--    still the sender's: 1305 carries the tax alone and 1304 the cost,
--    until receipt moves the cost half across.
--
--    1304 is in the sum because dispatch and receipt land in different
--    states' books on different dates ~U+2014~ see migration_043's header on why
--    the account exists at all. Anything left after subtracting the
--    genuinely-in-transit transfers is a posting error.
--
--    Same population as 1305: wherever 1305 already exists is where a
--    taxable transfer can eventually be posted, so that is where its
--    payable counterpart belongs too.
'@
Edit-FileText 'db/migration_044_transfer_valuation.sql' $o0 $n0
$o1 = @'
-- 1304 on its books forever, or the receiving branch has to credit 1304 ~U+2014~
-- an account belonging to the other registration's balance sheet, which is
-- exactly the thing distinct-person treatment forbids.
--
-- With all three posted, at any date:
--
--     1305 (Receivable) + 1304 (Stock in Transit) - 2106 (Payable) = 0
--
-- In transit:  1305 = tax,        1304 = cost, 2106 = 0          -> 0
-- Received:    1305 = cost + tax, 1304 = 0,    2106 = cost + tax -> 0
--
-- THE UNTAXED CASE IS NOT CHANGED
--
-- A same-GSTIN transfer is one legal person with one balance sheet, and
'@
$n1 = @'
-- 1304 on its books forever, or the receiving branch has to credit 1304 ~U+2014~
-- an account belonging to the other registration's balance sheet, which is
-- exactly the thing distinct-person treatment forbids.
--
-- With all three posted, taking 2106 as a positive credit balance:
--
--     1305 + 1304 - 2106 = invoice value of transfers dispatched
--                          but NOT YET RECEIVED
--
-- In transit:  1305 = tax,        1304 = cost, 2106 = 0          -> cost + tax
-- Received:    1305 = cost + tax, 1304 = 0,    2106 = cost + tax -> 0
--
-- Zero whenever nothing is on a lorry, and otherwise exactly what is on one.
--
-- THE UNTAXED CASE IS NOT CHANGED
--
-- A same-GSTIN transfer is one legal person with one balance sheet, and
'@
Edit-FileText 'db/migration_045_transfer_transit_clearing.sql' $o1 $n1

foreach ($f in @('backend/src/lib/transferValuation.ts',
                 'db/migration_044_transfer_valuation.sql',
                 'db/migration_045_transfer_transit_clearing.sql')) {
  $x = [IO.File]::ReadAllText((Join-Path $repo $f)).Replace([string][char]13,'')
  "  {0,6} chars  {1}" -f $x.Length, $f
}
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green