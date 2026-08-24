$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Repairing stockTransfers.ts (take 2)...' -ForegroundColor Cyan

# -join, NOT '+'. PowerShell's + on two [char] operands does integer
# arithmetic, so [char]0x00E2 + [char]0x20AC is 8590, not a two-character
# string. That is why the previous attempt matched nothing.
$emBad  = -join ([char]0x00E2, [char]0x20AC, [char]0x201D)
$emGood = [string][char]0x2014
$bxBad  = -join ([char]0x00E2, [char]0x201D, [char]0x20AC)
$bxGood = [string][char]0x2500

Write-Host ("  searching for: {0} and {1}" -f `
  (($emBad.ToCharArray() | ForEach-Object { '{0:X4}' -f [int]$_ }) -join ' '), `
  (($bxBad.ToCharArray() | ForEach-Object { '{0:X4}' -f [int]$_ }) -join ' '))

$rel = 'backend/src/routes/stockTransfers.ts'
$p = Join-Path $repo $rel
$t = [IO.File]::ReadAllText($p)

$a = ([regex]::Matches($t, [regex]::Escape($emBad))).Count
$b = ([regex]::Matches($t, [regex]::Escape($bxBad))).Count
Write-Host ("  found: {0} em-dash, {1} box" -f $a, $b)

$t = $t.Replace($bxBad, $bxGood)
$t = $t.Replace($emBad, $emGood)
[IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))

$after = [IO.File]::ReadAllText($p)
Write-Host ("  now: {0} em-dash, {1} box, {2} chars" -f `
  ([regex]::Matches($after, [string][char]0x2014)).Count, `
  ([regex]::Matches($after, [string][char]0x2500)).Count, `
  $after.Length)

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green