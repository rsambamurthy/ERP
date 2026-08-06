"use client";

import { useRef, useState } from "react";
import { ApiError, applyBulkUpload, downloadBulkTemplate, previewBulkUpload } from "@/lib/api";
import type { BulkUploadEntity } from "@/lib/api";
import type { BulkUploadRowBase } from "@/lib/types";

interface Column<Row> {
  key: keyof Row;
  label: string;
}

// Returns pre-built JSX for the two toolbar buttons and the (conditionally
// rendered) preview panel, so a page can drop `buttons` inside its existing
// `.ent-toolbar` flex row and `panel` as a normal block-level sibling below
// it — the panel has its own table/section markup and would break that
// row's layout if it were nested inside it directly.
export function useBulkUpload<Row extends BulkUploadRowBase>(
  entity: BulkUploadEntity,
  templateFilename: string,
  columns: Column<Row>[],
  onApplied: () => void
) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Row[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ created: number; updated: number } | null>(null);

  async function handleTemplateDownload() {
    setError("");
    try {
      await downloadBulkTemplate(entity, templateFilename);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Download failed.");
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(null);
    setResult(null);
    setError("");
    setUploading(true);
    try {
      const res = await previewBulkUpload<Row>(entity, file);
      setPreview(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to parse the file.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleApply() {
    if (!preview) return;
    const toApply = preview.filter((r) => r.status === "create" || r.status === "update");
    setApplying(true);
    setError("");
    try {
      const res = await applyBulkUpload<Row>(entity, toApply);
      setResult(res.data);
      setPreview(null);
      onApplied();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to apply the upload.");
    } finally {
      setApplying(false);
    }
  }

  const statusBg = { create: "#f0fdf4", update: "#eff6ff", error: "#fef2f2" } as const;
  const statusColor = { create: "#15803d", update: "#1d4ed8", error: "#dc2626" } as const;
  const createCount = preview?.filter((r) => r.status === "create").length ?? 0;
  const updateCount = preview?.filter((r) => r.status === "update").length ?? 0;
  const errorCount = preview?.filter((r) => r.status === "error").length ?? 0;

  const outlineBtn = { background: "#fff", color: "var(--color-navy, #1e3a5f)", border: "1px solid var(--color-border, #e2e8f0)" };
  const activeBtn = { background: "#dbeafe", color: "#1d4ed8", border: "1px solid #93c5fd" };

  const buttons = (
    <>
      <button type="button" className="ent-btn-add" style={outlineBtn} onClick={handleTemplateDownload}>
        ⬇ Download Template
      </button>
      <button type="button" className="ent-btn-add" style={open ? activeBtn : outlineBtn} onClick={() => setOpen((o) => !o)}>
        ⬆ Bulk Upload
      </button>
    </>
  );

  const panel = !open ? null : (
    <div className="ent-section" style={{ marginBottom: 20 }}>
      <div className="ent-section-hdr">
        <span className="ent-section-title">Bulk upload</span>
        <div style={{ marginLeft: "auto" }}>
          <input ref={fileRef} type="file" accept=".xlsx" style={{ display: "none" }} onChange={handleFile} />
          <button type="button" className="ent-btn-save" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? "Reading…" : "Choose file…"}
          </button>
        </div>
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 10px" }}>{error}</p>}
      {result && (
        <p style={{ fontSize: 13, padding: "0 14px 10px", color: "#15803d" }}>
          Done — {result.created} created, {result.updated} updated.
        </p>
      )}

      {preview && preview.length > 0 && (
        <>
          <div style={{ padding: "0 14px 10px", fontSize: 12.5, color: "var(--color-muted)" }}>
            {createCount} to create · {updateCount} to update
            {errorCount > 0 && (
              <>
                {" · "}
                <strong style={{ color: "#dc2626" }}>
                  {errorCount} error{errorCount !== 1 ? "s" : ""}
                </strong>{" "}
                (fix and re-upload)
              </>
            )}
          </div>
          <div className="ent-page-table" style={{ margin: "0 14px 14px", maxHeight: 340, overflow: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  {columns.map((c) => (
                    <th key={String(c.key)}>{c.label}</th>
                  ))}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.rowNum} style={{ background: statusBg[r.status] }}>
                    <td>{r.rowNum}</td>
                    {columns.map((c) => (
                      <td key={String(c.key)}>{String((r[c.key] as unknown) ?? "")}</td>
                    ))}
                    <td style={{ color: statusColor[r.status], fontWeight: 600, fontSize: 12 }}>
                      {r.status === "error" ? r.error : r.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 8, padding: "0 14px 14px" }}>
            <button type="button" className="ent-btn-save" onClick={handleApply} disabled={applying || createCount + updateCount === 0}>
              {applying ? "Applying…" : `Apply (${createCount + updateCount} records)`}
            </button>
            <button
              type="button"
              className="ent-ia ent-ia-del"
              onClick={() => {
                setPreview(null);
                setOpen(false);
              }}
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {preview && preview.length === 0 && (
        <p style={{ padding: "0 14px 14px", fontSize: 12.5, color: "var(--color-muted)", fontStyle: "italic" }}>
          No data rows found in the uploaded file.
        </p>
      )}
    </div>
  );

  return { buttons, panel };
}
