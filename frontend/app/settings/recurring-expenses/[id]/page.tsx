"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import PartnerPicker from "@/components/shared/PartnerPicker";
import ItemPicker from "@/components/shared/ItemPicker";
import {
  ApiError, deleteRecurringExpense, getBusinessPartnerLookup, getItems,
  getRecurringExpense, toggleRecurringExpense, updateRecurringExpense,
} from "@/lib/api";
import type { BusinessPartnerLookup, Item, RecurringExpense } from "@/lib/types";

// Recurring expense detail. Same shape as the Item and Business Partner
// detail pages — basics that flip between read and edit, then history, then
// the destructive action.
//
// Editing replaces the lines wholesale rather than diffing them, matching
// the API and Purchase Order lines. A template is small and always edited as
// a whole, so row-level diffing would be machinery for its own sake.

function monthInput(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
}

export default function RecurringExpenseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [t, setT] = useState<RecurringExpense | null>(null);
  const [vendors, setVendors] = useState<BusinessPartnerLookup[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: "", businessPartnerId: "", dayOfMonth: "1", startMonth: "", endMonth: "",
    amountMode: "FIXED" as "FIXED" | "PROMPTED", narration: "",
  });
  const [lines, setLines] = useState<{ itemId: string; quantity: string; rate: string; taxRate: string }[]>([]);

  async function load() {
    setLoading(true);
    try {
      const [one, vendorRes, itemRes] = await Promise.all([
        getRecurringExpense(id), getBusinessPartnerLookup("VENDOR"), getItems(),
      ]);
      setT(one.data);
      setVendors(vendorRes.data);
      setItems(itemRes.data);
      setForm({
        name: one.data.name,
        businessPartnerId: one.data.businessPartnerId,
        dayOfMonth: String(one.data.dayOfMonth),
        startMonth: monthInput(one.data.startMonth),
        endMonth: monthInput(one.data.endMonth),
        amountMode: one.data.amountMode,
        narration: one.data.narration ?? "",
      });
      setLines(one.data.lines.map((l) => ({
        itemId: l.itemId,
        quantity: String(l.quantity),
        rate: l.rate ?? "",
        taxRate: String(l.taxRate),
      })));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this recurring expense.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const serviceItems = items.filter((i) => i.isActive && i.itemKind === "SERVICE");
  const muted = { color: "var(--color-muted)", fontSize: 12 } as const;

  function updateLine(i: number, patch: Partial<(typeof lines)[number]>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function handleSave() {
    setBusy(true);
    setActionError(null);
    try {
      await updateRecurringExpense(id, {
        name: form.name,
        businessPartnerId: form.businessPartnerId,
        dayOfMonth: Number(form.dayOfMonth),
        startMonth: form.startMonth,
        endMonth: form.endMonth || null,
        amountMode: form.amountMode,
        narration: form.narration || null,
        lines: lines.filter((l) => l.itemId).map((l) => ({
          itemId: l.itemId,
          quantity: Number(l.quantity || 1),
          rate: form.amountMode === "PROMPTED" ? null : Number(l.rate || 0),
          taxRate: Number(l.taxRate || 0),
        })),
      });
      setEditing(false);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle() {
    setBusy(true);
    setActionError(null);
    try {
      await toggleRecurringExpense(id);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not change status.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setActionError(null);
    try {
      await deleteRecurringExpense(id);
      router.push("/settings/recurring-expenses");
    } catch (err) {
      // 409 once anything has been raised from it. Point at Pause, which is
      // what people actually want in that situation.
      setActionError(
        err instanceof ApiError
          ? `${err.message} Pause it instead to stop it appearing on the due list.`
          : "Could not delete this recurring expense."
      );
      setConfirmingDelete(false);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <AppShell><p className="ent-empty">Loading…</p></AppShell>;
  if (error || !t) return <AppShell><p style={{ color: "#dc2626" }}>{error ?? "Not found."}</p></AppShell>;

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>{t.name}</h1>
        <p>
          Recurring Expense · {t.businessPartner.name}
          {" · "}
          <button className="ent-ia ent-ia-edit" style={{ padding: 0 }} onClick={() => router.push("/settings/recurring-expenses")}>
            Back to list
          </button>
        </p>
      </div>

      <div className="ent-section" style={{ marginBottom: 16, padding: 14 }}>
        <div className="ent-section-hdr">
          <span className="ent-section-title">Details</span>
          {!editing && <button className="ent-ia ent-ia-edit" onClick={() => setEditing(true)}>Edit</button>}
        </div>

        {editing ? (
          <>
            <div className="ent-form-grid">
              <div className="ent-fg"><label className="ent-fl">Name</label><input className="ent-fc" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
              <div className="ent-fg">
                <label className="ent-fl">Vendor</label>
                <PartnerPicker partners={vendors} value={form.businessPartnerId || null} onChange={(v) => setForm((f) => ({ ...f, businessPartnerId: v ?? "" }))} />
              </div>
              <div className="ent-fg"><label className="ent-fl">Day of Month</label><input type="number" min={1} max={28} className="ent-fc" value={form.dayOfMonth} onChange={(e) => setForm((f) => ({ ...f, dayOfMonth: e.target.value }))} /></div>
              <div className="ent-fg"><label className="ent-fl">Start Month</label><input type="month" className="ent-fc" value={form.startMonth} onChange={(e) => setForm((f) => ({ ...f, startMonth: e.target.value }))} /></div>
              <div className="ent-fg"><label className="ent-fl">End Month</label><input type="month" className="ent-fc" value={form.endMonth} onChange={(e) => setForm((f) => ({ ...f, endMonth: e.target.value }))} /></div>
              <div className="ent-fg">
                <label className="ent-fl">Amount</label>
                <div style={{ display: "flex", gap: 16, alignItems: "center", minHeight: 34 }}>
                  {(["FIXED", "PROMPTED"] as const).map((m) => (
                    <label key={m} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, cursor: "pointer" }}>
                      <input type="radio" name="mode" checked={form.amountMode === m} onChange={() => setForm((f) => ({ ...f, amountMode: m }))} />
                      {m === "FIXED" ? "Fixed" : "Prompted"}
                    </label>
                  ))}
                </div>
              </div>
              <div className="ent-fg" style={{ gridColumn: "1 / -1" }}><label className="ent-fl">Narration</label><input className="ent-fc" value={form.narration} onChange={(e) => setForm((f) => ({ ...f, narration: e.target.value }))} /></div>
            </div>

            <div className="ent-page-table" style={{ marginBottom: 12 }}>
              <table>
                <thead><tr><th style={{ width: "45%" }}>Service Item</th><th style={{ width: 90 }}>Qty</th><th style={{ width: 130 }}>Rate</th><th style={{ width: 90 }}>Tax %</th><th style={{ width: 40 }} /></tr></thead>
                <tbody>
                  {lines.map((line, i) => (
                    <tr key={i}>
                      <td>
                        <ItemPicker items={serviceItems} value={line.itemId || null} onChange={(v) => updateLine(i, { itemId: v ?? "" })} placeholder="Search service item…" />
                      </td>
                      <td><input type="number" min="0" step="0.001" className="ent-fc" value={line.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} /></td>
                      <td>
                        <input
                          type="number" min="0" step="0.01" className="ent-fc"
                          value={form.amountMode === "PROMPTED" ? "" : line.rate}
                          disabled={form.amountMode === "PROMPTED"}
                          placeholder={form.amountMode === "PROMPTED" ? "each month" : ""}
                          onChange={(e) => updateLine(i, { rate: e.target.value })}
                        />
                      </td>
                      <td><input type="number" min="0" step="0.01" className="ent-fc" value={line.taxRate} onChange={(e) => updateLine(i, { taxRate: e.target.value })} /></td>
                      <td style={{ textAlign: "right" }}>
                        {lines.length > 1 && <button type="button" className="ent-ia ent-ia-del" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>✕</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className="ent-ia ent-ia-edit" onClick={() => setLines((ls) => [...ls, { itemId: "", quantity: "1", rate: "", taxRate: "0" }])}>+ Add line</button>

            {actionError && <p style={{ color: "#dc2626", fontSize: 13, padding: "10px 0 0" }}>{actionError}</p>}
            <div style={{ paddingTop: 12 }}>
              <button className="ent-btn-save" disabled={busy} onClick={handleSave}>{busy ? "Saving…" : "Save"}</button>
              <button className="ent-ia ent-ia-del" style={{ marginLeft: 8 }} onClick={() => { setEditing(false); setActionError(null); load(); }}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <div className="ent-form-grid">
              <div><span style={muted}>Vendor</span><div>{t.businessPartner.name}</div></div>
              <div><span style={muted}>Day of Month</span><div>{t.dayOfMonth}</div></div>
              <div><span style={muted}>Start</span><div>{monthLabel(t.startMonth)}</div></div>
              <div><span style={muted}>End</span><div>{t.endMonth ? monthLabel(t.endMonth) : "Open-ended"}</div></div>
              <div><span style={muted}>Amount</span><div>{t.amountMode === "FIXED" ? "Fixed" : "Prompted each month"}</div></div>
              <div>
                <span style={muted}>Status</span>
                <div>
                  <span className={t.isActive ? "badge badge-green" : "badge badge-gray"}>{t.isActive ? "Active" : "Paused"}</span>
                  <button className="ent-ia ent-ia-edit" style={{ marginLeft: 8 }} disabled={busy} onClick={handleToggle}>{t.isActive ? "Pause" : "Resume"}</button>
                </div>
              </div>
              <div style={{ gridColumn: "1 / -1" }}><span style={muted}>Narration</span><div>{t.narration || "—"}</div></div>
            </div>

            <div className="ent-page-table" style={{ marginTop: 12 }}>
              <table>
                <thead><tr><th>Service Item</th><th style={{ textAlign: "right" }}>Qty</th><th style={{ textAlign: "right" }}>Rate</th><th style={{ textAlign: "right" }}>Tax %</th></tr></thead>
                <tbody>
                  {t.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.item ? `${l.item.sku} — ${l.item.name}` : l.itemId}</td>
                      <td style={{ textAlign: "right" }}>{l.quantity}</td>
                      <td style={{ textAlign: "right" }}>{l.rate ?? <span style={muted}>prompted</span>}</td>
                      <td style={{ textAlign: "right" }}>{l.taxRate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {actionError && <p style={{ color: "#dc2626", fontSize: 13, paddingTop: 10 }}>{actionError}</p>}
          </>
        )}
      </div>

      <div className="ent-section" style={{ marginBottom: 16, padding: 14 }}>
        <div className="ent-section-hdr"><span className="ent-section-title">Generated Bills</span></div>
        {t.runs.length === 0 ? (
          <p style={{ ...muted, margin: 0 }}>
            Nothing raised from this template yet. Generating happens on the monthly due screen.
          </p>
        ) : (
          <div className="ent-page-table">
            <table>
              <thead><tr><th>Month</th><th>Bill</th><th>Bill Date</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
              <tbody>
                {t.runs.map((r) => (
                  <tr key={r.id}>
                    <td>{monthLabel(r.periodMonth)}</td>
                    <td>
                      <Link href="/purchase/bills" className="ent-ia ent-ia-edit" style={{ padding: 0 }}>
                        {r.purchaseBill?.billNumber ?? "—"}
                      </Link>
                    </td>
                    <td style={{ color: "var(--color-muted)" }}>{r.purchaseBill?.billDate?.slice(0, 10) ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>{r.purchaseBill?.grandTotal ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!editing && (
        <div className="ent-section" style={{ padding: 14 }}>
          <div className="ent-section-hdr"><span className="ent-section-title">Delete</span></div>
          <p style={{ ...muted, paddingBottom: 8 }}>
            Only possible while nothing has been raised from this template. Once it has generated
            a bill the server refuses — pause it instead, which keeps the history and stops it
            appearing on the due list.
          </p>
          {confirmingDelete ? (
            <>
              <span style={{ fontSize: 13, marginRight: 8 }}>Delete <strong>{t.name}</strong>?</span>
              <button className="ent-ia ent-ia-del" disabled={busy} onClick={handleDelete}>{busy ? "Deleting…" : "Yes, delete"}</button>
              <button className="ent-ia ent-ia-edit" style={{ marginLeft: 6 }} onClick={() => setConfirmingDelete(false)}>Cancel</button>
            </>
          ) : (
            <button className="ent-ia ent-ia-del" onClick={() => { setConfirmingDelete(true); setActionError(null); }}>Delete Recurring Expense</button>
          )}
        </div>
      )}
    </AppShell>
  );
}