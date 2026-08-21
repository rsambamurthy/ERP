$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Capital asset control on the bill line (screen)...' -ForegroundColor Cyan

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

Edit-FileText 'frontend/app/purchase/bills/page.tsx' 'import ItemPicker from "@/components/shared/ItemPicker";
import CostingMethodGate from "@/components/inventory/CostingMethodGate";
import {
  ApiError, approvePurchaseBill, createPurchaseBill, extractInvoice, getBranches, getBusinessPartnerLookup, getGoodsReceiptNotes, getItems,
  getPurchaseBill, getPurchaseBills, getPurchaseOrder, getPurchaseOrders, lookupCurrencyRate, rejectPurchaseBill, updatePurchaseBillReference,
} from "@/lib/api";
import { canApprovePurchaseOrders } from "@/lib/auth";
import { isInterState, round2, splitGst } from "@/lib/discountGst";
import type { Branch, BusinessPartnerLookup, DocumentLineInput, ExtractedInvoice, ExtractedInvoiceLine, Item, PurchaseBill, PurchaseBillStatus, PurchaseOrder } from "@/lib/types";
import { PURCHASE_BILL_STATUS_LABELS, SUPPORTED_CURRENCIES, currencySymbol } from "@/lib/types";

// Best-effort word-overlap match between an extracted invoice line''s free-' 'import ItemPicker from "@/components/shared/ItemPicker";
import CostingMethodGate from "@/components/inventory/CostingMethodGate";
import {
  ApiError, approvePurchaseBill, createPurchaseBill, extractInvoice, getAssetClasses, getBranches, getBusinessPartnerLookup, getGoodsReceiptNotes, getItems,
  getPurchaseBill, getPurchaseBills, getPurchaseOrder, getPurchaseOrders, lookupCurrencyRate, rejectPurchaseBill, updatePurchaseBillReference,
} from "@/lib/api";
import { canApprovePurchaseOrders } from "@/lib/auth";
import { isInterState, round2, splitGst } from "@/lib/discountGst";
import type { AssetClassSummary, Branch, BusinessPartnerLookup, DocumentLineInput, ExtractedInvoice, ExtractedInvoiceLine, Item, PurchaseBill, PurchaseBillStatus, PurchaseOrder } from "@/lib/types";
import { PURCHASE_BILL_STATUS_LABELS, SUPPORTED_CURRENCIES, currencySymbol } from "@/lib/types";

