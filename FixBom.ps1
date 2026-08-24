$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Repairing mojibake from the missing BOM...' -ForegroundColor Cyan

# Built from character codes so this script contains no non-ASCII of its
# own -- it cannot be corrupted by the same bug it exists to fix.
$pairs = @(
  @{ bad = [string]([char]0x00E2 + [char]0x20AC + [char]0x201D); good = [string][char]0x2014 }
  @{ bad = [string]([char]0x00E2 + [char]0x201A + [char]0x00B9); good = [string][char]0x20B9 }
  @{ bad = [string]([char]0x00E2 + [char]0x2020 + [char]0x0090); good = [string][char]0x2190 }
  @{ bad = [string]([char]0x00E2 + [char]0x02C6 + [char]0x2019); good = [string][char]0x2212 }
  @{ bad = [string]([char]0x00E2 + [char]0x201D + [char]0x20AC); good = [string][char]0x2500 }
)

$files = @(
  'backend/src/lib/transferValuation.ts'
  'backend/src/lib/transferPosting.ts'
  'db/migration_044_transfer_valuation.sql'
  'db/migration_045_transfer_transit_clearing.sql'
  'backend/prisma/schema.prisma'
)

foreach ($rel in $files) {
  $p = Join-Path $repo $rel
  if (-not (Test-Path -LiteralPath $p)) { Write-Host "  absent $rel"; continue }
  $t = [IO.File]::ReadAllText($p)
  $n = 0
  foreach ($pr in $pairs) {
    while ($t.Contains($pr.bad)) { $t = $t.Replace($pr.bad, $pr.good); $n++ }
  }
  if ($n -gt 0) {
    [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
    Write-Host ("  fixed  {0}  ({1} replacement pass(es))" -f $rel, $n)
  } else {
    Write-Host "  clean  $rel"
  }
}

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green