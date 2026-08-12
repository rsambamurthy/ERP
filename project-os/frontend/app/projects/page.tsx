"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "../../components/layout/AppShell";
import { canManageProjects } from "../../lib/auth";
import { createProject, getProjects, getSyncedCustomers, ApiError } from "../../lib/api";
import { PROJECT_STATUS_LABELS, Project, SyncedBusinessPartner } from "../../lib/types";

export default function ProjectsPage() {
  return (
    <AppShell>
      <ProjectsInner />
    </AppShell>
  );
}

function ProjectsInner() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [customers, setCustomers] = useState<SyncedBusinessPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  function load() {
    setLoading(true);
    getProjects()
      .then(({ data }) => setProjects(data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load projects."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // Customers come from SmartERP sync (Settings > Integration) — an
    // empty list here just means nothing's been synced yet, not an
    // error, so it's fetched separately and failures are swallowed the
    // same way the BOQ page treats its own synced-items lookup.
    getSyncedCustomers().then(({ data }) => setCustomers(data)).catch(() => {});
  }, []);

  return (
    <>
      <div className="pos-page-hdr">
        <div>
          <h1 className="pos-page-title">Projects</h1>
          <p className="pos-page-sub">Section 6.2 — code, name, dates, PO approval threshold.</p>
        </div>
        {canManageProjects() && (
          <div className="pos-toolbar">
            <button className="pos-btn-primary" onClick={() => setShowForm((s) => !s)}>
              {showForm ? "Cancel" : "New project"}
            </button>
          </div>
        )}
      </div>

      {showForm && (
        <NewProjectForm
          customers={customers}
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {error && <p className="pos-error mb-4">{error}</p>}

      <div className="pos-table-wrap">
        <table className="pos-table pos-table-clickable">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Start</th>
              <th>Target end</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="pos-empty">Loading…</td>
              </tr>
            ) : projects.length === 0 ? (
              <tr>
                <td colSpan={6} className="pos-empty">No projects yet.</td>
              </tr>
            ) : (
              projects.map((p) => (
                <tr key={p.id} onClick={() => router.push(`/projects/${p.id}`)}>
                  <td className="font-medium text-slate-900">{p.code}</td>
                  <td>{p.name}</td>
                  <td>{p.customer?.name ?? "—"}</td>
                  <td>{PROJECT_STATUS_LABELS[p.status as keyof typeof PROJECT_STATUS_LABELS] ?? p.status}</td>
                  <td>{p.startDate ? new Date(p.startDate).toLocaleDateString() : "—"}</td>
                  <td>{p.targetEndDate ? new Date(p.targetEndDate).toLocaleDateString() : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function NewProjectForm({ customers, onCreated }: { customers: SyncedBusinessPartner[]; onCreated: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [targetEndDate, setTargetEndDate] = useState("");
  const [poApprovalThreshold, setPoApprovalThreshold] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await createProject({
        code,
        name,
        customerId: customerId || null,
        startDate: startDate || null,
        targetEndDate: targetEndDate || null,
        poApprovalThreshold: poApprovalThreshold ? Number(poApprovalThreshold) : null,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create project.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pos-section">
      <div className="pos-section-title">New project</div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="pos-form-grid">
          <div className="pos-field">
            <label className="pos-label">Code *</label>
            <input className="pos-input" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. P001" />
          </div>
          <div className="pos-field">
            <label className="pos-label">Name *</label>
            <input className="pos-input" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="pos-field">
            <label className="pos-label">Customer</label>
            <select className="pos-select" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">— none —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {customers.length === 0 && (
              <p className="text-xs text-slate-400 mt-1">
                No customers synced yet — connect SmartERP in Settings &gt; Integration.
              </p>
            )}
          </div>
          <div className="pos-field">
            <label className="pos-label">Start date</label>
            <input type="date" className="pos-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="pos-field">
            <label className="pos-label">Target end date</label>
            <input type="date" className="pos-input" value={targetEndDate} onChange={(e) => setTargetEndDate(e.target.value)} />
          </div>
          <div className="pos-field">
            <label className="pos-label">PO approval threshold (₹)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="pos-input"
              value={poApprovalThreshold}
              onChange={(e) => setPoApprovalThreshold(e.target.value)}
              placeholder="Leave blank to always require manual approval"
            />
          </div>
        </div>
        {error && <p className="pos-error">{error}</p>}
        <div>
          <button type="submit" className="pos-btn-primary" disabled={saving}>
            {saving ? "Creating…" : "Create project"}
          </button>
        </div>
      </form>
    </div>
  );
}
