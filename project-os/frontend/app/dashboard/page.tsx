"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "../../components/layout/AppShell";
import { getName } from "../../lib/auth";
import { getProjects, ApiError } from "../../lib/api";
import { Project } from "../../lib/types";

export default function DashboardPage() {
  return (
    <AppShell>
      <DashboardInner />
    </AppShell>
  );
}

function DashboardInner() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProjects()
      .then(({ data }) => setProjects(data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load projects."))
      .finally(() => setLoading(false));
  }, []);

  const active = projects.filter((p) => !["CLOSED"].includes(p.status)).length;

  return (
    <>
      <div className="pos-page-hdr">
        <div>
          <h1 className="pos-page-title">Welcome{getName() ? `, ${getName()}` : ""}</h1>
          <p className="pos-page-sub">R1 Pilot — a quick look at your projects.</p>
        </div>
      </div>

      {error && <p className="pos-error mb-4">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="pos-section">
          <div className="text-xs text-slate-500 mb-1">Total projects</div>
          <div className="text-2xl font-semibold text-slate-900">{loading ? "—" : projects.length}</div>
        </div>
        <div className="pos-section">
          <div className="text-xs text-slate-500 mb-1">Not yet closed</div>
          <div className="text-2xl font-semibold text-slate-900">{loading ? "—" : active}</div>
        </div>
        <div className="pos-section flex flex-col justify-center">
          <Link href="/projects" className="pos-btn-primary text-center">
            Go to Projects
          </Link>
        </div>
      </div>

      <div className="pos-section">
        <div className="pos-section-title">Recent projects</div>
        {loading ? (
          <p className="pos-empty">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="pos-empty">No projects yet — create one from the Projects page.</p>
        ) : (
          <div className="pos-table-wrap">
            <table className="pos-table pos-table-clickable">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {projects.slice(0, 5).map((p) => (
                  <tr key={p.id} onClick={() => (window.location.href = `/projects/${p.id}`)}>
                    <td>{p.code}</td>
                    <td>{p.name}</td>
                    <td>{p.status}</td>
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
