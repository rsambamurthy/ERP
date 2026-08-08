"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { ApiError, downloadGstr3b, getGstr3b } from "@/lib/api";
import type { Gstr3bReport } from "@/lib/types";

function firstOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function SectionRow({ label, cgst, sgst, igst, total }: { label: string; cgst: number; sgst: number; igst: number; total: number }) {
  return (
    <tr>
      <td>{label}</td>
      <td style={{ color: "#2563eb" }}>{cgst.toFixed(2)}</td>
      <td style={{ color: "#2563eb" }}>{sgst.toFixed(2)}</td>
      <td style={{ color: "#16a34a" }}>{igst.toFixed(2)}</td>
      <td style={{ fontWeight: 700 }}>{total.toFixed(2)}</td>
    </tr>
  );
}

export default function Gstr3bPage() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<Gstr3bReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getGstr3b({ from, to })
      .then((res) => setData(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load GSTR-3B."))
      .finally(() => setLoading(false));
  }, [from, to]);

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadGstr3b({ from, to });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not download GSTR-3B.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>GSTR-3B</h1>
        <p>Summary return — outward tax liability vs. input tax credit, for one filing period.</p>
      </div>

      <div className="ent-toolbar">
        <input type="date" className="ent-fc" style={{ width: 150, height: 34 }} value={from} onChange={(e) => setFrom(e.target.value)} />
        <span style={{ color: "var(--color-muted)", fontSize: 13 }}>to</span>
        <input type="date" className="ent-fc" style={{ width: 150, height: 34 }} value={to} onChange={(e) => setTo(e.target.value)} />
        <div style={{ flex: 1 }} />
        <button className="ent-btn-add" onClick={handleDownload} disabled={downloading || !data}>
          {downloading ? "Downloading…" : "Download Excel"}
        </button>
      </div>

      <p style={{ fontSize: 11.5, color: "#a16207", marginBottom: 14 }}>
        ⚠ Net Tax Payable here is liability minus ITC per tax head, clamped at zero — it does not model the government's
        actual cross-utilization set-off order (IGST credit first against IGST, then CGST, then SGST) or any carry-forward
        of unused credit. No cess or reverse-charge handling either. Treat this as an indicative figure to review with
        whoever files your return, not a filing-ready number.
      </p>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {loading && <p style={{ fontSize: 13, color: "var(--color-muted)" }}>Loading…</p>}

      {data && (
        <>
          <div className="ent-section">
            <div className="ent-section-hdr"><span className="ent-section-title">Summary</span></div>
            <table className="ent-table">
              <thead>
                <tr><th>Section</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total</th></tr>
              </thead>
              <tbody>
                <SectionRow
                  label="3.1(a) Outward Taxable Supplies (net of credit notes)"
                  cgst={data.outward.cgst}
                  sgst={data.outward.sgst}
                  igst={data.outward.igst}
                  total={data.outward.total}
                />
                <SectionRow
                  label="4(A) ITC Available (net of debit notes)"
                  cgst={data.itc.cgst}
                  sgst={data.itc.sgst}
                  igst={data.itc.igst}
                  total={data.itc.total}
                />
                <tr style={{ background: "#f8fafd" }}>
                  <td style={{ fontWeight: 700 }}>Net Tax Payable</td>
                  <td style={{ fontWeight: 700, color: "#2563eb" }}>{data.netPayable.cgst.toFixed(2)}</td>
                  <td style={{ fontWeight: 700, color: "#2563eb" }}>{data.netPayable.sgst.toFixed(2)}</td>
                  <td style={{ fontWeight: 700, color: "#16a34a" }}>{data.netPayable.igst.toFixed(2)}</td>
                  <td style={{ fontWeight: 700 }}>{data.netPayable.total.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="grid-3">
            <div className="stat-card">
              <div className="value">₹{data.outward.total.toFixed(2)}</div>
              <div className="label">Outward Tax Liability</div>
            </div>
            <div className="stat-card">
              <div className="value">₹{data.itc.total.toFixed(2)}</div>
              <div className="label">ITC Available</div>
            </div>
            <div className="stat-card">
              <div className="value" style={{ color: data.netPayable.total > 0 ? "#dc2626" : "#16a34a" }}>
                ₹{data.netPayable.total.toFixed(2)}
              </div>
              <div className="label">Net Payable</div>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
