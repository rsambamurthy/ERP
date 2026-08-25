$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Seed fix 2: costing method is set once' -ForegroundColor Cyan

# Pure ASCII. Every non-ASCII character travels as ~U+XXXX~ and is decoded
# below, so this behaves identically whether PowerShell reads it as UTF-8 or
# as Windows-1252. No byte-order mark needed.
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
  # A PowerShell here-string DROPS the newline immediately before its closing
  # '@, so the text arrives here one byte short of the source file. Every file
  # this delivers ends with exactly one newline (git shows the alternative as
  # "\ No newline at end of file"), so put it back rather than publish hashes
  # that can never match.
  $body = (Decode $text).Replace([string][char]13, '')
  if (-not $body.EndsWith("`n")) { $body += "`n" }
  [IO.File]::WriteAllText($p, $body, (New-Object Text.UTF8Encoding $false))
  Write-Host "  wrote  $rel"
}

function Edit-FileText($rel, $old, $new) {
  $p = Join-Path $repo $rel
  if (-not (Test-Path -LiteralPath $p)) { throw "Missing file: $rel" }
  $old = (Decode $old).Replace([string][char]13, '')
  $new = (Decode $new).Replace([string][char]13, '')
  $t = [IO.File]::ReadAllText($p).Replace([string][char]13, '')
  $i = $t.IndexOf($old)
  if ($i -lt 0) {
    # Already applied? Only conclude that when the ANCHOR IS GONE. Testing
    # "does the file contain the replacement" on its own is wrong whenever the
    # replacement is short or blank - a bare newline is in every file, so the
    # edit silently skips and the file ends up one line different from the
    # source it was generated from.
    if ($t.Contains($new)) { Write-Host "  skip   $rel"; return }
    throw "Anchor not found in $rel."
  }
  if ($t.IndexOf($old, $i + 1) -ge 0) { throw "Anchor is not unique in $rel." }
  $t = $t.Substring(0, $i) + $new + $t.Substring($i + $old.Length)
  [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
  Write-Host "  edit   $rel"
}
$o0 = @'
  must(await call("POST", "/items/costing-method",
    { costingMethod: plan.costingMethod }, token), "costing method");
  ok(`costing method ${plan.costingMethod}`);
'@
$n0 = @'
  // Set ONCE, permanently: every ItemStock and StockLot row that follows is
  // computed under it, so the route refuses to change it and there is no
  // defined way to migrate an org's stock history from one method to the
  // other. Read before writing, or a second run dies on a 409.
  const cur = must(await call("GET", "/items/costing-method", undefined, token), "read costing method");
  const already: string | null = cur?.data?.costingMethod ?? null;
  if (already === plan.costingMethod) {
    had(`costing method ${plan.costingMethod}`);
  } else if (already) {
    throw new Error(
      `ORG-${plan.key} is on ${already} but this plan needs ${plan.costingMethod}, and the ` +
      `costing method cannot be changed once set. Register a fresh organisation under a ` +
      `different TEST_ORG_${plan.key}_EMAIL, or delete this one from the database.`);
  } else {
    must(await call("POST", "/items/costing-method",
      { costingMethod: plan.costingMethod }, token), "costing method");
    ok(`costing method ${plan.costingMethod}`);
  }
'@
Edit-FileText 'backend/tests/seed.ts' $o0 $n0
$o1 = @'
      // A repeat of the same change is not an error worth stopping for.
'@
$n1 = @'

'@
Edit-FileText 'backend/tests/seed.ts' $o1 $n1
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green