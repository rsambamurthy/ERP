$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Fixed asset register: types, API, navigation...' -ForegroundColor Cyan

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

Edit-FileText 'frontend/lib/types.ts' 'export interface ItemAssetClassRef {
  id: string;
  name: string;
}

// One asset class as Configuration > Depreciation shows it. usefulLifeMonths' 'export interface ItemAssetClassRef {
  id: string;
  name: string;
}

// ── Fixed asset register ─────────────────────────────────────────────────
//
// Read-only. An asset is created by capitalising a Purchase Bill line and is
// never edited: its cost, life, method, residual and accounts were all fixed
// at capitalisation, and everything afterwards happens through depreciation
// runs and disposal.
//
// Gross block, accumulated depreciation and net block are shown separately
// because Schedule III requires exactly that. Accumulated depreciation is
// summed from what actually posted rather than stored, so it cannot drift
// from the ledger.

export interface FixedAssetSummary {
  id: string;
  assetCode: string;
  name: string;
  assetClass: { id: string; name: string };
  branch: { id: string; name: string } | null;
  assetAccount: { accountCode: string; accountName: string };
  vendor: string | null;
  billNumber: string | null;
  purchaseDate: string | null;
  inUseDate: string | null;
  method: string;
  usefulLifeMonths: number;
  scheduleIiLifeMonths: number;
  // The set an auditor asks for: assets whose life departs from Schedule II.
  departsFromScheduleII: boolean;
  grossCost: number;
  residualValue: number;
  accumulatedDepreciation: number;
  netBookValue: number;
  periodsPosted: number;
  status: string;
}

export interface FixedAssetRun {
  id: string;
  periodStart: string | null;
  periodEnd: string | null;
  frequency: string;
  amount: number;
  openingWdv: number;
  closingWdv: number;
  runType: string;
  journalEntryId: string;
  generatedAt: string;
}

export interface FixedAssetDetail extends Omit<FixedAssetSummary, "vendor" | "billNumber" | "periodsPosted"> {
  // This asset''s sub-ledger card. Both balance-sheet accounts are tagged to
  // it, so one asset''s gross block and accumulated depreciation are readable
  // from the ledger itself rather than only from this table.
  card: { id: string; name: string };
  accumDepAccount: { accountCode: string; accountName: string };
  depExpenseAccount: { accountCode: string; accountName: string };
  purchaseBill: {
    id: string; billNumber: string; billDate: string | null;
    vendor: { id: string; name: string } | null;
  } | null;
  // Copied from the asset class at capitalisation, so the Part A paragraph
  // 3(i) disclosure stays with the asset even if the class is edited later.
  usefulLifeNote: string | null;
  gstCapitalised: boolean;
  disposalDate: string | null;
  disposalProceeds: number | null;
  runs: FixedAssetRun[];
}

// One asset class as Configuration > Depreciation shows it. usefulLifeMonths'

Edit-FileText 'frontend/lib/api.ts' '  RecurringGenerateResult,
  AssetClassSummary,
  DepreciationPolicy,
  PrepaidScheduleSummary,
  PrepaidScheduleDetail,
  PrepaidDueRow,' '  RecurringGenerateResult,
  AssetClassSummary,
  DepreciationPolicy,
  FixedAssetSummary,
  FixedAssetDetail,
  PrepaidScheduleSummary,
  PrepaidScheduleDetail,
  PrepaidDueRow,'

Edit-FileText 'frontend/lib/api.ts' '  });
}

// ── Depreciation policy ──────────────────────────────────────────────────

export function getDepreciationPolicy() {' '  });
}

// ── Fixed asset register ─────────────────────────────────────────────────

// Read-only: an asset is created by capitalising a Purchase Bill line and
// changed only by depreciation and disposal.
export function getFixedAssets(includeDisposed = false) {
  return request<{ data: FixedAssetSummary[] }>(
    `/fixed-assets${includeDisposed ? "?includeDisposed=true" : ""}`,
  );
}

export function getFixedAsset(id: string) {
  return request<{ data: FixedAssetDetail }>(`/fixed-assets/${id}`);
}

// ── Depreciation policy ──────────────────────────────────────────────────

export function getDepreciationPolicy() {'

Edit-FileText 'frontend/components/layout/navGroups.ts' '      { id: "balance_sheet", label: "Balance Sheet", path: "/accounting/balance-sheet", dot: "#7c3aed", roles: ALL_ROLES },
      { id: "prepaid_schedules", label: "Prepaid Schedules", path: "/accounting/prepaid-schedules", dot: "#0d9488", roles: ALL_ROLES },
      { id: "amortization_due", label: "Amortization Due", path: "/accounting/amortization-due", dot: "#e11d48", roles: ["OWNER", "ADMIN", "ACCOUNTANT"], permission: "journal.post" },
    ],
  },
  {' '      { id: "balance_sheet", label: "Balance Sheet", path: "/accounting/balance-sheet", dot: "#7c3aed", roles: ALL_ROLES },
      { id: "prepaid_schedules", label: "Prepaid Schedules", path: "/accounting/prepaid-schedules", dot: "#0d9488", roles: ALL_ROLES },
      { id: "amortization_due", label: "Amortization Due", path: "/accounting/amortization-due", dot: "#e11d48", roles: ["OWNER", "ADMIN", "ACCOUNTANT"], permission: "journal.post" },
      { id: "fixed_assets", label: "Fixed Assets", path: "/accounting/fixed-assets", dot: "#9333ea", roles: ALL_ROLES },
    ],
  },
  {'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green