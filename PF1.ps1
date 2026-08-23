$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Production orders: types and API...' -ForegroundColor Cyan

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

Edit-FileText 'frontend/lib/types.ts' '  materialCostPerUnit: number;
  // At least one component has never been priced, so the total understates.
  incomplete: boolean;
}
' '  materialCostPerUnit: number;
  // At least one component has never been priced, so the total understates.
  incomplete: boolean;
}

// Production orders — raw material in, finished goods out.
//
// The WIP balance and the quantity received are computed by the server from
// the order''s postings, never stored. The finished good''s unit cost is
// likewise derived: WIP absorbed divided by quantity received.

export interface ProductionEntryLineView {
  id: string;
  item: { id: string; sku: string; name: string; uom: string } | null;
  account: { id: string; accountCode: string; accountName: string } | null;
  quantity: number | null;
  unitCost: number | null;
  lineValue: number;
}

export interface ProductionEntryView {
  id: string;
  // ISSUE, COST, RECEIPT or WRITEOFF.
  entryType: string;
  entryDate: string;
  totalValue: number;
  narration: string | null;
  journalEntryId: string;
  lines: ProductionEntryLineView[];
}

export interface ProductionPosition {
  issued: number;
  costed: number;
  absorbed: number;
  writtenOff: number;
  wipBalance: number;
  receivedQuantity: number;
}

export interface ProductionOrderSummary extends ProductionPosition {
  id: string;
  orderNumber: string;
  orderDate: string;
  finishedItem: { id: string; sku: string; name: string; uom: string };
  branch: { id: string; name: string } | null;
  plannedQuantity: number;
  status: string;
  unitCostSoFar: number | null;
}

export interface SuggestedIssueLine {
  itemId: string;
  sku: string;
  name: string;
  uom: string;
  isActive: boolean;
  qtyPerUnit: number;
  // The bill of materials exploded for the planned quantity. A suggestion —
  // corrected on the issue against what was actually taken to the floor.
  quantity: number;
}

export interface ProductionOrderDetail extends ProductionOrderSummary {
  notes: string | null;
  suggestedIssue: SuggestedIssueLine[];
  entries: ProductionEntryView[];
}
'

Edit-FileText 'frontend/lib/api.ts' '  DepreciationDue,
  DepreciationPostResult,
  DepreciationReverseResult,
  BillOfMaterials,
} from "./types";
import { getToken } from "./auth";

// Points at the Railway-hosted backend. Set NEXT_PUBLIC_API_URL in Vercel''s
' '  DepreciationDue,
  DepreciationPostResult,
  DepreciationReverseResult,
  BillOfMaterials,
  ProductionOrderSummary,
  ProductionOrderDetail,
} from "./types";
import { getToken } from "./auth";

// Points at the Railway-hosted backend. Set NEXT_PUBLIC_API_URL in Vercel''s
'

Edit-FileText 'frontend/lib/api.ts' '  return request<{ data: { lines: number } }>(`/items/${itemId}/bom`, {
    method: "PUT", body: JSON.stringify({ lines }),
  });
}
' '  return request<{ data: { lines: number } }>(`/items/${itemId}/bom`, {
    method: "PUT", body: JSON.stringify({ lines }),
  });
}

// Production orders.
export function getProductionOrders(status?: string) {
  const q = status && status !== "ALL" ? `?status=${encodeURIComponent(status)}` : "";
  return request<{ data: ProductionOrderSummary[] }>(`/production-orders${q}`);
}

export function getProductionOrder(id: string) {
  return request<{ data: ProductionOrderDetail }>(`/production-orders/${id}`);
}

export function createProductionOrder(body: {
  branchId: string; orderDate: string; finishedItemId: string;
  plannedQuantity: number; notes?: string;
}) {
  return request<{ data: { id: string; orderNumber: string } }>("/production-orders", {
    method: "POST", body: JSON.stringify(body),
  });
}

// Material out of stock and into work in progress. The cost is whatever the
// stock is actually worth on the day — never sent from the screen.
export function issueProductionMaterial(id: string, body: {
  entryDate: string; lines: { itemId: string; quantity: number }[]; narration?: string;
}) {
  return request<{ data: { entryId: string; total: number } }>(`/production-orders/${id}/issue`, {
    method: "POST", body: JSON.stringify(body),
  });
}

// Cost of conversion — labour, power, factory overhead — absorbed out of an
// expense head into WIP, which is what AS 2 requires.
export function addProductionCost(id: string, body: {
  entryDate: string; lines: { accountId: string; amount: number }[]; narration?: string;
}) {
  return request<{ data: { entryId: string; total: number } }>(`/production-orders/${id}/cost`, {
    method: "POST", body: JSON.stringify(body),
  });
}

// `final` absorbs the whole remaining WIP balance into this receipt and
// closes the order — how ordinary process loss is treated.
export function receiveProductionOutput(id: string, body: {
  entryDate: string; quantity: number; final?: boolean; narration?: string;
}) {
  return request<{ data: { entryId: string; absorbed: number; unitCost: number; completed: boolean } }>(
    `/production-orders/${id}/receive`, { method: "POST", body: JSON.stringify(body) },
  );
}

export function closeProductionOrder(id: string) {
  return request<{ data: { completed: boolean; receivedQuantity: number } }>(
    `/production-orders/${id}/close`, { method: "POST", body: "{}" },
  );
}

export function cancelProductionOrder(id: string, entryDate?: string) {
  return request<{ data: { writtenOff: number; cancelled: boolean } }>(
    `/production-orders/${id}/cancel`, { method: "POST", body: JSON.stringify({ entryDate }) },
  );
}
'

Edit-FileText 'frontend/components/layout/navGroups.ts' '      { id: "item_valuation", label: "Item Valuation", path: "/inventory/valuation", dot: "#7c3aed", roles: ALL_ROLES },
    ],
  },
  {
    id: "accounting",
    label: "Accounting",
    icon: "A",
    items: [
' '      { id: "item_valuation", label: "Item Valuation", path: "/inventory/valuation", dot: "#7c3aed", roles: ALL_ROLES },
    ],
  },
  {
    id: "manufacturing",
    label: "Manufacturing",
    icon: "M",
    items: [
      { id: "production_orders", label: "Production Orders", path: "/manufacturing/production-orders", dot: "#ea580c", roles: ALL_ROLES },
    ],
  },
  {
    id: "accounting",
    label: "Accounting",
    icon: "A",
    items: [
'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green