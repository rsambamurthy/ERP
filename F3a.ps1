$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Depreciation policy: types, API, navigation, bill line...' -ForegroundColor Cyan

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

Edit-FileText 'frontend/lib/types.ts' '  inUseDate?: string;
  // Schedule II allows a justified departure from the class''s default life.
  usefulLifeMonths?: number;
  // "SLM" or "WDV". Schedule II prescribes lives, not methods. Omitted means
  // the class''s default. WDV needs a residual above zero.
  method?: string;
  // Part A paragraph 3(i): a life differing from the PRESCRIBED one — longer
  // or shorter — must be disclosed and justified with technical advice.
  usefulLifeNote?: string;
}

// One row of GET /asset-classes — the defaults an asset is created from.' '  inUseDate?: string;
  // Schedule II allows a justified departure from the class''s default life.
  usefulLifeMonths?: number;
  // NOTE: no method here. The depreciation method is a company policy, not a
  // per-purchase choice — see DepreciationPolicy below. The useful life is
  // the opposite: Schedule II is about the life of a particular asset.
  //
  // Part A paragraph 3(i): a life differing from the PRESCRIBED one — longer
  // or shorter — must be disclosed and justified with technical advice.
  usefulLifeNote?: string;
}

// The company''s depreciation method and every time it changed.
//
// Changing it is permitted and prospective: under AS 10 (revised) and
// Ind AS 16 a change of method is a change in accounting ESTIMATE, so posted
// charges stand and are never restated. The reason is not optional — a
// change in estimate is disclosable.
export interface DepreciationMethodChange {
  id: string;
  fromMethod: string;
  toMethod: string;
  // "YYYY-MM" — the first month the new method applies to.
  effectiveMonth: string;
  reason: string;
  recordedAt: string;
}

export interface DepreciationPolicy {
  currentMethod: string;
  // "YYYY-MM", or null when nothing has ever been depreciated. A change can
  // never take effect on or before this month.
  lastPostedChargeMonth: string | null;
  earliestEffectiveMonth: string;
  changes: DepreciationMethodChange[];
}

// One row of GET /asset-classes — the defaults an asset is created from.'

Edit-FileText 'frontend/lib/api.ts' '  RecurringDueRow,
  RecurringGenerateResult,
  AssetClassSummary,
  PrepaidScheduleSummary,
  PrepaidScheduleDetail,
  PrepaidDueRow,' '  RecurringDueRow,
  RecurringGenerateResult,
  AssetClassSummary,
  DepreciationPolicy,
  PrepaidScheduleSummary,
  PrepaidScheduleDetail,
  PrepaidDueRow,'

Edit-FileText 'frontend/lib/api.ts' '  });
}

// ── Asset classes ────────────────────────────────────────────────────────

// Read-only. Retired classes are excluded by default, which is what the' '  });
}

// ── Depreciation policy ──────────────────────────────────────────────────

export function getDepreciationPolicy() {
  return request<{ data: DepreciationPolicy }>("/depreciation-policy");
}

