"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AppShell from "../../../components/layout/AppShell";
import { canManageProjects } from "../../../lib/auth";
import { createProjectSite, getProject, getProjectSites, ApiError } from "../../../lib/api";
import { PROJECT_STATUS_LABELS, Project, ProjectSite } from "../../../lib/types";
import { GST_STATE_CODES } from "../../../lib/gstStates";

export default function ProjectDetailPage() {
  return (
    <AppShell>
      <ProjectDetailInner />
    </AppShell>
  );
}

function ProjectDetailInner() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [project, setProject] = useState<Project | null>(null);
  const [sites, setSites] = useState<ProjectSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSiteForm, setShowSiteForm] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([getProject(projectId), getProjectSites(projectId)])
      .then(([p, s]) => {
        setProject(p.data);
        setSites(s.data);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load project."))
      .finally(() => setLoading(false));
  }

  useEffect(load, [projectId]);

  if (loading) return <p className="pos-empty">Loading…</p>;
  if (error) return <p className="pos-error">{error}</p>;
  if (!project) return <p className="pos-empty">Project not found.</p>;

  return (
    <>
      <div className="pos-page-hdr">
        <div>
          <h1 className="pos-page-title">
            {project.name} <span className="text-slate-400 font-normal">({project.code})</span>
          </h1>
          <p className="pos-page-sub">
            {PROJECT_STATUS_LABELS[project.status as keyof typeof PROJECT_STATUS_LABELS] ?? project.status}
          </p>
        </div>
        <div className="pos-toolbar">
          <Link href={`/projects/${projectId}/boq`} className="pos-btn-secondary">
            BOQ &amp; Estimation
          </Link>
          <Link href={`/projects/${projectId}/budget`} className="pos-btn-secondary">
            Budget
          </Link>
        </div>
      </div>

      <div className="pos-section">
        <div className="pos-section-title">Project info</div>
        <div className="pos-form-grid text-sm">
          <div>
            <div className="pos-label">Customer</div>
            <div>{project.customer?.name ?? "—"}</div>
          </div>
          <div>
            <div className="pos-label">Start date</div>
            <div>{project.startDate ? new Date(project.startDate).toLocaleDateString() : "—"}</div>
          </div>
          <div>
            <div className="pos-label">Target end date</div>
            <div>{project.targetEndDate ? new Date(project.targetEndDate).toLocaleDateString() : "—"}</div>
          </div>
          <div>
            <div className="pos-label">PO approval threshold</div>
            <div>{project.poApprovalThreshold ? `₹${Number(project.poApprovalThreshold).toFixed(2)}` : "Always manual"}</div>
          </div>
          <div>
            <div className="pos-label">Created</div>
            <div>{new Date(project.createdAt).toLocaleDateString()}</div>
          </div>
        </div>
      </div>

      <div className="pos-section">
        <div className="pos-page-hdr" style={{ marginBottom: 12 }}>
          <div className="pos-section-title" style={{ marginBottom: 0 }}>
            Sites
          </div>
          {canManageProjects() && (
            <button className="pos-link-btn" onClick={() => setShowSiteForm((s) => !s)}>
              {showSiteForm ? "Cancel" : "+ Add site"}
            </button>
          )}
        </div>

        {showSiteForm && (
          <NewSiteForm
            projectId={projectId}
            onCreated={() => {
              setShowSiteForm(false);
              load();
            }}
          />
        )}

        {sites.length === 0 ? (
          <p className="pos-empty">No sites yet — a site becomes a PROJECT_SITE stock location in Inventory.</p>
        ) : (
          <div className="pos-table-wrap">
            <table className="pos-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>State code</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{s.stateCode ?? "—"}</td>
                    <td>{new Date(s.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function NewSiteForm({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await createProjectSite(projectId, { name, stateCode: stateCode || null });
      setName("");
      setStateCode("");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create site.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-3 mb-4 flex-wrap">
      <div className="pos-field">
        <label className="pos-label">Name *</label>
        <input className="pos-input" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="pos-field">
        <label className="pos-label">State</label>
        <select className="pos-select" value={stateCode} onChange={(e) => setStateCode(e.target.value)}>
          <option value="">— none —</option>
          {GST_STATE_CODES.map((s) => (
            <option key={s.code} value={s.code}>
              {s.code} — {s.name}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="pos-btn-primary" disabled={saving}>
        {saving ? "Adding…" : "Add site"}
      </button>
      {error && <span className="pos-error">{error}</span>}
    </form>
  );
}
