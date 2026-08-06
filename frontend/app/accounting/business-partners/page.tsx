"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { ApiError, createBusinessPartner, getBusinessPartners, toggleBusinessPartner } from "@/lib/api";
import { useBulkUpload } from "@/components/shared/BulkUpload";
import type { BpUploadRow, BusinessPartner } from "@/lib/types";

const BP_UPLOAD_COLUMNS: { key: keyof BpUploadRow; label: string }[] = [
  { key: "bpType", label: "Type" },
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "openingBalance", label: "Opening Balance" },
  { key: "openingBalanceType", label: "DR/CR" },
];

export default function BusinessPartnersPage() {
  const [bpType, setBpType] = useState<"CUSTOMER" | "VENDOR">("CUSTOMER");
  const [partners, setPartners] = useState<BusinessPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({ name: "", gstin: "", phone: "", email: "" });

  async function load() {
    setLoading(true);
    try {
      const res = await getBusinessPartners(bpType);
      setPartners(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load business partners.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bpType]);

  const bulk = useBulkUpload<BpUploadRow>("business-partners", "SmartERP_BusinessPartners_Template.xlsx", BP_UPLOAD_COLUMNS, load);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createBusinessPartner({
        bpType, name: form.name,
        gstin: form.gstin || null, phone: form.phone || null, email: form.email || null,
      });
      setShowForm(false);
      setForm({ name: "", gstin: "", phone: "", email: "" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create business partner.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id: string) {
    await toggleBusinessPartner(id);
    await load();
  }

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Business Partners</h1>
        <p>Customers and vendors — the sub-ledger behind your control accounts.</p>
      </div>

      <div className="ent-tabs">
        {(["CUSTOMER", "VENDOR"] as const).map((t) => (
          <button key={t} className={`ent-tab${bpType === t ? " active" : ""}`} onClick={() => setBpType(t)}>
            {t === "CUSTOMER" ? "Customers" : "Vendors"}
          </button>
        ))}
      </div>

      <div className="ent-toolbar">
        <div style={{ flex: 1 }} />
        {bulk.buttons}
        <button className="ent-btn-add" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : `+ Add ${bpType === "CUSTOMER" ? "Customer" : "Vendor"}`}
        </button>
      </div>

      {bulk.panel}

      {showForm && (
        <form onSubmit={handleCreate} className="ent-section">
          <div className="ent-section-hdr"><span className="ent-section-title">New {bpType === "CUSTOMER" ? "Customer" : "Vendor"}</span></div>
          <div className="ent-form-grid">
            <div className="ent-fg"><label className="ent-fl">Name</label><input className="ent-fc" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required /></div>
            <div className="ent-fg"><label className="ent-fl">GSTIN (optional)</label><input className="ent-fc" value={form.gstin} onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value }))} /></div>
            <div className="ent-fg"><label className="ent-fl">Phone (optional)</label><input className="ent-fc" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
            <div className="ent-fg"><label className="ent-fl">Email (optional)</label><input className="ent-fc" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
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
          <thead><tr><th>Name</th><th>GSTIN</th><th>Contact</th><th>Status</th><th /></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="ent-empty">Loading…</td></tr>}
            {!loading && partners.length === 0 && <tr><td colSpan={5} className="ent-empty">None yet.</td></tr>}
            {partners.map((p) => (
              <tr key={p.id}>
                <td style={{ fontWeight: 500 }}>{p.name}</td>
                <td style={{ color: "var(--color-muted)" }}>{p.gstin || "—"}</td>
                <td style={{ color: "var(--color-muted)" }}>{p.phone || p.email || "—"}</td>
                <td><span className={p.isActive ? "badge badge-green" : "badge badge-gray"}>{p.isActive ? "Active" : "Inactive"}</span></td>
                <td style={{ textAlign: "right" }}>
                  <button className="ent-ia ent-ia-edit" onClick={() => handleToggle(p.id)}>{p.isActive ? "Deactivate" : "Activate"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
