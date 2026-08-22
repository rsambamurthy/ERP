$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Item to asset class: screens...' -ForegroundColor Cyan

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

Edit-FileText 'frontend/lib/types.ts' '  // For STOCK this is the stock control account; for SERVICE it''s the
  // expense account the bill line debits. Same column either way.
  stockAccount: { id: string; accountCode: string; accountName: string };
  salesRate: string | null;
  purchaseRate: string | null;
  taxRate: string;' '  // For STOCK this is the stock control account; for SERVICE it''s the
  // expense account the bill line debits. Same column either way.
  stockAccount: { id: string; accountCode: string; accountName: string };
  // Set means this item is capital by nature — a conference table, a laptop.
  // Its Purchase Bill line arrives capitalised against this class instead of
  // debiting stockAccount, so an asset''s cost cannot land in the P&L just
  // because someone forgot to tick a box. SERVICE items only.
  defaultAssetClass: ItemAssetClassRef | null;
  salesRate: string | null;
  purchaseRate: string | null;
  taxRate: string;'

Edit-FileText 'frontend/lib/types.ts' '  effectiveMonth: string;
  reason: string;
  recordedAt: string;
}

export interface DepreciationPolicy {' '  effectiveMonth: string;
  reason: string;
  recordedAt: string;
}

// Set on an Item that is capital by nature. Its Purchase Bill line arrives
// capitalised against this class — see migration_037.
export interface ItemAssetClassRef {
  id: string;
  name: string;
}

export interface DepreciationPolicy {'

Edit-FileText 'frontend/lib/api.ts' 'export function createItem(body: {
  sku: string; name: string; description?: string; uom?: string; hsnCode?: string;
  isFinishedGood?: boolean; itemKind?: "STOCK" | "SERVICE"; stockAccountId: string; salesRate?: number; purchaseRate?: number; taxRate?: number;
  defaultDiscountPct?: number;
  openingQuantity?: number; openingCost?: number; openingBranchId?: string; openingDate?: string;
}) {' 'export function createItem(body: {
  sku: string; name: string; description?: string; uom?: string; hsnCode?: string;
  isFinishedGood?: boolean; itemKind?: "STOCK" | "SERVICE"; stockAccountId: string; salesRate?: number; purchaseRate?: number; taxRate?: number;
  // Set on an item that is capital by nature — its Purchase Bill line then
  // arrives capitalised against this class. SERVICE items only.
  defaultAssetClassId?: string;
  defaultDiscountPct?: number;
  openingQuantity?: number; openingCost?: number; openingBranchId?: string; openingDate?: string;
}) {'

Edit-FileText 'frontend/app/inventory/items/page.tsx' 'import AppShell from "@/components/layout/AppShell";
import AccountPicker from "@/components/shared/AccountPicker";
import CostingMethodGate from "@/components/inventory/CostingMethodGate";
import { ApiError, createItem, getItems, getStockAccounts, getExpenseAccounts, toggleItem } from "@/lib/api";
import { canManageItems } from "@/lib/auth";
import { useBulkUpload } from "@/components/shared/BulkUpload";
import type { Account, Item, ItemUploadRow } from "@/lib/types";

const ITEM_UPLOAD_COLUMNS: { key: keyof ItemUploadRow; label: string }[] = [
  { key: "sku", label: "SKU" },' 'import AppShell from "@/components/layout/AppShell";
import AccountPicker from "@/components/shared/AccountPicker";
import CostingMethodGate from "@/components/inventory/CostingMethodGate";
import { ApiError, createItem, getAssetClasses, getItems, getStockAccounts, getExpenseAccounts, toggleItem } from "@/lib/api";
import { canManageItems } from "@/lib/auth";
import { useBulkUpload } from "@/components/shared/BulkUpload";
import type { Account, AssetClassSummary, Item, ItemUploadRow } from "@/lib/types";

const ITEM_UPLOAD_COLUMNS: { key: keyof ItemUploadRow; label: string }[] = [
  { key: "sku", label: "SKU" },'

Edit-FileText 'frontend/app/inventory/items/page.tsx' '  // which kind of account stockAccountId points at, and changing it later
  // would re-point whatever the item has already posted.
  itemKind: "STOCK" as "STOCK" | "SERVICE",
  stockAccountId: "", salesRate: "", purchaseRate: "", taxRate: "0", defaultDiscountPct: "0",
  openingQuantity: "", openingCost: "",
});
' '  // which kind of account stockAccountId points at, and changing it later
  // would re-point whatever the item has already posted.
  itemKind: "STOCK" as "STOCK" | "SERVICE",
  stockAccountId: "",
  // Set this and the item is capital by nature: every Purchase Bill line for
  // it arrives capitalised against this class rather than debiting the
  // expense account above. Service items only.
  defaultAssetClassId: "",
  salesRate: "", purchaseRate: "", taxRate: "0", defaultDiscountPct: "0",
  openingQuantity: "", openingCost: "",
});
'

