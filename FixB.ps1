$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'FixB - runner engine fixes (3 in assertions.ts, 2 in runCases.ts, 1 fixture)' -ForegroundColor Cyan

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

# A here-string DROPS the newline immediately before its closing '@. For a
# replacement that is invisible - both sides lose it and the arithmetic still
# works - but for a DELETION the removed line's own newline survives and leaves
# a blank line behind. So every payload ends with a ~EOT~ sentinel that is
# stripped here, which makes the trailing newline explicit either way.
function Text($s) {
  $d = Decode $s
  $k = $d.LastIndexOf('~EOT~')
  if ($k -ge 0) { $d = $d.Substring(0, $k) }
  return $d.Replace([string][char]13, '')
}

function Set-FileText($rel, $text) {
  $p = Join-Path $repo $rel
  $dir = Split-Path $p -Parent
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [IO.File]::WriteAllText($p, (Text $text), (New-Object Text.UTF8Encoding $false))
  Write-Host "  wrote  $rel"
}

function Edit-FileText($rel, $old, $new) {
  $p = Join-Path $repo $rel
  if (-not (Test-Path -LiteralPath $p)) { throw "Missing file: $rel" }
  $old = Text $old
  $new = Text $new
  $t = [IO.File]::ReadAllText($p).Replace([string][char]13, '')
  $i = $t.IndexOf($old)
  if ($i -lt 0) {
    # Already applied? Only conclude that when the ANCHOR IS GONE.
    if ($t.Contains($new)) { Write-Host "  skip   $rel"; return }
    throw "Anchor not found in $rel."
  }
  if ($t.IndexOf($old, $i + 1) -ge 0) { throw "Anchor is not unique in $rel." }
  $t = $t.Substring(0, $i) + $new + $t.Substring($i + $old.Length)
  [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
  Write-Host "  edit   $rel"
}
$o0 = @'
    const m = /^(.*?)\s*(>=|=)\s*(.+)$/s.exec(body);
    if (!m) throw new AssertionError(`cannot parse: ${text}`);
    const [, expr, op, wantRaw] = m;
    const want = substitute(wantRaw.trim(), ctx);
    const actual = evalPath(root, expr);
~EOT~
'@
$n0 = @'
    // WHITESPACE around the operator is required, and that is the whole point:
    // a bracket filter writes id={{x}} with no spaces, so a non-greedy split on
    // a bare "=" tore the expression apart at the filter instead of at the
    // comparison. Every assertion in the pack writes " = ", so demanding the
    // spaces disambiguates the two completely.
    const m = /^(.*?)\s+(>=|=)\s+(.+)$/s.exec(body);
    if (!m) throw new AssertionError(`cannot parse (an assertion needs spaces around = or >=): ${text}`);
    const [, exprRaw, op, wantRaw] = m;
    const want = substitute(wantRaw.trim(), ctx);
    // The LEFT side needs substituting too. Captures did it; this did not, so
    // {{DEP-01.assetId}} inside a filter stayed literal and matched nothing.
    const expr = substitute(exprRaw.trim(), ctx);
    const actual = evalPath(root, expr);
~EOT~
'@
Edit-FileText 'backend/tests/assertions.ts' $o0 $n0
$o1 = @'
    const q = /^sql\s+"([\s\S]*?)"\s*(capture\s+(\w+)|=\s*(.+))?$/.exec(text);
~EOT~
'@
$n1 = @'
    // The operator is matched HERE rather than sniffed off the front of the
    // expected value, which is what made `sql "..." >= 2` unparseable.
    const q = /^sql\s+"([\s\S]*?)"\s*(?:capture\s+(\w+)|(>=|=)\s*(.+))?$/.exec(text);
~EOT~
'@
Edit-FileText 'backend/tests/assertions.ts' $o1 $n1
$o2 = @'
    if (q[3]) { ctx.captures[q[3]] = value; return `captured ${q[3]} = ${value}`; }
    const wantText = substitute(String(q[4] ?? "").trim(), ctx);
    const opGe = wantText.startsWith(">=");
    const want = opGe ? wantText.slice(2).trim() : wantText;
~EOT~
'@
$n2 = @'
    if (q[2]) { ctx.captures[q[2]] = value; return `captured ${q[2]} = ${value}`; }
    const opGe = q[3] === ">=";
    const want = substitute(String(q[4] ?? "").trim(), ctx);
~EOT~
'@
Edit-FileText 'backend/tests/assertions.ts' $o2 $n2
$o3 = @'
      if (periods) {
        for (const p of periods) {
          if (postedPeriods.has(p)) { ctx.reply = postedPeriods.get(p)!; continue; }
          const reply = await request(step.login, "POST", path, { periodStart: p });
          ctx.reply = reply;
          // A 409 is a legitimate expectation (DEP-17) ~U+2014~ only record a success.
          if (reply.status === 200) postedPeriods.set(p, reply);
          else if (step.status === 200) {
~EOT~
'@
$n3 = @'
      if (periods) {
        // A step that expects a refusal has to make the call. Reusing the
        // recorded success from the registry handed it a 200 and the assertion
        // then had no error message to read - which defeated the two cases
        // whose entire purpose is to prove a period cannot be posted twice.
        const wantsSuccess = step.status == null || step.status === 200;
        for (const p of periods) {
          if (wantsSuccess && postedPeriods.has(p)) { ctx.reply = postedPeriods.get(p)!; continue; }
          const reply = await request(step.login, "POST", path, { periodStart: p });
          ctx.reply = reply;
          if (reply.status === 200) postedPeriods.set(p, reply);
          else if (wantsSuccess) {
~EOT~
'@
Edit-FileText 'backend/tests/runCases.ts' $o3 $n3
$o4 = @'
      if (step.status != null && ctx.reply && ctx.reply.status !== step.status && !periods) {
~EOT~
'@
$n4 = @'
      if (step.status != null && ctx.reply && ctx.reply.status !== step.status) {
~EOT~
'@
Edit-FileText 'backend/tests/runCases.ts' $o4 $n4
$o5 = @'
  VENDOR_TN:  { org: "A", kind: "partner", match: "Sundar Systems" },
  VENDOR_USD: { org: "A", kind: "partner", match: "Overseas Supplies Inc" },
~EOT~
'@
$n5 = @'
  VENDOR_TN:  { org: "A", kind: "partner", match: "Sundar Systems" },
  // The same name, resolved in ORG-B. A business partner id belongs to one
  // organisation and is simply not found in another, so a case that runs as
  // ORG-B cannot borrow ORG-A's vendor ~U+2014~ it needs its own fixture, even though
  // the seed creates the identical three partners in both.
  VENDOR_TN_B: { org: "B", kind: "partner", match: "Sundar Systems" },
  VENDOR_USD: { org: "A", kind: "partner", match: "Overseas Supplies Inc" },
~EOT~
'@
Edit-FileText 'backend/tests/harness.ts' $o5 $n5
Write-Host ''
foreach ($f in 'backend/tests/assertions.ts','backend/tests/runCases.ts',
               'backend/tests/harness.ts') {
  $h = (Get-FileHash (Join-Path $repo $f) -Algorithm SHA256).Hash
  Write-Host ("  {0,-32} {1}" -f (Split-Path $f -Leaf), $h)
}
Write-Host ''
Write-Host 'Done. FixC.ps1 next - it carries the reworked case pack.' -ForegroundColor Green