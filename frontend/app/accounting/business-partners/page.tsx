"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { ApiError, createBusinessPartner, getBusinessPartners, toggleBusinessPartner } from "@/lib/api";
import { useBulkUpload } from "@/components/shared/BulkUpload";
import { GST_STATE_CODES } from "@/lib/gstStates";
import { VENDOR_CATEGORIES, TAX_ID_TYPE_SUGGESTIONS } from "@/lib/types";
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
  const [search, setSearch] = useState("");

  const [form, setForm] = useState({
    name: "", gstin: "", stateCode: "", phone: "", email: "",
    vendorCategory: "", taxIdType: "", taxId: "",
  });

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

  // Filtering happens here rather than server-side because the rows are
  // already in memory — this list endpoint has no pagination, so an org with
  // ~10k partners has all of them client-side either way. One pass over an
  // array of that size per keystroke is imperceptible; the round trip
  // wouldn't be.
  const visiblePartners = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return partners;
    return partners.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.code ?? "").toLowerCase().includes(q) ||
        (p.phone ?? "").toLowerCase().includes(q)
    );
  }, [partners, search]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createBusinessPartner({
        bpType, name: form.name,
        gstin: form.gstin || null, stateCode: form.stateCode || null,
        phone: form.phone || null, email: form.email || null,
        ...(bpType === "VENDOR" ? {
          vendorCategory: form.vendorCategory || null,
          taxIdType: form.taxIdType || null,
          taxId: form.taxId || null,
        } : {}),
      });
      setShowForm(false);
      setForm({ name: "", gstin: "", stateCode: "", phone: "", email: "", vendorCategory: "", taxIdType: "", taxId: "" });
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
        <input
          className="ent-fc"
          style={{ flex: "1 1 320px", maxWidth: 420, height: 34 }}
          placeholder="Search by name, phone or code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <span style={{ fontSize: 12.5, color: "var(--color-muted)", whiteSpace: "nowrap" }}>
            {visiblePartners.length} of {partners.length}
            <button
              type="button"
              className="ent-ia ent-ia-edit"
              style={{ marginLeft: 8 }}
              onClick={() => setSearch("")}
            >
              Clear
            </button>
          </span>
        )}
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
            <div className="ent-fg">
              <label className="ent-fl">State (GST)</label>
              <select className="ent-fc" value={form.stateCode} onChange={(e) => setForm((f) => ({ ...f, stateCode: e.target.value }))}>
                <option value="">Auto from GSTIN, or select…</option>
                {GST_STATE_CODES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select>
            </div>
            <div className="ent-fg"><label className="ent-fl">Phone (optional)</label><input className="ent-fc" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
            <div className="ent-fg"><label className="ent-fl">Email (optional)</label><input className="ent-fc" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
            {bpType === "VENDOR" && (
              <>
                <div className="ent-fg">
                  <label className="ent-fl">Vendor Category (optional)</label>
                  <input className="ent-fc" list="vendor-category-list" value={form.vendorCategory} onChange={(e) => setForm((f) => ({ ...f, vendorCategory: e.target.value }))} />
                  <datalist id="vendor-category-list">{VENDOR_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
                </div>
                <div className="ent-fg">
                  <label className="ent-fl">Tax ID Type (optional, non-India)</label>
                  <input className="ent-fc" list="tax-id-type-list" placeholder="e.g. EIN, VAT No." value={form.taxIdType} onChange={(e) => setForm((f) => ({ ...f, taxIdType: e.target.value }))} />
                  <datalist id="tax-id-type-list">{TAX_ID_TYPE_SUGGESTIONS.map((t) => <option key={t} value={t} />)}</datalist>
                </div>
                <div className="ent-fg"><label className="ent-fl">Tax ID (optional)</label><input className="ent-fc" value={form.taxId} onChange={(e) => setForm((f) => ({ ...f, taxId: e.target.value }))} /></div>
              </>
            )}
          </div>
          <p style={{ fontSize: 12, color: "var(--color-muted)", padding: "0 14px 6px" }}>
            Contacts, addresses, and bank accounts can be added after saving, from the vendor&apos;s detail page.
          </p>
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
              <th>Code</th><th>Name</th><th>GSTIN</th><th>Contact</th>
              {bpType === "VENDOR" && <th>Approval</th>}
              <th>Status</th><th /></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={bpType === "VENDOR" ? 7 : 6} className="ent-empty">Loading…</td></tr>}
            {!loading && partners.length === 0 && <tr><td colSpan={bpType === "VENDOR" ? 7 : 6} className="ent-empty">None yet.</td></tr>}
            {!loading && partners.length > 0 && visiblePartners.length === 0 && (
              <tr><td colSpan={bpType === "VENDOR" ? 7 : 6} className="ent-empty">No match for “{search}”.</td></tr>
            )}
            {visiblePartners.map((p) => (
              <tr key={p.id}>
                <td style={{ color: "var(--color-muted)", fontVariantNumeric: "tabular-nums" }}>{p.code || "—"}</td>
                <td style={{ fontWeight: 500 }}>
                  <Link href={`/accounting/business-partners/${p.id}`} style={{ color: "inherit", textDecoration: "none" }}>
                    {p.name}
                  </Link>
                </td>
                <td style={{ color: "var(--color-muted)" }}>{p.gstin || "—"}</td>
                <td style={{ color: "var(--color-muted)" }}>{p.phone || p.email || "—"}</td>
                {bpType === "VENDOR" && (
                  <td>
                    <span className={
                      p.approvalStatus === "APPROVED" ? "badge badge-green"
                        : p.approvalStatus === "REJECTED" ? "badge badge-red" : "badge badge-yellow"
                    }>
                      {p.approvalStatus === "PENDING_APPROVAL" ? "Pending" : p.approvalStatus === "APPROVED" ? "Approved" : "Rejected"}
                    </span>
                  </td>
                )}
                <td><span className={p.isActive ? "badge badge-green" : "badge badge-gray"}>{p.isActive ? "Active" : "Inactive"}</span></td>
                <td style={{ textAlign: "right" }}>
                  <Link href={`/accounting/business-partners/${p.id}`} className="ent-ia ent-ia-edit" style={{ marginRight: 6 }}>View</Link>
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
