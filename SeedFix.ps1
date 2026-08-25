$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Seed fixes: chart repair, ordering, policy guard' -ForegroundColor Cyan

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
  if ($t.Contains($new)) { Write-Host "  skip   $rel"; return }
  $i = $t.IndexOf($old)
  if ($i -lt 0) { throw "Anchor not found in $rel." }
  if ($t.IndexOf($old, $i + 1) -ge 0) { throw "Anchor is not unique in $rel." }
  $t = $t.Substring(0, $i) + $new + $t.Substring($i + $old.Length)
  [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
  Write-Host "  edit   $rel"
}
$o0 = @'
  // Manufacturing overlay, because 1301/1302/1303 and the production documents
  // only exist for organisations that pick it.
'@
$n0 = @'
  // BOTH overlays. Manufacturing brings 1301/1302/1303 and the production
  // documents; TRADING brings 1201 Inventory, which the trading items need and
  // which is NOT part of the core chart ~U+2014~ a manufacturing-only org has no 1201
  // at all, and every stock item pointed at it fails to save.
'@
Edit-FileText 'backend/tests/seed.ts' $o0 $n0
$o1 = @'
    { organizationId, domains: { MANUFACTURING: {} } }), "onboarding/domain");
'@
$n1 = @'
    { organizationId, domains: { TRADING: {}, MANUFACTURING: {} } }), "onboarding/domain");
