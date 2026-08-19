"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { ApiError, getItem, updateItem, toggleItem, deleteItem } from "@/lib/api";
import { canManageItems } from "@/lib/auth";
import type { Item } from "@/lib/types";

// Item detail. Deliberately mirrors the Business Partner detail page —
// header, a Basic Details block that flips between read and edit, and the
// destructive actions at the bottom — so the two masters behave the same.
//
// SKU and Stock Account are shown but never editable. PATCH /items/:id
// accepts neither: the SKU is the bulk-upload match key, and the stock
// account is what every past stock movement posted against, so changing it
// would silently re-point history at a different ledger. Both are fixed at
// creation on purpose, and the note under them says so rather than leaving
// a user hunting for the missing field.

export default function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const canManage = canManageItems();

  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: "", description: "", uom: "", hsnCode: "",
    salesRate: "", purchaseRate: "", taxRate: "", defaultDiscountPct: "",
    isFinishedGood: false,
  });

  async function load() {
    setLoading(true);
    try {
      const res = await getItem(id);
      setItem(res.data);
      setForm({
        name: res.data.name,
        description: res.data.description ?? "",
        uom: res.data.uom ?? "",
        hsnCode: res.data.hsnCode ?? "",
        salesRate: res.data.salesRate ?? "",
        purchaseRate: res.data.purchaseRate ?? "",
        taxRate: res.data.taxRate ?? "",
        defaultDiscountPct: res.data.defaultDiscountPct ?? "",
        isFinishedGood: res.data.isFinishedGood,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this item.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSave() {
    setActionBusy(true);
    setActionError(null);
    try {
      // Empty strings mean "cleared", not "unchanged" — send null so Prisma
      // writes it, rather than "" which would store an empty rate.
      await updateItem(id, {
        name: form.name,
        description: form.description || null,
        uom: form.uom,
        hsnCode: form.hsnCode || null,
        salesRate: form.salesRate || null,
        purchaseRate: form.purchaseRate || null,
        taxRate: form.taxRate || "0",
        defaultDiscountPct: form.defaultDiscountPct || "0",
        isFinishedGood: form.isFinishedGood,
      });
      setEditing(false);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleToggle() {
    setActionBusy(true);
    setActionError(null);
    try {
      await toggleItem(id);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not change status.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleDelete() {
    setActionBusy(true);
    setActionError(null);
    try {
      await deleteItem(id);
      router.push("/inventory/items");
    } catch (err) {
      // The API refuses (409) once the item has any stock movement. Surface
      // that message as-is and point at the alternative that does work.
      setActionError(
        err instanceof ApiError
          ? `${err.message} Deactivate it instead to take it out of new documents.`
          : "Could not delete this item."
      );
      setConfirmingDelete(false);
    } finally {
      setActionBusy(false);
    }
  }

  const muted = { color: "var(--color-muted)", fontSize: 12 } as const;

  if (loading) return <AppShell><p className="ent-empty">Loading…</p></AppShell>;
  if (error || !item) return <AppShell><p style={{ color: "#dc2626" }}>{error ?? "Not found."}</p></AppShell>;

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>{item.name}</h1>
        <p>
          Item · {item.sku}
          {" · "}
          <button className="ent-ia ent-ia-edit" style={{ padding: 0 }} onClick={() => router.push("/inventory/items")}>
            Back to list
          </button>
        </p>
      </div>

      <div className="ent-section" style={{ marginBottom: 16, padding: 14 }}>
        <div className="ent-section-hdr">
          <span className="ent-section-title">Basic Details</span>
          {!editing && canManage && (
            <button className="ent-ia ent-ia-edit" onClick={() => setEditing(true)}>Edit</button>
          )}
        </div>

        {editing ? (
          <>
            <div className="ent-form-grid">
              <div className="ent-fg"><label className="ent-fl">Name</label><input className="ent-fc" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
              <div className="ent-fg"><label className="ent-fl">UOM</label><input className="ent-fc" value={form.uom} onChange={(e) => setForm((f) => ({ ...f, uom: e.target.value }))} /></div>
              <div className="ent-fg"><label className="ent-fl">HSN/SAC Code</label><input className="ent-fc" value={form.hsnCode} onChange={(e) => setForm((f) => ({ ...f, hsnCode: e.target.value }))} /></div>
              <div className="ent-fg"><label className="ent-fl">Tax Rate %</label><input type="number" min={0} step="0.01" className="ent-fc" value={form.taxRate} onChange={(e) => setForm((f) => ({ ...f, taxRate: e.target.value }))} /></div>
              <div className="ent-fg"><label className="ent-fl">Default Discount %</label><input type="number" min={0} step="0.01" className="ent-fc" value={form.defaultDiscountPct} onChange={(e) => setForm((f) => ({ ...f, defaultDiscountPct: e.target.value }))} /></div>
              <div className="ent-fg"><label className="ent-fl">Sales Rate</label><input type="number" min={0} step="0.01" className="ent-fc" value={form.salesRate} onChange={(e) => setForm((f) => ({ ...f, salesRate: e.target.value }))} /></div>
              <div className="ent-fg"><label className="ent-fl">Purchase Rate</label><input type="number" min={0} step="0.01" className="ent-fc" value={form.purchaseRate} onChange={(e) => setForm((f) => ({ ...f, purchaseRate: e.target.value }))} /></div>
              <div className="ent-fg" style={{ gridColumn: "1 / -1" }}><label className="ent-fl">Description</label><input className="ent-fc" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
              <div className="ent-fg" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" id="item-fg" checked={form.isFinishedGood} onChange={(e) => setForm((f) => ({ ...f, isFinishedGood: e.target.checked }))} />
                <label htmlFor="item-fg" className="ent-fl" style={{ margin: 0 }}>Finished good</label>
              </div>
            </div>
            <p style={{ ...muted, padding: "0 0 8px" }}>
              Item Code and Stock Account are fixed at creation — the code is the bulk-upload
              match key, and the account is what existing stock movements posted against.
            </p>
            {actionError && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 0 10px" }}>{actionError}</p>}
            <button className="ent-btn-save" disabled={actionBusy} onClick={handleSave}>{actionBusy ? "Saving…" : "Save"}</button>
            <button className="ent-ia ent-ia-del" style={{ marginLeft: 8 }} onClick={() => { setEditing(false); setActionError(null); }}>Cancel</button>
          </>
        ) : (
          <div className="ent-form-grid">
            <div><span style={muted}>Item Code</span><div>{item.sku}</div></div>
            <div><span style={muted}>UOM</span><div>{item.uom || "—"}</div></div>
            <div><span style={muted}>HSN/SAC</span><div>{item.hsnCode || "—"}</div></div>
            <div><span style={muted}>Stock Account</span><div>{item.stockAccount.accountCode} — {item.stockAccount.accountName}</div></div>
            <div><span style={muted}>Tax Rate</span><div>{item.taxRate}%</div></div>
            <div><span style={muted}>Default Discount</span><div>{item.defaultDiscountPct}%</div></div>
            <div><span style={muted}>Sales Rate</span><div>{item.salesRate ?? "—"}</div></div>
            <div><span style={muted}>Purchase Rate</span><div>{item.purchaseRate ?? "—"}</div></div>
            <div><span style={muted}>On Hand</span><div>{item.totalQuantityOnHand}</div></div>
            <div><span style={muted}>Type</span><div>{item.isFinishedGood ? "Finished good" : "Standard"}</div></div>
            <div style={{ gridColumn: "1 / -1" }}><span style={muted}>Description</span><div>{item.description || "—"}</div></div>
            <div>
              <span style={muted}>Status</span>
              <div>
                <span className={item.isActive ? "badge badge-green" : "badge badge-gray"}>{item.isActive ? "Active" : "Inactive"}</span>
                {canManage && (
                  <button className="ent-ia ent-ia-edit" style={{ marginLeft: 8 }} disabled={actionBusy} onClick={handleToggle}>
                    {item.isActive ? "Deactivate" : "Activate"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {canManage && !editing && (
        <div className="ent-section" style={{ padding: 14 }}>
          <div className="ent-section-hdr"><span className="ent-section-title">Delete</span></div>
          <p style={{ ...muted, paddingBottom: 8 }}>
            Only possible while the item has never been used. Once it has any stock movement
            the server refuses — deactivate it instead, which keeps its history and takes it
            out of new documents.
          </p>
          {actionError && <p style={{ color: "#dc2626", fontSize: 13, paddingBottom: 8 }}>{actionError}</p>}
          {confirmingDelete ? (
            <>
              <span style={{ fontSize: 13, marginRight: 8 }}>Delete <strong>{item.sku} — {item.name}</strong>?</span>
              <button className="ent-ia ent-ia-del" disabled={actionBusy} onClick={handleDelete}>{actionBusy ? "Deleting…" : "Yes, delete"}</button>
              <button className="ent-ia ent-ia-edit" style={{ marginLeft: 6 }} onClick={() => setConfirmingDelete(false)}>Cancel</button>
            </>
          ) : (
            <button className="ent-ia ent-ia-del" onClick={() => { setConfirmingDelete(true); setActionError(null); }}>Delete Item</button>
          )}
        </div>
      )}
    </AppShell>
  );
}