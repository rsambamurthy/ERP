"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { ApiError, createBusinessPartner, getBusinessPartners, toggleBusinessPartner } from "@/lib/api";
import type { BusinessPartner } from "@/lib/types";

const selectClass =
  "rounded-lg border border-cream-200 bg-cream-50 px-3 py-2.5 text-sm outline-none focus:border-terracotta-400 focus:ring-1 focus:ring-terracotta-400";

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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createBusinessPartner({
        bpType,
        name: form.name,
        gstin: form.gstin || null,
        phone: form.phone || null,
        email: form.email || null,
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
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-navy-800">Business Partners</h1>
            <p className="text-sm text-gray-500">Customers and vendors — the sub-ledger behind your control accounts.</p>
          </div>
          <Button onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : `Add ${bpType === "CUSTOMER" ? "Customer" : "Vendor"}`}</Button>
        </div>

        <div className="flex gap-2">
          {(["CUSTOMER", "VENDOR"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setBpType(t)}
              className={`rounded-lg px-4 py-2 text-sm font-medium ${
                bpType === t ? "bg-terracotta-500 text-white" : "bg-white text-navy-800 border border-cream-200"
              }`}
            >
              {t === "CUSTOMER" ? "Customers" : "Vendors"}
            </button>
          ))}
        </div>

        {showForm && (
          <form onSubmit={handleCreate} className="flex flex-col gap-4 rounded-2xl border border-cream-200 bg-white p-5 shadow-sm">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              <Input label="GSTIN (optional)" value={form.gstin} onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value }))} />
              <Input label="Phone (optional)" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              <Input label="Email (optional)" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div><Button type="submit" loading={saving}>Save</Button></div>
          </form>
        )}

        {error && !showForm && <p className="text-sm text-red-600">{error}</p>}

        <div className="overflow-hidden rounded-2xl border border-cream-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-cream-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">GSTIN</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">Loading…</td></tr>}
              {!loading && partners.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">None yet.</td></tr>
              )}
              {partners.map((p) => (
                <tr key={p.id} className="border-t border-cream-100">
                  <td className="px-4 py-2.5 font-medium text-navy-800">{p.name}</td>
                  <td className="px-4 py-2.5 text-gray-500">{p.gstin || "—"}</td>
                  <td className="px-4 py-2.5 text-gray-500">{p.phone || p.email || "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className={p.isActive ? "text-green-600" : "text-gray-400"}>{p.isActive ? "Active" : "Inactive"}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => handleToggle(p.id)} className="text-xs font-medium text-terracotta-600 hover:underline">
                      {p.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