// Best-effort word-overlap match between an extracted invoice line''s free-'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '  const [items, setItems] = useState<Item[]>([]);
  const [vendors, setVendors] = useState<BusinessPartnerLookup[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);' '  const [items, setItems] = useState<Item[]>([]);
  const [vendors, setVendors] = useState<BusinessPartnerLookup[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [assetClasses, setAssetClasses] = useState<AssetClassSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '  const canPrepay = !isForeign && !linkedPO;
  const isServiceLine = (l: DocumentLineInput) => itemById.get(l.itemId)?.itemKind === "SERVICE";

  // What the schedule will actually do, spelled out before it is committed.
  // Deliberately mirrors the server: equal instalments with the rounding
  // remainder landing on the last one, so the figure shown is the figure' '  const canPrepay = !isForeign && !linkedPO;
  const isServiceLine = (l: DocumentLineInput) => itemById.get(l.itemId)?.itemKind === "SERVICE";

  // ── Capital asset (migration_034) ────────────────────────────────────
  // Same gate as prepaid, and for the same reasons: the server refuses a
  // capitalised line on a PO-linked or foreign-currency bill, so offering
  // the control there would only produce a rejected post.
  const canCapitalise = !isForeign && !linkedPO;
  const assetClassById = useMemo(
    () => new Map(assetClasses.map((c) => [c.id, c])),
    [assetClasses],
  );

  // What capitalising will actually do, spelled out before it is committed —
  // the same job prepaidHint does. Mirrors the server: residual is a
  // percentage of cost, and the depreciable base is spread evenly over the
  // life in months.
  function capitalHint(l: DocumentLineInput): string {
    const cls = assetClassById.get(String(l.assetClassId ?? ""));
    const amount = round2(Number(l.quantity) * Number(l.rate));
    if (!cls) return "Pick an asset class.";
    if (!(amount > 0)) return "Enter a quantity and rate.";
    if (!l.inUseDate) return "Set the date it was put to use.";
    const life = Number(l.usefulLifeMonths || cls.defaultUsefulLifeMonths);
    const residual = round2(amount * cls.defaultResidualPct / 100);
    const base = round2(amount - residual);
    const perMonth = base / life;
    const start = new Date(`${l.inUseDate}T00:00:00.000Z`);
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + life - 1, 1));
    const endLabel = isNaN(end.getTime())
      ? ""
      : end.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
    const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${fmt(base)} over ${life} months · ${fmt(perMonth)} / month${endLabel ? ` · ends ${endLabel}` : ""}`;
  }

  // What the schedule will actually do, spelled out before it is committed.
  // Deliberately mirrors the server: equal instalments with the rounding
  // remainder landing on the last one, so the figure shown is the figure'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '  async function loadAll() {
    setLoading(true);
    try {
      const [billsRes, itemsRes, vendorsRes, branchRes, poRes] = await Promise.all([
        getPurchaseBills(), getItems(), getBusinessPartnerLookup("VENDOR"), getBranches(), getPurchaseOrders({ status: "APPROVED" }),
      ]);
      setBills(billsRes.data);
      setItems(itemsRes.data);
      setVendors(vendorsRes.data);
      setBranches(branchRes.data);
      // Only orders with at least one line that''s been received but not yet
      // fully billed are worth offering — this is a proxy for "has an open
      // GRN line to bill against" without fetching every order''s Goods' '  async function loadAll() {
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
      // GRN line to bill against" without fetching every order''s Goods'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '          // otherwise ride along and be rejected by the server.
          .map((l) => (canPrepay && l.prepaid && isServiceLine(l)
            ? l
            : { ...l, prepaid: undefined, prepaidStartMonth: undefined, prepaidMonths: undefined })),
        currency, exchangeRate: isForeign ? Number(exchangeRate) : undefined,
        billOfEntryNumber: isForeign ? newBoeNumber || undefined : undefined,
        billOfEntryDate: isForeign ? newBoeDate || undefined : undefined,' '          // otherwise ride along and be rejected by the server.
          .map((l) => (canPrepay && l.prepaid && isServiceLine(l)
            ? l
            : { ...l, prepaid: undefined, prepaidStartMonth: undefined, prepaidMonths: undefined }))
          // Same treatment for the capital-asset fields: an assetClassId left
          // behind by unticking the box would otherwise ride along and be
          // rejected by the server.
          .map((l) => (canCapitalise && l.capitalise && isServiceLine(l)
            ? l
            : { ...l, capitalise: undefined, assetClassId: undefined, assetName: undefined, inUseDate: undefined, usefulLifeMonths: undefined })),
        currency, exchangeRate: isForeign ? Number(exchangeRate) : undefined,
        billOfEntryNumber: isForeign ? newBoeNumber || undefined : undefined,
        billOfEntryDate: isForeign ? newBoeDate || undefined : undefined,'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '              {/* The Prepaid column is hidden on a foreign-currency or
                  PO-linked bill: the server rejects prepaid on both, so
                  offering it would only produce a rejected post. */}
              <thead><tr><th style={{ width: "28%" }}>Item</th><th>Qty</th><th>Rate{isForeign ? ` (${currency})` : ""}</th>{isForeign && <th>Rate (₹)</th>}<th>Tax %</th>{isForeign && <th>Duty %</th>}{canPrepay && <th style={{ width: "24%" }}>Prepaid</th>}<th /></tr></thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i}>' '              {/* The Prepaid column is hidden on a foreign-currency or
                  PO-linked bill: the server rejects prepaid on both, so
                  offering it would only produce a rejected post. */}
              <thead><tr><th style={{ width: "22%" }}>Item</th><th>Qty</th><th>Rate{isForeign ? ` (${currency})` : ""}</th>{isForeign && <th>Rate (₹)</th>}<th>Tax %</th>{isForeign && <th>Duty %</th>}{canPrepay && <th style={{ width: "20%" }}>Prepaid</th>}{canCapitalise && <th style={{ width: "24%" }}>Capital asset</th>}<th /></tr></thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i}>'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '                              <input
                                type="checkbox"
                                checked={!!line.prepaid}
                                onChange={(e) => updateLine(i, e.target.checked
                                  ? { prepaid: true, prepaidStartMonth: line.prepaidStartMonth || currentMonth(), prepaidMonths: line.prepaidMonths || 12 }
                                  : { prepaid: false, prepaidStartMonth: undefined, prepaidMonths: undefined })}' '                              <input
                                type="checkbox"
                                checked={!!line.prepaid}
                                disabled={!!line.capitalise}
                                onChange={(e) => updateLine(i, e.target.checked
                                  ? { prepaid: true, prepaidStartMonth: line.prepaidStartMonth || currentMonth(), prepaidMonths: line.prepaidMonths || 12 }
                                  : { prepaid: false, prepaidStartMonth: undefined, prepaidMonths: undefined })}'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '                        ) : (
                          <span style={{ fontSize: 11.5, color: "var(--color-muted)" }}>
                            {line.itemId ? "Stock item" : "—"}
                          </span>
                        )}
                      </td>' '                        ) : (
                          <span style={{ fontSize: 11.5, color: "var(--color-muted)" }}>
                            {line.itemId ? "Stock item" : "—"}
                          </span>
                        )}
                      </td>
                    )}
                    {canCapitalise && (
                      <td>
                        {isServiceLine(line) ? (
                          <>
                            <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
                              <input
                                type="checkbox"
                                checked={!!line.capitalise}
                                disabled={!!line.prepaid}
                                onChange={(e) => updateLine(i, e.target.checked
                                  ? { capitalise: true, assetClassId: line.assetClassId || "", inUseDate: line.inUseDate || billDate }
                                  : { capitalise: false, assetClassId: undefined, assetName: undefined, inUseDate: undefined, usefulLifeMonths: undefined })}
                              />
                              Capitalise this line
                            </label>
                            {line.capitalise && (
                              <>
                                <select
                                  className="ent-fc" style={{ width: "100%", marginTop: 6 }}
                                  value={line.assetClassId ?? ""}
                                  onChange={(e) => updateLine(i, { assetClassId: e.target.value })}
                                >
                                  <option value="">Asset class…</option>
                                  {assetClasses.map((c) => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                  ))}
                                </select>
                                <input
                                  type="date" className="ent-fc" style={{ width: "100%", marginTop: 6 }}
                                  min={billDate}
                                  value={line.inUseDate ?? ""}
                                  onChange={(e) => updateLine(i, { inUseDate: e.target.value })}
                                />
                                {/* Depreciation runs from the date the asset was
                                    put to use, not the date it was bought —
                                    Schedule II charges "on a pro rata basis from
                                    the date of such addition". */}
                                <div style={{ fontSize: 11.5, color: "var(--color-muted)", marginTop: 4 }}>
                                  {capitalHint(line)}
                                </div>
                              </>
                            )}
                          </>
                        ) : (
                          <span style={{ fontSize: 11.5, color: "var(--color-muted)" }}>
                            {line.itemId ? "Stock item — not capitalisable" : "—"}
                          </span>
                        )}
                      </td>'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green