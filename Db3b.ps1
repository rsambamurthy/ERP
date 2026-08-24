$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Phase D-b: valuation lineValue override...' -ForegroundColor Cyan

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
$o0 = @'
//   - it keeps the clearing accounts reconcilable. Stock moves at cost
//     through 1304/1305/2106 (see migration_044), so when the invoice value
//     equals cost, the identity 1305 + 1304 - 2106 = 0 holds on every date.
//     An invoice value different from cost would put an internal margin into
'@
$n0 = @'
//   - it keeps the clearing accounts reconcilable. Stock moves at cost
//     through 1304/1305/2106 (see migration_044), so when the invoice value
//     equals cost, 1305 + 1304 - 2106 comes to exactly the value of what is
//     still on a lorry, and to zero when nothing is.
//     An invoice value different from cost would put an internal margin into
'@
Edit-FileText 'backend/src/lib/transferValuation.ts' $o0 $n0
$o1 = @'
  quantity: number;
  unitCost: number;
}

export interface BlockedLine {
'@
$n1 = @'
  quantity: number;
  unitCost: number;
  // What consumeStock actually took out of inventory, when the caller knows
  // it. Under FIFO that is summed across lots at their own costs and
  // unitCost is the derived quotient totalCost/quantity — so recomputing
  // quantity * unitCost is a SECOND route to the same figure, equal only by
  // floating-point luck. The ledger credit and the tax base must come from
  // one number, not two that usually agree, or a dispatch can fail its own
  // balance check for a paisa nobody can find.
  lineValue?: number;
}

export interface BlockedLine {
'@
Edit-FileText 'backend/src/lib/transferValuation.ts' $o1 $n1
$o2 = @'
  const lineValue = round2(line.quantity * line.unitCost);
'@
$n2 = @'
  const lineValue = round2(line.lineValue ?? line.quantity * line.unitCost);
'@
Edit-FileText 'backend/src/lib/transferValuation.ts' $o2 $n2
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green