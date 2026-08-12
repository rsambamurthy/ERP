"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import AppShell from "../../../../components/layout/AppShell";
import { canApproveBoqOrBudget, canManageBoq } from "../../../../lib/auth";
import { approveBudgetLine, generateBudget, getBudget, ApiError } from "../../../../lib/api";
import { Budget } from "../../../../lib/types";

export default function BudgetPage() {
  return (
    <AppShell>
      <BudgetInner />
    </AppShell>
  );
}

function BudgetInner() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [rows, setRows] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    getBudget(projectId)
      .then(({ data }) => setRows(data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load budget."))
      .finally(() => setLoading(false));
  }

  useEffect(load, [projectId]);

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const res = await generateBudget(projectId);
      if (res.warning) setWarning(res.warning);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not generate budget — is there an Approved BOQ yet?");
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove(budgetId: string, baselineAmount: string) {
    setApprovingId(budgetId);
    setError(null);
    try {
      await approveBudgetLine(budgetId, Number(baselineAmount));
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not approve budget line.");
    } finally {
      setApprovingId(null);
    }
  }

  const latestVersion = useMemo(() => (rows.length ? Math.max(...rows.map((r) => r.version)) : null), [rows]);
  const versions = useMemo(() => [...new Set(rows.map((r) => r.version))].sort((a, b) => b - a), [rows]);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  useEffect(() => {
    if (latestVersion !== null && selectedVersion === null) setSelectedVersion(latestVersion);
  }, [latestVersion, selectedVersion]);

  const visibleRows = rows.filter((r) => r.version === selectedVersion);
  const totalBaseline = visibleRows.reduce((s, r) => s + Number(r.baselineAmount), 0);
  const totalApproved = visibleRows.reduce((s, r) => s + Number(r.approvedAmount ?? 0), 0);

  return (
    <>
      <div className="pos-page-hdr">
        <div>
          <h1 className="pos-page-title">Budget</h1>
          <p className="pos-page-sub">
            Section 6.3 — generated from the Approved BOQ&apos;s per-line Estimate cost components, not billing value.
          </p>
        </div>
        {canManageBoq() && (
          <button className="pos-btn-primary" onClick={handleGenerate} disabled={busy}>
            {busy ? "Generating…" : "Generate from Approved BOQ"}
          </button>
        )}
      </div>

      {error && <p className="pos-error mb-4">{error}</p>}
      {warning && <p className="pos-warning mb-4">{warning}</p>}

      {loading ? (
        <p className="pos-empty">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="pos-empty">No budget generated yet.</p>
      ) : (
        <>
          <div className="pos-toolbar mb-4">
            {versions.map((v) => (
              <button
                key={v}
                className={v === selectedVersion ? "pos-btn-primary" : "pos-btn-secondary"}
                onClick={() => setSelectedVersion(v)}
              >
                v{v}
              </button>
            ))}
          </div>

          <div className="pos-table-wrap">
            <table className="pos-table">
              <thead>
                <tr>
                  <th>Cost category</th>
                  <th>Baseline amount</th>
                  <th>Approved amount</th>
                  <th>Status</th>
                  {canApproveBoqOrBudget() && <th></th>}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.costCategory?.name ?? r.costCategoryId}</td>
                    <td>₹{Number(r.baselineAmount).toFixed(2)}</td>
                    <td>{r.approvedAmount != null ? `₹${Number(r.approvedAmount).toFixed(2)}` : "—"}</td>
                    <td>
                      <span className={`pos-badge ${r.status === "APPROVED" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>
                        {r.status === "APPROVED" ? "Approved" : "Draft"}
                      </span>
                    </td>
                    {canApproveBoqOrBudget() && (
                      <td>
                        {r.status !== "APPROVED" && (
                          <button
                            className="pos-link-btn"
                            onClick={() => handleApprove(r.id, r.baselineAmount)}
                            disabled={approvingId === r.id}
                          >
                            {approvingId === r.id ? "Approving…" : "Approve"}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="font-semibold">Total</td>
                  <td className="font-semibold">₹{totalBaseline.toFixed(2)}</td>
                  <td className="font-semibold">₹{totalApproved.toFixed(2)}</td>
                  <td></td>
                  {canApproveBoqOrBudget() && <td></td>}
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </>
  );
}
