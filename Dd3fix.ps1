$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Phase D-d part 3 (retry): remaining route edits...' -ForegroundColor Cyan

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
$o0 = @'
{ id: true, sku: true, name: true, itemKind: true, stockAccountId: true
'@
$n0 = @'
{ id: true, sku: true, name: true, uom: true, itemKind: true, stockAccountId: true
'@
Edit-FileText 'backend/src/routes/stockTransfers.ts' $o0 $n0
$o1 = @'
type It = { id: string; sku: string; name: string; itemKind: string;
'@
$n1 = @'
type It = { id: string; sku: string; name: string; uom: string; itemKind: string;
'@
Edit-FileText 'backend/src/routes/stockTransfers.ts' $o1 $n1
$o2 = @'
          toBranchItcEligibility: to.itcEligibility,
'@
$n2 = @'
          toBranchItcEligibility: to.itcEligibility,
          // Frozen now, because this is what the return will report. Only
          // on a taxable transfer: an untaxed one is not a supply and
          // migration_047's CHECK expects these to stay null for it.
          ...(taxable ? {
            fromGstin: from.gstin, fromStateCode: from.stateCode,
            toGstin: to.gstin, toStateCode: to.stateCode,
            toBranchName: to.name.slice(0, 200),
          } : {}),
'@
Edit-FileText 'backend/src/routes/stockTransfers.ts' $o2 $n2
$o3 = @'
              taxableValue: v.taxableValue, valuationBasis: v.valuationBasis,
'@
$n3 = @'
              // Frozen for the HSN summary ~U+2014~ see migration_048.
              hsnCode: it.hsnCode, itemName: it.name.slice(0, 200), uom: it.uom,
              taxableValue: v.taxableValue, valuationBasis: v.valuationBasis,
'@
Edit-FileText 'backend/src/routes/stockTransfers.ts' $o3 $n3
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green