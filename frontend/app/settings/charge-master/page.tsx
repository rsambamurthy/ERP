"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import {
  ApiError, createChargeType, getAccounts, getChargeTypes, toggleChargeType, updateChargeType,
} from "@/lib/api";
import type { ChargeType } from "@/lib/api";

// Charge Master. The labels a Sales Invoice may put on freight, packing and
// insurance, each bound to the income account it credits.
//
// The screen exists because the alternative failed: charges shipped with a
// free-text label, and a free-text label drifts. "Delivery charges",
// "Delivery Charges", "Delivery", "Frieght" — one thing, four rows, and no
// report able to add them up. The account was always the stable key. Here
// the label is bound to it once and chosen thereafter.
//
// There is no rate column and there will not be one: a charge is prorated
// across the goods on the invoice and taxed at THEIR rate, because section
// 8(a) taxes a composite supply at the rate of the principal supply. A rate
// box here would be a way to get that wrong on every invoice.

function ChargeMasterInner() {
  const [types, setTypes] = useState<ChargeType[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; accountCode: string; accountName: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [label, setLabel] = useState("");
  const [accountId, setAccountId] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editAccountId, setEditAccountId] = useState("");
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    try {
      // Inactive ones included: this is the only screen that can bring a
      // retired charge type back, so it is the only one that must see them.
      const res = await getChargeTypes(true);
      setTypes(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load charge types.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  // Every INCOME account except Sales Revenue, which the server refuses.
  // Excluding it here as well means nobody is ever offered a choice that
  // will come back as an error.
  useEffect(() => {
    getAccounts()
      .then((res) => setAccounts(
        res.data.filter((a) => a.accountType === "INCOME" && !a.isGroup && a.accountCode !== "5001")
      ))
      .catch(() => setAccounts([]));
  }, []);

  const activeCount = useMemo(() => types.filter((t) => t.isActive).length, [types]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createChargeType({ label: label.trim(), accountId, sortOrder: (types.length + 1) * 10 });
      setShowForm(false);
      setLabel(""); setAccountId("");
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the charge type.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(t: ChargeType) {
    setEditingId(t.id);
    setEditLabel(t.label);
    setEditAccountId(t.accountId);
    setRowError(null);
  }

  async function handleSaveEdit(id: string) {
    setRowBusy(id);
    setRowError(null);
    try {
      await updateChargeType(id, { label: editLabel.trim(), accountId: editAccountId });
      setEditingId(null);
      await loadAll();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Could not save the change.");
    } finally {
      setRowBusy(null);
    }
  }

  async function handleToggle(t: ChargeType) {
    setRowBusy(t.id);
    setRowError(null);
    try {
      await toggleChargeType(t.id);
      await loadAll();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Could not change that.");
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <>
      <div className="ent-page-hdr">
        <h1>Charge Master</h1>
        <p>
          What a Sales Invoice may charge on top of the goods — delivery, packing, insurance — and the income
          account each one credits. Chosen on the invoice rather than typed, so the same charge reads the same way
          on every document and can actually be totalled. There is no tax rate here on purpose: a charge is spread
          across the goods on the invoice and taxed at their rate, as a composite supply.
        </p>
      </div>

      <div className="ent-toolbar">
        <div style={{ flex: 1 }} />
        <button className="ent-btn-add" onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "+ New Charge"}</button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="ent-section">
          <div className="ent-section-hdr"><span className="ent-section-title">New Charge Type</span></div>
          <div className="ent-form-grid" style={{ gridTemplateColumns: "1fr 1.4fr" }}>
            <div className="ent-fg">
              <label className="ent-fl">Label</label>
              <input
                className="ent-fc" maxLength={60} placeholder="e.g. Delivery charges"
                value={label} onChange={(e) => setLabel(e.target.value)} required
              />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Credits</label>
              <select className="ent-fc" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
                <option value="">Select an income account…</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.accountCode} {a.accountName}</option>)}
              </select>
            </div>
          </div>
          <p style={{ fontSize: 11.5, color: "var(--color-muted)", padding: "0 14px 8px" }}>
            Not Sales Revenue. Recovered freight is only worth separating if it can be read against freight paid,
            and crediting it to Sales Revenue makes that impossible to reconstruct later. If the head you want
            does not exist yet, add it in Chart of Accounts as an INCOME account first.
          </p>
          {error && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 10px" }}>{error}</p>}
          <div style={{ padding: "0 14px 14px" }}>
            <button type="submit" className="ent-btn-save" disabled={saving || !label.trim() || !accountId}>
              {saving ? "Saving…" : "Save Charge"}
            </button>
          </div>
        </form>
      )}

      {error && !showForm && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {rowError && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{rowError}</p>}

      <div className="ent-page-table">
        <table>
          <thead>
            <tr>
              <th style={{ width: "32%" }}>Charge</th>
              <th style={{ width: "44%" }}>Credits</th>
              <th style={{ width: "10%" }}>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={4} className="ent-empty">Loading…</td></tr>}
            {!loading && types.length === 0 && (
              <tr><td colSpan={4} className="ent-empty">
                No charge types yet — until one exists, an invoice cannot carry a delivery or packing charge.
              </td></tr>
            )}
            {types.map((t) => (
              <tr key={t.id} style={t.isActive ? undefined : { opacity: 0.55 }}>
                <td style={{ fontWeight: 500 }}>
                  {editingId === t.id ? (
                    <input className="ent-fc" maxLength={60} value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
                  ) : t.label}
                </td>
                <td>
                  {editingId === t.id ? (
                    <select className="ent-fc" value={editAccountId} onChange={(e) => setEditAccountId(e.target.value)}>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.accountCode} {a.accountName}</option>)}
                    </select>
                  ) : `${t.account.accountCode} ${t.account.accountName}`}
                </td>
                <td>{t.isActive ? "Active" : "Retired"}</td>
                <td style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  {editingId === t.id ? (
                    <>
                      <button type="button" className="ent-ia ent-ia-edit" disabled={rowBusy === t.id} onClick={() => handleSaveEdit(t.id)}>
                        {rowBusy === t.id ? "Saving…" : "Save"}
                      </button>
                      <button type="button" className="ent-ia ent-ia-edit" onClick={() => setEditingId(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="ent-ia ent-ia-edit" onClick={() => startEdit(t)}>Edit</button>
                      <button
                        type="button" className={t.isActive ? "ent-ia ent-ia-del" : "ent-ia ent-ia-edit"}
                        disabled={rowBusy === t.id} onClick={() => handleToggle(t)}
                        title={t.isActive
                          ? "Take it out of the invoice picker. Invoices that already used it are untouched."
                          : "Offer it on invoices again."}
                      >
                        {rowBusy === t.id ? "…" : t.isActive ? "Retire" : "Reactivate"}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Retiring rather than deleting is not squeamishness. A charge type
          that has been used is pointed at by invoices; deleting it would
          either fail on the foreign key or take the link with it, leaving a
          report unable to say what a recovery was for. */}
      {!loading && types.length > 0 && (
        <p style={{ fontSize: 11.5, color: "var(--color-muted)", marginTop: 10 }}>
          {activeCount} active of {types.length}. A charge type is retired, never deleted — invoices that already
          carry it keep the label and account they were posted with.
        </p>
      )}
    </>
  );
}

export default function ChargeMasterPage() {
  return (
    <AppShell>
      <ChargeMasterInner />
    </AppShell>
  );
}
