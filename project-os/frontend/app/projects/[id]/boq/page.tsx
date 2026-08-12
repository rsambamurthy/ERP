"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import AppShell from "../../../../components/layout/AppShell";
import { canApproveBoqOrBudget, canManageBoq } from "../../../../lib/auth";
import {
  addBoqLine,
  applyBoqImport,
  approveBoq,
  createBoqVersion,
  downloadBoqImportTemplate,
  getBoq,
  getBoqVersions,
  getCostCategories,
  getSyncedItems,
  previewBoqImport,
  setLineEstimate,
  ApiError,
} from "../../../../lib/api";
import { BOQ_STATUS_LABELS, Boq, BoqImportPreviewRow, BoqLine, CostCategory, SyncedItem } from "../../../../lib/types";
import { COMMON_UOMS } from "../../../../lib/uom";

export default function BoqPage() {
  return (
    <AppShell>
      <BoqInner />
    </AppShell>
  );
}

function BoqInner() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [versions, setVersions] = useState<Boq[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [boq, setBoq] = useState<Boq | null>(null);
  const [costCategories, setCostCategories] = useState<CostCategory[]>([]);
  const [syncedItems, setSyncedItems] = useState<SyncedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function loadVersions(selectAfter?: string) {
    setLoading(true);
    getBoqVersions(projectId)
      .then(({ data }) => {
        setVersions(data);
        const pick = selectAfter ?? (data[0]?.id ?? null); // orderBy version desc — [0] is latest
        setSelectedId(pick);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load BOQ versions."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadVersions();
    getCostCategories().then(({ data }) => setCostCategories(data)).catch(() => {});
    getSyncedItems().then(({ data }) => setSyncedItems(data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function loadBoqDetail() {
    if (!selectedId) return;
    getBoq(selectedId)
      .then(({ data }) => setBoq(data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load BOQ."));
  }

  useEffect(loadBoqDetail, [selectedId]);

  async function handleNewVersion() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await createBoqVersion(projectId);
      loadVersions(data.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start a new BOQ version.");
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    if (!boq) return;
    if (!confirm(`Approve BOQ v${boq.version}? This supersedes whichever version is currently approved.`)) return;
    setBusy(true);
    setError(null);
    try {
      await approveBoq(boq.id);
      loadVersions(boq.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not approve BOQ.");
    } finally {
      setBusy(false);
    }
  }

  const canEdit = boq ? boq.status === "DRAFT" || boq.status === "IMPORTED" : false;
  const canApprove = boq ? boq.status === "IMPORTED" || boq.status === "VALIDATED" : false;
  const lineCount = boq?.lines?.length ?? 0;

  return (
    <>
      <div className="pos-page-hdr">
        <div>
          <h1 className="pos-page-title">BOQ &amp; Estimation</h1>
          <p className="pos-page-sub">Section 6.3 — versioned, append-only. Only one Approved version at a time.</p>
        </div>
        {canManageBoq() && (
          <button className="pos-btn-secondary" onClick={handleNewVersion} disabled={busy}>
            + Start new version
          </button>
        )}
      </div>

      {error && <p className="pos-error mb-4">{error}</p>}

      {loading ? (
        <p className="pos-empty">Loading…</p>
      ) : versions.length === 0 ? (
        <p className="pos-empty">No BOQ yet — start a version to begin.</p>
      ) : (
        <>
          <div className="pos-toolbar mb-4">
            {versions.map((v) => (
              <button
                key={v.id}
                className={v.id === selectedId ? "pos-btn-primary" : "pos-btn-secondary"}
                onClick={() => setSelectedId(v.id)}
              >
                v{v.version} · {BOQ_STATUS_LABELS[v.status as keyof typeof BOQ_STATUS_LABELS] ?? v.status}
              </button>
            ))}
          </div>

          {boq && (
            <>
              {canManageBoq() && canEdit && (
                <ImportSection boqId={boq.id} onImported={loadBoqDetail} />
              )}

              {canManageBoq() && canEdit && (
                <AddLineForm
                  boqId={boq.id}
                  costCategories={costCategories}
                  syncedItems={syncedItems}
                  existingLineNos={boq.lines?.map((l) => l.lineNo) ?? []}
                  onAdded={loadBoqDetail}
                />
              )}

              <div className="pos-section">
                <div className="pos-page-hdr" style={{ marginBottom: 12 }}>
                  <div className="pos-section-title" style={{ marginBottom: 0 }}>
                    Lines ({lineCount})
                  </div>
                  {canApproveBoqOrBudget() && canApprove && lineCount > 0 && (
                    <button className="pos-btn-primary" onClick={handleApprove} disabled={busy}>
                      Approve v{boq.version}
                    </button>
                  )}
                </div>
                <LinesTable lines={boq.lines ?? []} canEditEstimate={canManageBoq()} onEstimateSaved={loadBoqDetail} />
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

function ImportSection({ boqId, onImported }: { boqId: string; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BoqImportPreviewRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownloadTemplate() {
    setDownloading(true);
    setError(null);
    try {
      await downloadBoqImportTemplate(boqId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not download the template.");
    } finally {
      setDownloading(false);
    }
  }

  async function handlePreview() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const rows = await previewBoqImport(boqId, file);
      setPreview(rows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not preview file.");
    } finally {
      setBusy(false);
    }
  }

  async function handleApply() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await applyBoqImport(boqId, preview);
      setPreview(null);
      setFile(null);
      onImported();
      alert(`Imported ${data.created} line(s).`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not apply import.");
    } finally {
      setBusy(false);
    }
  }

  const createCount = preview?.filter((r) => r.status === "create").length ?? 0;
  const errorCount = preview ? preview.length - createCount : 0;

  return (
    <div className="pos-section">
      <div className="pos-section-title">Import from Excel</div>
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <button className="pos-link-btn" onClick={handleDownloadTemplate} disabled={downloading}>
          {downloading ? "Downloading…" : "Download template"}
        </button>
        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setPreview(null);
          }}
          className="text-sm"
        />
        <button className="pos-btn-secondary" onClick={handlePreview} disabled={!file || busy}>
          {busy && !preview ? "Reading…" : "Preview"}
        </button>
      </div>

      {error && <p className="pos-error mb-3">{error}</p>}

      {preview && (
        <>
          <p className="text-sm text-slate-600 mb-2">
            {createCount} row(s) ready to import, {errorCount} row(s) with errors (skipped).
          </p>
          <div className="pos-table-wrap mb-3" style={{ maxHeight: 300, overflowY: "auto" }}>
            <table className="pos-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Line No</th>
                  <th>Description</th>
                  <th>Item</th>
                  <th>Category</th>
                  <th>Qty</th>
                  <th>Rate</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.rowNum}>
                    <td>{r.rowNum}</td>
                    <td>{r.lineNo ?? "—"}</td>
                    <td>{r.description || "—"}</td>
                    <td>{r.itemSku ? (r.itemMatched ? r.itemSku : `${r.itemSku} (unmatched)`) : "—"}</td>
                    <td>{r.costCategoryName || "—"}</td>
                    <td>{r.quantity ?? "—"}</td>
                    <td>{r.rate ?? "—"}</td>
                    <td>
                      {r.status === "create" ? (
                        <span className="pos-badge bg-green-100 text-green-700">Ready</span>
                      ) : (
                        <span className="pos-badge bg-red-100 text-red-700" title={r.error}>
                          Error
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="pos-btn-primary" onClick={handleApply} disabled={busy || createCount === 0}>
            {busy ? "Importing…" : `Import ${createCount} line(s)`}
          </button>
        </>
      )}
    </div>
  );
}

function AddLineForm({
  boqId,
  costCategories,
  syncedItems,
  existingLineNos,
  onAdded,
}: {
  boqId: string;
  costCategories: CostCategory[];
  syncedItems: SyncedItem[];
  existingLineNos: number[];
  onAdded: () => void;
}) {
  const nextLineNo = useMemo(() => (existingLineNos.length ? Math.max(...existingLineNos) + 1 : 1), [existingLineNos]);
  const [lineNo, setLineNo] = useState(nextLineNo);
  const [description, setDescription] = useState("");
  const [itemId, setItemId] = useState("");
  const [costCategoryId, setCostCategoryId] = useState("");
  const [uom, setUom] = useState("");
  const [quantity, setQuantity] = useState("");
  const [rate, setRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => setLineNo(nextLineNo), [nextLineNo]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await addBoqLine(boqId, {
        lineNo,
        description,
        itemId: itemId || null,
        costCategoryId: costCategoryId || null,
        uom,
        quantity: Number(quantity),
        rate: Number(rate),
      });
      setDescription("");
      setItemId("");
      setCostCategoryId("");
      setUom("");
      setQuantity("");
      setRate("");
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add line.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pos-section">
      <div className="pos-section-title">Add a line manually</div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="pos-form-grid">
          <div className="pos-field">
            <label className="pos-label">Line No *</label>
            <input type="number" required className="pos-input" value={lineNo} onChange={(e) => setLineNo(Number(e.target.value))} />
          </div>
          <div className="pos-field">
            <label className="pos-label">Description *</label>
            <input className="pos-input" required value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="pos-field">
            <label className="pos-label">Item (optional)</label>
            <select className="pos-select" value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">— none —</option>
              {syncedItems.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.sku} — {i.name}
                </option>
              ))}
            </select>
          </div>
          <div className="pos-field">
            <label className="pos-label">Cost category *</label>
            <select className="pos-select" required value={costCategoryId} onChange={(e) => setCostCategoryId(e.target.value)}>
              <option value="">— select —</option>
              {costCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="pos-field">
            <label className="pos-label">UOM *</label>
            <select className="pos-select" required value={uom} onChange={(e) => setUom(e.target.value)}>
              <option value="">— select —</option>
              {COMMON_UOMS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          <div className="pos-field">
            <label className="pos-label">Quantity *</label>
            <input type="number" step="0.0001" min="0.0001" required className="pos-input" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div className="pos-field">
            <label className="pos-label">Rate *</label>
            <input type="number" step="0.01" min="0" required className="pos-input" value={rate} onChange={(e) => setRate(e.target.value)} />
          </div>
        </div>
        {error && <p className="pos-error">{error}</p>}
        <div>
          <button type="submit" className="pos-btn-primary" disabled={saving}>
            {saving ? "Adding…" : "Add line"}
          </button>
        </div>
      </form>
    </div>
  );
}

function LinesTable({
  lines,
  canEditEstimate,
  onEstimateSaved,
}: {
  lines: BoqLine[];
  canEditEstimate: boolean;
  onEstimateSaved: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (lines.length === 0) return <p className="pos-empty">No lines yet.</p>;

  return (
    <div className="pos-table-wrap">
      <table className="pos-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Description</th>
            <th>Item</th>
            <th>Category</th>
            <th>UOM</th>
            <th>Qty</th>
            <th>Rate</th>
            <th>Amount</th>
            <th>Estimate cost</th>
            {canEditEstimate && <th></th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <Fragment key={l.id}>
              <tr>
                <td>{l.lineNo}</td>
                <td>{l.description}</td>
                <td>{l.item ? `${l.item.sku}` : "—"}</td>
                <td>{l.costCategory?.name ?? "—"}</td>
                <td>{l.uom}</td>
                <td>{Number(l.quantity)}</td>
                <td>{Number(l.rate).toFixed(2)}</td>
                <td>{Number(l.amount).toFixed(2)}</td>
                <td>{l.estimate ? Number(l.estimate.totalCost).toFixed(2) : <span className="text-amber-600">not set</span>}</td>
                {canEditEstimate && (
                  <td>
                    <button className="pos-link-btn" onClick={() => setExpandedId(expandedId === l.id ? null : l.id)}>
                      {expandedId === l.id ? "Close" : "Estimate"}
                    </button>
                  </td>
                )}
              </tr>
              {expandedId === l.id && (
                <tr>
                  <td colSpan={canEditEstimate ? 10 : 9} className="bg-slate-50">
                    <EstimateForm
                      line={l}
                      onSaved={() => {
                        setExpandedId(null);
                        onEstimateSaved();
                      }}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EstimateForm({ line, onSaved }: { line: BoqLine; onSaved: () => void }) {
  const [materialCost, setMaterialCost] = useState(line.estimate?.materialCost ?? "0");
  const [labourCost, setLabourCost] = useState(line.estimate?.labourCost ?? "0");
  const [subcontractCost, setSubcontractCost] = useState(line.estimate?.subcontractCost ?? "0");
  const [overheadCost, setOverheadCost] = useState(line.estimate?.overheadCost ?? "0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = [materialCost, labourCost, subcontractCost, overheadCost].reduce((s, v) => s + (Number(v) || 0), 0);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await setLineEstimate(line.id, {
        materialCost: Number(materialCost) || 0,
        labourCost: Number(labourCost) || 0,
        subcontractCost: Number(subcontractCost) || 0,
        overheadCost: Number(overheadCost) || 0,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save estimate.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="py-3">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
        <div className="pos-field">
          <label className="pos-label">Material</label>
          <input type="number" step="0.01" className="pos-input" value={materialCost} onChange={(e) => setMaterialCost(e.target.value)} />
        </div>
        <div className="pos-field">
          <label className="pos-label">Labour</label>
          <input type="number" step="0.01" className="pos-input" value={labourCost} onChange={(e) => setLabourCost(e.target.value)} />
        </div>
        <div className="pos-field">
          <label className="pos-label">Subcontract</label>
          <input type="number" step="0.01" className="pos-input" value={subcontractCost} onChange={(e) => setSubcontractCost(e.target.value)} />
        </div>
        <div className="pos-field">
          <label className="pos-label">Overhead</label>
          <input type="number" step="0.01" className="pos-input" value={overheadCost} onChange={(e) => setOverheadCost(e.target.value)} />
        </div>
        <div>
          <div className="pos-label mb-1">Total: {total.toFixed(2)}</div>
          <button className="pos-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {error && <p className="pos-error mt-2">{error}</p>}
    </div>
  );
}
