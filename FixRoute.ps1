$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Repairing stockTransfers.ts (missing BOM on Db3c1-3)...' -ForegroundColor Cyan

# Pure ASCII by construction: every special character is built from its
# code point, so this script cannot itself be corrupted by the bug.
$pairs = @(
  @{ bad = [string]([char]0x00E2 + [char]0x20AC + [char]0x201D); good = [string][char]0x2014 }
  @{ bad = [string]([char]0x00E2 + [char]0x201D + [char]0x20AC); good = [string][char]0x2500 }
)

$rel = 'backend/src/routes/stockTransfers.ts'
$p = Join-Path $repo $rel
$t = [IO.File]::ReadAllText($p)
$n = 0
foreach ($pr in $pairs) {
  while ($t.Contains($pr.bad)) { $t = $t.Replace($pr.bad, $pr.good); $n++ }
}
if ($n -gt 0) {
  [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
  Write-Host ('  fixed  {0}' -f $rel)
} else { Write-Host '  clean  nothing to repair' }

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green