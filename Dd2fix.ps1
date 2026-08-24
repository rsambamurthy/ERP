$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Fix: narrowing guard in gstReports...' -ForegroundColor Cyan

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
      continue;
    }

    for (const [rate, acc] of byRate) {
      b2b.push({
        gstin: tr.toGstin,
'@
$n0 = @'
      continue;
    }

    // Redundant at runtime -- the guard at the top of the loop already
    // rejected a non-cancelled transfer missing either of these. It is here
    // because TypeScript cannot carry that narrowing across the cancelled
    // branch's `continue`, and asserting with `!` would silence a nullability
    // the compiler is right about rather than proving it wrong.
    if (!tr.toGstin || !tr.documentNumber) continue;

    for (const [rate, acc] of byRate) {
      b2b.push({
        gstin: tr.toGstin,
'@
Edit-FileText 'backend/src/lib/gstReports.ts' $o0 $n0
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green