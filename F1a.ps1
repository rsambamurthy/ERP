$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Capital asset types and API...' -ForegroundColor Cyan

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

Edit-FileText 'frontend/lib/types.ts' '  // "YYYY-MM" — the month the first instalment belongs to.
  prepaidStartMonth?: string;
  prepaidMonths?: number;
}

// Read-only result of POST /purchase-bills/extract-invoice — a vendor' '  // "YYYY-MM" — the month the first instalment belongs to.
  prepaidStartMonth?: string;
  prepaidMonths?: number;
  // Purchase Bill service lines only — this line buys a fixed asset rather
  // than an expense. The line debits the asset class''s cost account instead
  // of the item''s own head and opens a row in the fixed asset register. See
  // migration_034. Mutually exclusive with prepaid.
  //
  // One line is one asset, whatever the quantity: three laptops that will be
  // disposed of separately need three lines.
  capitalise?: boolean;
  assetClassId?: string;
  // Defaults to the item''s name server-side.
  assetName?: string;
  // "YYYY-MM-DD" — when the asset was put to use, which is what Schedule II
  // depreciates from. Never earlier than the bill date.
  inUseDate?: string;
  // Schedule II allows a justified departure from the class''s default life.
  usefulLifeMonths?: number;
}

// One row of GET /asset-classes — the defaults an asset is created from.
// Income tax depreciation is out of scope, so no block code or rate here:
// depreciation is Schedule II only.
export interface AssetClassSummary {
  id: string;
  name: string;
  isActive: boolean;
  defaultUsefulLifeMonths: number;
  defaultMethod: string;
  defaultResidualPct: number;
  assetAccount: { id: string; accountCode: string; accountName: string };
  accumDepAccount: { id: string; accountCode: string; accountName: string };
  depExpenseAccount: { id: string; accountCode: string; accountName: string };
}

// Read-only result of POST /purchase-bills/extract-invoice — a vendor'

Edit-FileText 'frontend/lib/api.ts' '  RecurringExpenseLineInput,
  RecurringDueRow,
  RecurringGenerateResult,
  PrepaidScheduleSummary,
  PrepaidScheduleDetail,
  PrepaidDueRow,' '  RecurringExpenseLineInput,
  RecurringDueRow,
  RecurringGenerateResult,
  AssetClassSummary,
  PrepaidScheduleSummary,
  PrepaidScheduleDetail,
  PrepaidDueRow,'

Edit-FileText 'frontend/lib/api.ts' '  });
}

// ── Prepaid schedules ────────────────────────────────────────────────────

export function getPrepaidSchedules() {' '  });
}

// ── Asset classes ────────────────────────────────────────────────────────

// Read-only. Retired classes are excluded by default, which is what the
// capitalisation picker wants — the server refuses them anyway.
export function getAssetClasses() {
  return request<{ data: AssetClassSummary[] }>("/asset-classes");
}

// ── Prepaid schedules ────────────────────────────────────────────────────

export function getPrepaidSchedules() {'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green