'@
Edit-FileText 'backend/tests/seed.ts' $o1 $n1
$o2 = @'
async function setPolicy(plan: OrgPlan, token: string) {
'@
$n2 = @'
// Re-runs domain selection and provisioning. Both are idempotent, and both
// have to happen again for an organisation created before a missing template
// was inserted: provisioning COPIES coa_templates at the moment it runs, so an
// org provisioned against an incomplete chart stays incomplete for ever unless
// it is re-provisioned. This is what repairs the missing 1401-1455 / 4020 block.
async function reprovision(organizationId: string) {
  const d = await call("POST", "/onboarding/domain",
    { organizationId, domains: { TRADING: {}, MANUFACTURING: {} } });
  if (d.status >= 400) {
    // Refused once a journal entry has been posted (domain_locked_at). Nothing
    // to repair at that point anyway.
    console.log(`  ${GREY}. domains: ${d.body?.message}${OFF}`);
  }
  const p = await call("POST", "/onboarding/provision", { organizationId });
  if (p.status >= 400) {
    console.log(`  ${RED}x${OFF} re-provision: ${p.body?.message}`);
    return;
  }
  ok("re-provisioned (fills in any accounts and asset classes that were missing)");
}

// Frequency, threshold and costing method. Runs BEFORE items are created:
// POST /items refuses outright until the organisation has a costing method,
// and the failure message does not say which setting is missing.
async function setBasics(plan: OrgPlan, token: string) {
'@
Edit-FileText 'backend/tests/seed.ts' $o2 $n2
$o3 = @'
  ok(`costing method ${plan.costingMethod}`);

'@
$n3 = @'
  ok(`costing method ${plan.costingMethod}`);
}

'@
Edit-FileText 'backend/tests/seed.ts' $o3 $n3
$o4 = @'

  if (plan.key !== "A") return;
'@
$n4 = @'

// Method is organisation policy with a per-class override history, not a field
// on the class.
//
// The history is rebuilt from scratch each run. Withdrawing a change is only
// possible before anything has posted under it, which is exactly the state a
// freshly seeded org is in, and rebuilding is far easier to reason about than
// reconciling whatever rows a half-finished earlier run left behind.
async function setDepPolicy(plan: OrgPlan, token: string) {
  if (plan.key !== "A") return;
'@
Edit-FileText 'backend/tests/seed.ts' $o4 $n4
$o5 = @'
  // Method is organisation policy with a per-class override history, not a
  // field on the class. Each of these is one row in that history.
'@
$n5 = @'
  const current = must(await call("GET", "/depreciation-policy", undefined, token), "read policy");
  const existing: any[] = current?.data?.changes ?? [];
  for (const c of existing) {
    const r = await call("DELETE", `/depreciation-policy/change/${c.id}`, undefined, token);
    if (r.status >= 400) {
      console.log(`  ${GREY}. could not withdraw the ${c.toMethod} change dated ${c.effectiveMonth}: ${r.body?.message}${OFF}`);
    } else {
      console.log(`  ${GREY}. withdrew ${c.toMethod} from ${String(c.effectiveMonth).slice(0, 7)}${OFF}`);
    }
  }

'@
Edit-FileText 'backend/tests/seed.ts' $o5 $n5
$o6 = @'
  const changes: Array<[string, string, string | undefined, string]> = [
    ["SLM", "2026-04", undefined, "Test baseline ~U+2014~ straight line across the organisation."],
    ["WDV", "2026-04", idOf("Computers - desktops & laptops"), "Test class ~U+2014~ WDV verification."],
    ["WDV", "2026-04", idOf("Buildings - residential"), "Test class ~U+2014~ WDV with no residual."],
    ["WDV", "2026-06", idOf("Electrical installations"), "Test class ~U+2014~ mid-life method change from June."],
'@
$n6 = @'

  // [method, effectiveMonth, class name or null for the whole organisation, reason]
  const changes: Array<[string, string, string | null, string]> = [
    ["SLM", "2026-04", null, "Test baseline - straight line across the organisation."],
    ["WDV", "2026-04", "Computers - desktops & laptops", "Test class - WDV verification."],
    ["WDV", "2026-04", "Buildings - residential", "Test class - WDV with no residual."],
    ["WDV", "2026-06", "Electrical installations", "Test class - mid-life method change from June."],
'@
Edit-FileText 'backend/tests/seed.ts' $o6 $n6
$o7 = @'
  for (const [toMethod, effectiveMonth, assetClassId, reason] of changes) {
'@
$n7 = @'

  for (const [toMethod, effectiveMonth, className, reason] of changes) {
    let assetClassId: string | undefined;
    if (className) {
      assetClassId = idOf(className);
      // THE BUG THIS GUARD EXISTS FOR: when the class could not be resolved,
      // the earlier version simply omitted assetClassId ~U+2014~ and a change with no
      // assetClassId applies to the WHOLE ORGANISATION. A missing asset class
      // silently became an organisation-wide method switch. Refuse instead.
      if (!assetClassId) {
        console.log(`  ${RED}x${OFF} policy ${toMethod} from ${effectiveMonth}: asset class ` +
          `'${className}' not found, so this change is SKIPPED. It must never be posted ` +
          `without a class - that would switch the whole organisation.`);
        continue;
      }
    }
'@
Edit-FileText 'backend/tests/seed.ts' $o7 $n7
$o8 = @'
      // A repeat of the same change is not an error worth stopping for.
'@
$n8 = @'

'@
Edit-FileText 'backend/tests/seed.ts' $o8 $n8
$o9 = @'
    ok(`policy ${toMethod} from ${effectiveMonth}${assetClassId ? " (one class)" : " (organisation)"}`);
'@
$n9 = @'
    ok(`policy ${toMethod} from ${effectiveMonth}${className ? ` (${className})` : " (organisation)"}`);
'@
Edit-FileText 'backend/tests/seed.ts' $o9 $n9
$o10 = @'
  }
}

// ---------------------------------------------------------------------------

'@
$n10 = @'
  }
}
// ---------------------------------------------------------------------------

'@
Edit-FileText 'backend/tests/seed.ts' $o10 $n10
$o11 = @'
    const { token } = await ensureOrg(plan);
'@
$n11 = @'
    const { organizationId, token } = await ensureOrg(plan);
    // Order matters. Re-provision first so the chart is complete, then the
    // costing method (items are refused without it), then everything else.
    await reprovision(organizationId);
    await setBasics(plan, token);
'@
Edit-FileText 'backend/tests/seed.ts' $o11 $n11
$o12 = @'
    await setPolicy(plan, token);
'@
$n12 = @'
    await setDepPolicy(plan, token);
'@
Edit-FileText 'backend/tests/seed.ts' $o12 $n12
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green