// effectiveMonth is "YYYY-MM". The reason is required: it is what the
// disclosure of the change in estimate gets written from.
export function changeDepreciationMethod(body: { toMethod: string; effectiveMonth: string; reason: string }) {
  return request<{ data: { id: string } }>("/depreciation-policy/change", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// Only works while the change is still in the future — once a month has been
// depreciated under it, it cannot be withdrawn.
export function withdrawDepreciationMethodChange(id: string) {
  return request<{ data: { id: string } }>(`/depreciation-policy/change/${id}`, { method: "DELETE" });
}

// ── Asset classes ────────────────────────────────────────────────────────

// Read-only. Retired classes are excluded by default, which is what the'

Edit-FileText 'frontend/components/layout/navGroups.ts' '      { id: "balance_sheet", label: "Balance Sheet", path: "/accounting/balance-sheet", dot: "#7c3aed", roles: ALL_ROLES },
      { id: "prepaid_schedules", label: "Prepaid Schedules", path: "/accounting/prepaid-schedules", dot: "#0d9488", roles: ALL_ROLES },
      { id: "amortization_due", label: "Amortization Due", path: "/accounting/amortization-due", dot: "#e11d48", roles: ["OWNER", "ADMIN", "ACCOUNTANT"], permission: "journal.post" },
    ],
  },
  {' '      { id: "balance_sheet", label: "Balance Sheet", path: "/accounting/balance-sheet", dot: "#7c3aed", roles: ALL_ROLES },
      { id: "prepaid_schedules", label: "Prepaid Schedules", path: "/accounting/prepaid-schedules", dot: "#0d9488", roles: ALL_ROLES },
      { id: "amortization_due", label: "Amortization Due", path: "/accounting/amortization-due", dot: "#e11d48", roles: ["OWNER", "ADMIN", "ACCOUNTANT"], permission: "journal.post" },
      { id: "depreciation_policy", label: "Depreciation Policy", path: "/accounting/depreciation-policy", dot: "#9333ea", roles: ALL_ROLES },
    ],
  },
  {'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' 'import ItemPicker from "@/components/shared/ItemPicker";
import CostingMethodGate from "@/components/inventory/CostingMethodGate";
import {
  ApiError, approvePurchaseBill, createPurchaseBill, extractInvoice, getAssetClasses, getBranches, getBusinessPartnerLookup, getGoodsReceiptNotes, getItems,
  getPurchaseBill, getPurchaseBills, getPurchaseOrder, getPurchaseOrders, lookupCurrencyRate, rejectPurchaseBill, updatePurchaseBillReference,
} from "@/lib/api";
import { canApprovePurchaseOrders } from "@/lib/auth";
import { isInterState, round2, splitGst } from "@/lib/discountGst";
import type { AssetClassSummary, Branch, BusinessPartnerLookup, DocumentLineInput, ExtractedInvoice, ExtractedInvoiceLine, Item, PurchaseBill, PurchaseBillStatus, PurchaseOrder } from "@/lib/types";
import { PURCHASE_BILL_STATUS_LABELS, SUPPORTED_CURRENCIES, currencySymbol } from "@/lib/types";

// Best-effort word-overlap match between an extracted invoice line''s free-' 'import ItemPicker from "@/components/shared/ItemPicker";
import CostingMethodGate from "@/components/inventory/CostingMethodGate";
import {
  ApiError, approvePurchaseBill, createPurchaseBill, extractInvoice, getAssetClasses, getBranches, getBusinessPartnerLookup, getDepreciationPolicy, getGoodsReceiptNotes, getItems,
  getPurchaseBill, getPurchaseBills, getPurchaseOrder, getPurchaseOrders, lookupCurrencyRate, rejectPurchaseBill, updatePurchaseBillReference,
} from "@/lib/api";
import { canApprovePurchaseOrders } from "@/lib/auth";
import { isInterState, round2, splitGst } from "@/lib/discountGst";
import type { AssetClassSummary, Branch, BusinessPartnerLookup, DepreciationPolicy, DocumentLineInput, ExtractedInvoice, ExtractedInvoiceLine, Item, PurchaseBill, PurchaseBillStatus, PurchaseOrder } from "@/lib/types";
import { PURCHASE_BILL_STATUS_LABELS, SUPPORTED_CURRENCIES, currencySymbol } from "@/lib/types";

// Best-effort word-overlap match between an extracted invoice line''s free-'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '  const [vendors, setVendors] = useState<BusinessPartnerLookup[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [assetClasses, setAssetClasses] = useState<AssetClassSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);' '  const [vendors, setVendors] = useState<BusinessPartnerLookup[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [assetClasses, setAssetClasses] = useState<AssetClassSummary[]>([]);
  const [depPolicy, setDepPolicy] = useState<DepreciationPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '  // the same job prepaidHint does. Mirrors the server: residual is a
  // percentage of cost, and the depreciable base is spread evenly over the
  // life in months.
  function effectiveLife(l: DocumentLineInput, cls: AssetClassSummary): number {
    return Number(l.usefulLifeMonths || cls.defaultUsefulLifeMonths);
  }' '  // the same job prepaidHint does. Mirrors the server: residual is a
  // percentage of cost, and the depreciable base is spread evenly over the
  // life in months.
  // The method that will apply to an asset put to use in a given month —
  // the company''s policy, resolved the same way the server resolves it: the
  // latest change effective on or before that month, else the current
  // method. Not a per-line choice, which is why there is no control for it
  // here; it is set on Accounting > Depreciation Policy.
  function methodForMonth(ym: string): string {
    if (!depPolicy) return "SLM";
    const applicable = depPolicy.changes
      .filter((c) => c.effectiveMonth <= ym)
      .sort((a, b) => (a.effectiveMonth < b.effectiveMonth ? 1 : -1))[0];
    return applicable ? applicable.toMethod : depPolicy.currentMethod;
  }

  function effectiveLife(l: DocumentLineInput, cls: AssetClassSummary): number {
    return Number(l.usefulLifeMonths || cls.defaultUsefulLifeMonths);
  }'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '      ? ""
      : end.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });

    if (String(l.method || cls.defaultMethod).toUpperCase() === "WDV") {
      // The rate is derived from the life and residual rather than
      // prescribed: after `life` months at this rate the balance is exactly
      // the residual, which is the same place straight line lands.
      if (!(residual > 0)) return "Written-down value needs a residual above zero — this class has none.";
      const rate = 1 - Math.pow(residual / amount, 1 / life);
      return `${fmt(amount * rate)} in the first month, declining · ${fmt(residual)} left after ${life} months${endLabel ? ` · ends ${endLabel}` : ""}`;
    }' '      ? ""
      : end.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });

    const method = methodForMonth(String(l.inUseDate).slice(0, 7));
    if (method === "WDV") {
      // The rate is derived from the life and residual rather than
      // prescribed: after `life` months at this rate the balance is exactly
      // the residual, which is the same place straight line lands.
      if (!(residual > 0)) return "The company depreciates on written-down value, which needs a residual above zero — this class has none.";
      const rate = 1 - Math.pow(residual / amount, 1 / life);
      return `${fmt(amount * rate)} in the first month, declining · ${fmt(residual)} left after ${life} months${endLabel ? ` · ends ${endLabel}` : ""}`;
    }'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '  async function loadAll() {
    setLoading(true);
    try {
      const [billsRes, itemsRes, vendorsRes, branchRes, poRes, classRes] = await Promise.all([
        getPurchaseBills(), getItems(), getBusinessPartnerLookup("VENDOR"), getBranches(), getPurchaseOrders({ status: "APPROVED" }),
        getAssetClasses(),
      ]);
      setBills(billsRes.data);
      setItems(itemsRes.data);
      setVendors(vendorsRes.data);
      setBranches(branchRes.data);
      setAssetClasses(classRes.data);
      // Only orders with at least one line that''s been received but not yet
      // fully billed are worth offering — this is a proxy for "has an open
      // GRN line to bill against" without fetching every order''s Goods' '  async function loadAll() {
    setLoading(true);
    try {
      const [billsRes, itemsRes, vendorsRes, branchRes, poRes, classRes, policyRes] = await Promise.all([
        getPurchaseBills(), getItems(), getBusinessPartnerLookup("VENDOR"), getBranches(), getPurchaseOrders({ status: "APPROVED" }),
        getAssetClasses(), getDepreciationPolicy(),
      ]);
      setBills(billsRes.data);
      setItems(itemsRes.data);
      setVendors(vendorsRes.data);
      setBranches(branchRes.data);
      setAssetClasses(classRes.data);
      setDepPolicy(policyRes.data);
      // Only orders with at least one line that''s been received but not yet
      // fully billed are worth offering — this is a proxy for "has an open
      // GRN line to bill against" without fetching every order''s Goods'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '          // rejected by the server.
          .map((l) => (canCapitalise && l.capitalise && isServiceLine(l)
            ? l
            : { ...l, capitalise: undefined, assetClassId: undefined, assetName: undefined, inUseDate: undefined, usefulLifeMonths: undefined, method: undefined, usefulLifeNote: undefined })),
        currency, exchangeRate: isForeign ? Number(exchangeRate) : undefined,
        billOfEntryNumber: isForeign ? newBoeNumber || undefined : undefined,
        billOfEntryDate: isForeign ? newBoeDate || undefined : undefined,' '          // rejected by the server.
          .map((l) => (canCapitalise && l.capitalise && isServiceLine(l)
            ? l
            : { ...l, capitalise: undefined, assetClassId: undefined, assetName: undefined, inUseDate: undefined, usefulLifeMonths: undefined, usefulLifeNote: undefined })),
        currency, exchangeRate: isForeign ? Number(exchangeRate) : undefined,
        billOfEntryNumber: isForeign ? newBoeNumber || undefined : undefined,
        billOfEntryDate: isForeign ? newBoeDate || undefined : undefined,'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '                                disabled={!!line.prepaid}
                                onChange={(e) => updateLine(i, e.target.checked
                                  ? { capitalise: true, assetClassId: line.assetClassId || "", inUseDate: line.inUseDate || billDate }
                                  : { capitalise: false, assetClassId: undefined, assetName: undefined, inUseDate: undefined, usefulLifeMonths: undefined, method: undefined, usefulLifeNote: undefined })}
                              />
                              Capitalise this line
                            </label>' '                                disabled={!!line.prepaid}
                                onChange={(e) => updateLine(i, e.target.checked
                                  ? { capitalise: true, assetClassId: line.assetClassId || "", inUseDate: line.inUseDate || billDate }
                                  : { capitalise: false, assetClassId: undefined, assetName: undefined, inUseDate: undefined, usefulLifeMonths: undefined, usefulLifeNote: undefined })}
                              />
                              Capitalise this line
                            </label>'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '                                  value={line.inUseDate ?? ""}
                                  onChange={(e) => updateLine(i, { inUseDate: e.target.value })}
                                />
                                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                                  <select
                                    className="ent-fc" style={{ flex: "1 1 90px" }}
                                    value={line.method ?? assetClassById.get(String(line.assetClassId))?.defaultMethod ?? "SLM"}
                                    onChange={(e) => updateLine(i, { method: e.target.value })}
                                  >
                                    <option value="SLM">Straight line</option>
                                    <option value="WDV">Written-down value</option>
                                  </select>
                                  <input
                                    type="number" min={1} max={1200} step={1} className="ent-fc" style={{ width: 70 }}
                                    title="Useful life in months"' '                                  value={line.inUseDate ?? ""}
                                  onChange={(e) => updateLine(i, { inUseDate: e.target.value })}
                                />
                                <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                                  <input
                                    type="number" min={1} max={1200} step={1} className="ent-fc" style={{ width: 70 }}
                                    title="Useful life in months"'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '                                    value={line.usefulLifeMonths ?? assetClassById.get(String(line.assetClassId))?.defaultUsefulLifeMonths ?? ""}
                                    onChange={(e) => updateLine(i, { usefulLifeMonths: Number(e.target.value) })}
                                  />
                                </div>
                                {lifeDeviation(line) && (
                                  <>' '                                    value={line.usefulLifeMonths ?? assetClassById.get(String(line.assetClassId))?.defaultUsefulLifeMonths ?? ""}
                                    onChange={(e) => updateLine(i, { usefulLifeMonths: Number(e.target.value) })}
                                  />
                                  {/* Shown, not chosen. The method is the
                                      company''s policy — one method for the
                                      whole entity, disclosed once. */}
                                  <span style={{ fontSize: 11.5, color: "var(--color-muted)" }}>
                                    months · {methodForMonth(String(line.inUseDate).slice(0, 7)) === "WDV" ? "written-down value" : "straight line"}
                                  </span>
                                </div>
                                {lifeDeviation(line) && (
                                  <>'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green