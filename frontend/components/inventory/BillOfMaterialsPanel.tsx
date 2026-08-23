"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, getBom, getItems, saveBom } from "@/lib/api";
import type { BillOfMaterials, Item } from "@/lib/types";

// The bill of materials for a finished item.
//
// A recipe, not an event: nothing here moves stock or posts to the ledger.
// Its only job is to be exploded when a production order is opened, so the
// components arrive already listed and the user corrects them against what
// was actually issued to the shop floor.
//
// The whole recipe is saved at once rather than line by line. A bill of
// materials half-saved no longer makes the product, and there is no useful
// meaning to "two of the four components are committed".

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Draft {
  key: string;
  componentItemId: string;
  qtyPerUnit: string;
}

let seq = 0;
function newKey(): string { return `r${++seq}`; }

export default function BillOfMaterialsPanel({ itemId, canManage }: { itemId: string; canManage: boolean }) {
  const [bom, setBom] = useState<BillOfMaterials | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, i] = await Promise.all([getBom(itemId), getItems()]);
      setBom(b.data);
      setItems(i.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the bill of materials.");
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => { void load(); }, [load]);

  // A component must be a stock item, active, and not the product itself.
  // Filtered here as well as refused by the server, so the picker never
  // offers something that will be rejected on save.
  const candidates = useMemo(
    () => items
      .filter((i) => i.id !== itemId && i.itemKind !== "SERVICE" && i.isActive)
      .sort((a, b) => a.sku.localeCompare(b.sku)),
    [items, itemId],
  );

  function beginEdit() {
    setDraft((bom?.lines ?? []).map((l) => ({
      key: newKey(),
      componentItemId: l.component.id,
      qtyPerUnit: String(l.qtyPerUnit),
    })));
    setEditing(true);
    setError(null);
  }

  function addRow() {
    setDraft((d) => [...d, { key: newKey(), componentItemId: "", qtyPerUnit: "" }]);
  }

  async function handleSave() {
    const lines: { componentItemId: string; qtyPerUnit: number }[] = [];
    for (const d of draft) {
      if (!d.componentItemId && !d.qtyPerUnit) continue; // an untouched blank row
      if (!d.componentItemId) { setError("Every line needs a component."); return; }
      const q = Number(d.qtyPerUnit);
      if (!Number.isFinite(q) || q <= 0) { setError("Quantity per unit must be more than zero."); return; }
      lines.push({ componentItemId: d.componentItemId, qtyPerUnit: q });
    }
    const ids = new Set(lines.map((l) => l.componentItemId));
    if (ids.size !== lines.length) { setError("The same component is listed twice."); return; }

    setSaving(true);
    setError(null);
    try {
      await saveBom(itemId, lines);
      setEditing(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the bill of materials.");
    } finally {
      setSaving(false);
    }
  }

  const muted = { color: "var(--color-muted)", fontSize: 12 } as const;
  const num = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

  // The running total while editing, so the effect of a change is visible
  // before it is saved. Uses the costs already loaded for components that
  // were on the recipe; a newly added component shows a dash until saved,
  // because its cost has not been fetched.
  const costByComponent = useMemo(
    () => new Map((bom?.lines ?? []).map((l) => [l.component.id, l.unitCost])),
    [bom],
  );

  return (
    <div className="ent-section" style={{ marginTop: 16 }}>
      <div className="ent-section-hdr">
        <span className="ent-section-title">Bill of Materials</span>
        {!loading && canManage && !editing && (
          <button type="button" className="ent-ia ent-ia-edit" onClick={beginEdit}>
            {bom && bom.lines.length > 0 ? "Edit" : "Add components"}
          </button>
        )}
      </div>

      <div style={{ padding: 14 }}>
        <p style={{ ...muted, marginTop: 0 }}>
          What one {bom?.item.uom ? `${bom.item.uom} of this` : "unit"} is made of. Exploded when a production
          order is opened; the quantities can still be corrected on the order against what was actually issued.
          Editing this never reaches back into an order already running.
        </p>

        {error && <p style={{ color: "#dc2626", fontSize: 13 }}>{error}</p>}
        {loading && <p style={muted}>Loading…</p>}

        {!loading && !editing && bom && bom.lines.length === 0 && (
          <p style={{ fontSize: 13, margin: "8px 0 0" }}>No components yet.</p>
        )}

        {!loading && !editing && bom && bom.lines.length > 0 && (
          <>
            <table style={{ width: "100%", marginTop: 4 }}>
              <thead>
                <tr>
                  <th>Component</th>
                  <th style={{ width: 130, ...num }}>Qty per unit</th>
                  <th style={{ width: 130, ...num }}>Cost each</th>
                  <th style={{ width: 130, ...num }}>Cost per unit</th>
                  <th style={{ width: 120, ...num }}>On hand</th>
                </tr>
              </thead>
              <tbody>
                {bom.lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.component.sku} — {l.component.name}
                      {!l.component.isActive && <span className="badge badge-gray" style={{ marginLeft: 6 }}>Inactive</span>}
                    </td>
                    <td style={num}>{l.qtyPerUnit} {l.component.uom}</td>
                    <td style={num}>{l.unitCost > 0 ? money(l.unitCost) : "—"}</td>
                    <td style={num}>{l.unitCost > 0 ? money(l.lineCost) : "—"}</td>
                    <td style={{ ...num, color: "var(--color-muted)" }}>{l.quantityOnHand}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={3} style={{ textAlign: "right", fontWeight: 600 }}>Material cost per unit</td>
                  <td style={{ ...num, fontWeight: 600 }}>{money(bom.materialCostPerUnit)}</td>
                  <td />
                </tr>
              </tbody>
            </table>

            {/* Said plainly rather than left for someone to work out from a
                total that looks too low. */}
            <p style={{ ...muted, marginTop: 10 }}>
              {bom.incomplete
                ? "Some components have never been priced, so this total understates the material cost. "
                : ""}
              Indicative only — a production order charges whatever the stock is actually worth on the day the
              material is issued, and adds labour and overhead on top.
            </p>
          </>
        )}

        {editing && (
          <>
            <table style={{ width: "100%", marginTop: 4 }}>
              <thead>
                <tr>
                  <th>Component</th>
                  <th style={{ width: 160 }}>Qty per unit</th>
                  <th style={{ width: 130, ...num }}>Cost per unit</th>
                  <th style={{ width: 60 }} />
                </tr>
              </thead>
              <tbody>
                {draft.map((d, i) => {
                  const unit = costByComponent.get(d.componentItemId);
                  const q = Number(d.qtyPerUnit);
                  const line = unit !== undefined && Number.isFinite(q) && q > 0 ? unit * q : null;
                  return (
                    <tr key={d.key}>
                      <td>
                        <select
                          className="ent-fc"
                          value={d.componentItemId}
                          onChange={(e) => setDraft((rows) => rows.map((r, j) => j === i ? { ...r, componentItemId: e.target.value } : r))}
                        >
                          <option value="">Pick a component…</option>
                          {candidates.map((it) => (
                            <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number" min={0} step="0.0001" className="ent-fc"
                          value={d.qtyPerUnit}
                          onChange={(e) => setDraft((rows) => rows.map((r, j) => j === i ? { ...r, qtyPerUnit: e.target.value } : r))}
                        />
                      </td>
                      <td style={num}>{line === null ? "—" : money(Math.round(line * 100) / 100)}</td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          type="button" className="ent-ia ent-ia-del"
                          onClick={() => setDraft((rows) => rows.filter((_, j) => j !== i))}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {draft.length === 0 && (
                  <tr><td colSpan={4} className="ent-empty">No components. Add one, or save to clear the recipe.</td></tr>
                )}
              </tbody>
            </table>

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button type="button" className="ent-ia ent-ia-edit" onClick={addRow}>Add component</button>
              <div style={{ flex: 1 }} />
              <button type="button" className="ent-btn-add" disabled={saving} onClick={handleSave}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button type="button" className="ent-btn-cancel" onClick={() => { setEditing(false); setError(null); }}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
