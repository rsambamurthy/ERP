$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Restoring three blank lines lost in the paste...' -ForegroundColor Cyan

$rel = 'backend/src/routes/stockTransfers.ts'
$p = Join-Path $repo $rel
$t = [IO.File]::ReadAllText($p).Replace([string][char]13, '')
$nl = [string][char]10

$pairs = @(
  @{ old = "  };" + $nl + "}" + $nl + "// "
     new = "  };" + $nl + "}" + $nl + $nl + "// " },
  @{ old = "});" + $nl + "// POST /stock-transfers/:id/receive"
     new = "});" + $nl + $nl + "// POST /stock-transfers/:id/receive" }
)

foreach ($pr in $pairs) {
  if ($t.Contains($pr.new)) { Write-Host '  already present'; continue }
  $c = ([regex]::Matches($t, [regex]::Escape($pr.old))).Count
  if ($c -ne 1) { throw "Expected 1 match, found $c" }
  $t = $t.Replace($pr.old, $pr.new)
  Write-Host '  restored a blank line'
}
if (-not $t.EndsWith($nl)) { $t = $t + $nl; Write-Host '  restored trailing newline' }

[IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
Write-Host ("  now {0} chars" -f $t.Length)
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green