Edit-FileText 'frontend/app/inventory/items/page.tsx' '  const [items, setItems] = useState<Item[]>([]);
  const [stockAccounts, setStockAccounts] = useState<Account[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);' '  const [items, setItems] = useState<Item[]>([]);
  const [stockAccounts, setStockAccounts] = useState<Account[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<Account[]>([]);
  const [assetClasses, setAssetClasses] = useState<AssetClassSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);'

Edit-FileText 'frontend/app/inventory/items/page.tsx' '  async function loadAll() {
    setLoading(true);
    try {
      const [itemsRes, accountsRes, expenseRes] = await Promise.all([
        getItems(), getStockAccounts(), getExpenseAccounts(),
      ]);
      setItems(itemsRes.data);
      setStockAccounts(accountsRes.data);
      setExpenseAccounts(expenseRes.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load items.");
    } finally {' '  async function loadAll() {
    setLoading(true);
    try {
      const [itemsRes, accountsRes, expenseRes, classRes] = await Promise.all([
        getItems(), getStockAccounts(), getExpenseAccounts(), getAssetClasses(),
      ]);
      setItems(itemsRes.data);
      setStockAccounts(accountsRes.data);
      setExpenseAccounts(expenseRes.data);
      setAssetClasses(classRes.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load items.");
    } finally {'

Edit-FileText 'frontend/app/inventory/items/page.tsx' '        sku: form.sku, name: form.name, description: form.description || undefined,
        uom: form.uom, hsnCode: form.hsnCode || undefined, isFinishedGood: form.isFinishedGood,
        stockAccountId: form.stockAccountId,
        salesRate: form.salesRate ? Number(form.salesRate) : undefined,
        purchaseRate: form.purchaseRate ? Number(form.purchaseRate) : undefined,
        taxRate: form.taxRate ? Number(form.taxRate) : undefined,' '        sku: form.sku, name: form.name, description: form.description || undefined,
        uom: form.uom, hsnCode: form.hsnCode || undefined, isFinishedGood: form.isFinishedGood,
        stockAccountId: form.stockAccountId,
        defaultAssetClassId: form.defaultAssetClassId || undefined,
        salesRate: form.salesRate ? Number(form.salesRate) : undefined,
        purchaseRate: form.purchaseRate ? Number(form.purchaseRate) : undefined,
        taxRate: form.taxRate ? Number(form.taxRate) : undefined,'

Edit-FileText 'frontend/app/inventory/items/page.tsx' '                required
              />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Tax Rate %</label>
              <input type="number" min={0} step="0.01" className="ent-fc" value={form.taxRate} onChange={(e) => setForm((f) => ({ ...f, taxRate: e.target.value }))} />' '                required
              />
            </div>
            {form.itemKind === "SERVICE" && (
              <div className="ent-fg">
                <label className="ent-fl">Capital asset class (optional)</label>
                <select
                  className="ent-fc"
                  value={form.defaultAssetClassId}
                  onChange={(e) => setForm((f) => ({ ...f, defaultAssetClassId: e.target.value }))}
                >
                  <option value="">Not a capital asset</option>
                  {assetClasses.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <span style={{ fontSize: 11.5, color: "var(--color-muted)", marginTop: 3, lineHeight: 1.45 }}>
                  {form.defaultAssetClassId
                    ? "Every Purchase Bill line for this item will arrive capitalised against this class and open a fixed asset — the expense account above is then only used if someone deliberately unticks it."
                    : "Set this for something that is always a fixed asset — a conference table, a laptop — so its cost cannot land in the P&L because a box went unticked."}
                </span>
              </div>
            )}
            <div className="ent-fg">
              <label className="ent-fl">Tax Rate %</label>
              <input type="number" min={0} step="0.01" className="ent-fc" value={form.taxRate} onChange={(e) => setForm((f) => ({ ...f, taxRate: e.target.value }))} />'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '
  function pickItem(i: number, itemId: string) {
    const item = itemById.get(itemId);
    updateLine(i, {
      itemId,
      // Item master rates are always INR — only useful as a default when' '
  function pickItem(i: number, itemId: string) {
    const item = itemById.get(itemId);
    // An item mapped to an asset class in the Item master is capital by
    // nature, so the line arrives ticked and classified. Still unticked by
    // hand if this particular purchase is genuinely an expense — the point
    // is that it cannot be missed by forgetting.
    const capital = canCapitalise && item?.itemKind === "SERVICE" && item?.defaultAssetClass
      ? { capitalise: true, assetClassId: item.defaultAssetClass.id, inUseDate: billDate }
      : { capitalise: false, assetClassId: undefined, assetName: undefined, inUseDate: undefined, usefulLifeMonths: undefined, usefulLifeNote: undefined };
    updateLine(i, {
      itemId,
      // Item master rates are always INR — only useful as a default when'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '      rateFc: 0,
      taxRate: item?.taxRate ? Number(item.taxRate) : 0,
      customsDutyRate: 0,
    });
  }
' '      rateFc: 0,
      taxRate: item?.taxRate ? Number(item.taxRate) : 0,
      customsDutyRate: 0,
      ...capital,
    });
  }
'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green