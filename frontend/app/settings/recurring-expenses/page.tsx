"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import PartnerPicker from "@/components/shared/PartnerPicker";
import ItemPicker from "@/components/shared/ItemPicker";
import {
  ApiError, createRecurringExpense, getBusinessPartnerLookup, getItems,
  getRecurringExpenses, toggleRecurringExpense,
} from "@/lib/api";
import type { BusinessPartnerLookup, Item, RecurringExpenseSummary } from "@/lib/types";

// Recurring Expenses — configuration. Nothing on this screen posts anything;
// it defines what the monthly due list (Phase 3) will offer to post.
//
// Lines can only reference SERVICE items. A recurring rent template pointing
// at a stock item would post to a stock account and try to receive goods
// that never arrive — the server rejects it, and the picker below is
// filtered to match so it never comes up.

const emptyLine = () => ({ itemId: "", quantity: "1", rate: "", taxRate: "0" });

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
}

export default function RecurringExpensesPage() {
  const [rows, setRows] = useState<RecurringExpenseSummary[]>([]);
  const [vendors, setVendors] = useState<BusinessPartnerLookup[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const [form, setForm] = useState({
    name: "", businessPartnerId: "", dayOfMonth: "1",
    startMonth: currentMonth(), endMonth: "",
    amountMode: "FIXED" as "FIXED" | "PROMPTED",
    narration: "",
  });
  const [lines, setLines] = useState([emptyLine()]);

  async function load() {
    setLoading(true);
    try {
      const [listRes, vendorRes, itemRes] = await Promise.all([
        getRecurringExpenses(), getBusinessPartnerLookup("VENDOR"), getItems(),
      ]);
      setRows(listRes.data);
      setVendors(vendorRes.data);
      setItems(itemRes.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load recurring expenses.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const serviceItems = useMemo(
    () => items.filter((i) => i.isActive && i.itemKind === "SERVICE"),
    [items]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.name.toLowerCase().includes(q) || r.businessPartner.name.toLowerCase().includes(q)
    );
  }, [rows, search]);

  function updateLine(i: number, patch: Partial<ReturnType<typeof emptyLine>>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  // Picking an item seeds rate and tax from the item master, the same way
  // Purchase Bills does — a recurring template is a purchase bill waiting to
  // happen, so it should default identically. Both stay editable: the master
  // rate is a starting point, not a rule.
  //
  // The rate is deliberately left alone on a PROMPTED template, where the
  // whole point is that the amount isn't known until the month it's raised
  // and the field is disabled anyway.
  function pickItem(i: number, itemId: string) {
    const item = serviceItems.find((it) => it.id === itemId);
    updateLine(i, {
      itemId,
      ...(form.amountMode === "PROMPTED"
        ? {}
        : { rate: item?.purchaseRate ? String(Number(item.purchaseRate)) : "" }),
      taxRate: item?.taxRate ? String(Number(item.taxRate)) : "0",
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createRecurringExpense({
        name: form.name,
        businessPartnerId: form.businessPartnerId,
        dayOfMonth: Number(form.dayOfMonth),
        startMonth: form.startMonth,
        endMonth: form.endMonth || null,
        amountMode: form.amountMode,
        narration: form.narration || null,
        lines: lines
          .filter((l) => l.itemId)
          .map((l) => ({
            itemId: l.itemId,
            quantity: Number(l.quantity || 1),
            // A prompted template deliberately carries no rate — the amount
            // is entered on the month it's raised.
            rate: form.amountMode === "PROMPTED" ? null : Number(l.rate || 0),
            taxRate: Number(l.taxRate || 0),
          })),
      });
      setShowForm(false);
      setForm({
        name: "", businessPartnerId: "", dayOfMonth: "1",
        startMonth: currentMonth(), endMonth: "", amountMode: "FIXED", narration: "",
      });
      setLines([emptyLine()]);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the recurring expense.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id: string) {
    try {
      await toggleRecurringExpense(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change status.");
    }
  }

  const muted = { color: "var(--color-muted)", fontSize: 12 } as const;

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Recurring Expenses</h1>
        <p>Monthly expenses that post as Purchase Bills against a vendor — rent, telecom, subscriptions, retainers.</p>
      </div>

      {serviceItems.length === 0 && !loading && (
        <div className="ent-section" style={{ marginBottom: 16, padding: 14 }}>
          <p style={{ fontSize: 13, margin: 0 }}>
            You have no service items yet. A recurring expense bills service items, not stock —
            create one first on the <Link href="/inventory/items" className="ent-ia ent-ia-edit" style={{ padding: 0 }}>Items</Link>{" "}
            screen with Kind set to <strong>Service / expense</strong>, pointing at the expense account it should hit.
          </p>
        </div>
      )}

      <div className="ent-toolbar">
        <input
          className="ent-fc"
          style={{ flex: "1 1 300px", maxWidth: 400, height: 34 }}
          placeholder="Search by name or vendor…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <span style={{ ...muted, whiteSpace: "nowrap" }}>
            {visible.length} of {rows.length}
            <button type="button" className="ent-ia ent-ia-edit" style={{ marginLeft: 8 }} onClick={() => setSearch("")}>Clear</button>
          </span>
        )}
        <div style={{ flex: 1 }} />
        <Link href="/purchase/recurring-due" className="ent-ia ent-ia-edit" style={{ marginRight: 8 }}>
          What&rsquo;s due this month →
        </Link>
        <button className="ent-btn-add" disabled={serviceItems.length === 0} onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "+ New Recurring Expense"}
        </button>
      </div>

      {/* The form's overflow must stay visible: .ent-section clips to its
          rounded corners, which would swallow the ItemPicker dropdown
          opening downward out of the last line row. */}
      {showForm && (
        <form onSubmit={handleCreate} className="ent-section" style={{ marginBottom: 16, overflow: "visible" }}>
          {/* The rounded top corners came from the section's overflow: hidden,
              which is now off — so the header rounds itself instead. */}
          <div className="ent-section-hdr" style={{ borderRadius: "6px 6px 0 0" }}>
            <span className="ent-section-title">New Recurring Expense</span>
          </div>
          <div className="ent-form-grid">
            <div className="ent-fg">
              <label className="ent-fl">Name</label>
              <input className="ent-fc" placeholder="Head office rent" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Vendor</label>
              <PartnerPicker
                partners={vendors}
                value={form.businessPartnerId || null}
                onChange={(id) => setForm((f) => ({ ...f, businessPartnerId: id ?? "" }))}
                required
              />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Day of Month</label>
              <input type="number" min={1} max={28} className="ent-fc" value={form.dayOfMonth} onChange={(e) => setForm((f) => ({ ...f, dayOfMonth: e.target.value }))} required />
              <span style={muted}>1–28. Higher numbers would need a rule for what the 31st of February means.</span>
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Start Month</label>
              <input type="month" className="ent-fc" value={form.startMonth} onChange={(e) => setForm((f) => ({ ...f, startMonth: e.target.value }))} required />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">End Month <span style={{ fontWeight: 400, color: "var(--color-muted)" }}>(optional)</span></label>
              <input type="month" className="ent-fc" value={form.endMonth} onChange={(e) => setForm((f) => ({ ...f, endMonth: e.target.value }))} />
              <span style={muted}>Leave blank for open-ended.</span>
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Amount</label>
              <div style={{ display: "flex", gap: 16, alignItems: "center", minHeight: 34 }}>
                {(["FIXED", "PROMPTED"] as const).map((m) => (
                  <label key={m} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, cursor: "pointer" }}>
                    <input type="radio" name="amount-mode" checked={form.amountMode === m} onChange={() => setForm((f) => ({ ...f, amountMode: m }))} />
                    {m === "FIXED" ? "Fixed" : "Prompted"}
                  </label>
                ))}
              </div>
              <span style={muted}>
                {form.amountMode === "FIXED"
                  ? "Same every month — the due list pre-fills it and you can still override."
                  : "Varies — the rate is left blank here and entered on the month you raise it."}
              </span>
            </div>
            <div className="ent-fg" style={{ gridColumn: "1 / -1" }}>
              <label className="ent-fl">Narration <span style={{ fontWeight: 400, color: "var(--color-muted)" }}>(optional)</span></label>
              <input className="ent-fc" value={form.narration} onChange={(e) => setForm((f) => ({ ...f, narration: e.target.value }))} />
            </div>
          </div>

          {/* Same shape Purchase Bills uses for its line table: a plain
              padded div, not .ent-page-table. That class sets
              overflow: hidden, which clipped the item dropdown here. */}
          <div style={{ padding: "0 14px" }}>
            <table className="ent-table">
              <thead>
                <tr>
                  <th style={{ width: "45%" }}>Service Item</th>
                  <th style={{ width: 90 }}>Qty</th>
                  <th style={{ width: 130 }}>Rate</th>
                  <th style={{ width: 90 }}>Tax %</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i}>
                    <td>
                      <ItemPicker
                        items={serviceItems}
                        value={line.itemId || null}
                        onChange={(id) => pickItem(i, id ?? "")}
                        placeholder="Search service item…"
                      />
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
                      {lines.length > 1 && (
                        <button type="button" className="ent-ia ent-ia-del" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>✕</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "0 14px 10px" }}>
            <button type="button" className="ent-ia ent-ia-edit" onClick={() => setLines((ls) => [...ls, emptyLine()])}>+ Add line</button>
          </div>

          {error && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 10px" }}>{error}</p>}
          <div style={{ padding: "0 14px 14px" }}>
            <button type="submit" className="ent-btn-save" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          </div>
        </form>
      )}

      {error && !showForm && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="ent-page-table">
        <table>
          <thead>
            <tr>
              <th>Name</th><th>Vendor</th><th>Day</th><th>Amount</th>
              <th>Last Raised</th><th>Next Due</th><th>Status</th><th />
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="ent-empty">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={8} className="ent-empty">No recurring expenses yet.</td></tr>}
            {!loading && rows.length > 0 && visible.length === 0 && (
              <tr><td colSpan={8} className="ent-empty">No match for “{search}”.</td></tr>
            )}
            {visible.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 500 }}>
                  <Link href={`/settings/recurring-expenses/${r.id}`} style={{ color: "inherit", textDecoration: "none" }}>{r.name}</Link>
                </td>
                <td style={{ color: "var(--color-muted)" }}>{r.businessPartner.name}</td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.dayOfMonth}</td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>
                  {r.estimatedAmount === null
                    ? <span style={muted}>Prompted</span>
                    : r.estimatedAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </td>
                <td style={{ color: "var(--color-muted)" }}>{monthLabel(r.lastRunMonth)}</td>
                <td>{r.isActive ? monthLabel(r.nextDueMonth) : <span style={muted}>—</span>}</td>
                <td><span className={r.isActive ? "badge badge-green" : "badge badge-gray"}>{r.isActive ? "Active" : "Paused"}</span></td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <Link href={`/settings/recurring-expenses/${r.id}`} className="ent-ia ent-ia-edit" style={{ marginRight: 6 }}>View</Link>
                  <button className="ent-ia ent-ia-edit" onClick={() => handleToggle(r.id)}>{r.isActive ? "Pause" : "Resume"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}