"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { ApiError, createBranch, deleteBranch, getBranches, toggleBranch, updateBranch } from "@/lib/api";
import type { Branch } from "@/lib/types";

const emptyForm = () => ({
  code: "", name: "", gstin: "", phone: "", email: "", addressText: "", isHeadOffice: false,
});
type FormState = ReturnType<typeof emptyForm>;

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await getBranches();
      setBranches(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load branches.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function startNew() {
    setEditingId(null);
    setForm(emptyForm());
    setError(null);
    setShowForm(true);
  }

  function startEdit(b: Branch) {
    setEditingId(b.id);
    setForm({
      code: b.code, name: b.name, gstin: b.gstin ?? "", phone: b.phone ?? "", email: b.email ?? "",
      addressText: typeof b.address === "string" ? b.address : b.address ? JSON.stringify(b.address) : "",
      isHeadOffice: b.isHeadOffice,
    });
    setError(null);
    setShowForm(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = {
        code: form.code, name: form.name,
        gstin: form.gstin || undefined, phone: form.phone || undefined, email: form.email || undefined,
        address: form.addressText || undefined,
        isHeadOffice: form.isHeadOffice,
      };
      if (editingId) {
        await updateBranch(editingId, body);
      } else {
        await createBranch(body);
      }
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm());
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save branch.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id: string) {
    try {
      await toggleBranch(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update branch status.");
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteBranch(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete branch.");
    }
  }

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Branches</h1>
        <p>Your organization's locations — used to scope stock, invoices, and team assignments.</p>
      </div>

      <div className="ent-toolbar">
        <div style={{ flex: 1 }} />
        <button className="ent-btn-add" onClick={() => (showForm ? setShowForm(false) : startNew())}>
          {showForm ? "Cancel" : "+ New Branch"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSave} className="ent-section">
          <div className="ent-section-hdr">
            <span className="ent-section-title">{editingId ? "Edit Branch" : "New Branch"}</span>
          </div>
          <div className="ent-form-grid">
            <div className="ent-fg">
              <label className="ent-fl">Code</label>
              <input className="ent-fc" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} required />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Name</label>
              <input className="ent-fc" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">GSTIN (optional)</label>
              <input
                className="ent-fc" value={form.gstin} placeholder="29ABCDE1234F1Z5" maxLength={15}
                onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value.toUpperCase() }))}
              />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Phone</label>
              <input className="ent-fc" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="ent-fg">
              <label className="ent-fl">Email</label>
              <input className="ent-fc" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="ent-fg" style={{ gridColumn: "1 / -1" }}>
              <label className="ent-fl">Address</label>
              <textarea
                className="ent-fc" style={{ minHeight: 60 }}
                value={form.addressText}
                onChange={(e) => setForm((f) => ({ ...f, addressText: e.target.value }))}
              />
            </div>
            <div className="ent-fg" style={{ gridColumn: "1 / -1" }}>
              <label className="ent-fl" style={{ textTransform: "none" }}>
                <input
                  type="checkbox"
                  checked={form.isHeadOffice}
                  onChange={(e) => setForm((f) => ({ ...f, isHeadOffice: e.target.checked }))}
                  style={{ marginRight: 6 }}
                />
                Head office (only one branch can hold this — setting it here un-flags whichever branch had it before)
              </label>
            </div>
          </div>
          {error && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 10px" }}>{error}</p>}
          <div style={{ padding: "0 14px 14px" }}>
            <button type="submit" className="ent-btn-save" disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save Changes" : "Create Branch"}
            </button>
          </div>
        </form>
      )}

      {error && !showForm && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="ent-page-table">
        <table>
          <thead><tr><th>Code</th><th>Name</th><th>GSTIN</th><th>Head Office</th><th>Status</th><th /></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="ent-empty">Loading…</td></tr>}
            {!loading && branches.length === 0 && <tr><td colSpan={6} className="ent-empty">No branches yet.</td></tr>}
            {branches.map((b) => (
              <tr key={b.id}>
                <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--color-muted)" }}>{b.code}</td>
                <td style={{ fontWeight: 500 }}>{b.name}</td>
                <td style={{ color: "var(--color-muted)" }}>{b.gstin || "—"}</td>
                <td>{b.isHeadOffice && <span className="badge badge-purple">Head Office</span>}</td>
                <td>
                  <span className={b.status === "ACTIVE" ? "badge badge-green" : "badge badge-gray"}>
                    {b.status === "ACTIVE" ? "Active" : "Inactive"}
                  </span>
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button className="ent-ia ent-ia-edit" onClick={() => startEdit(b)}>Edit</button>
                  {!b.isHeadOffice && (
                    <>
                      <button className="ent-ia ent-ia-edit" onClick={() => handleToggle(b.id)}>
                        {b.status === "ACTIVE" ? "Deactivate" : "Activate"}
                      </button>
                      <button className="ent-ia ent-ia-del" onClick={() => handleDelete(b.id)}>Delete</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
