"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { ApiError, downloadGstr1, getGstr1 } from "@/lib/api";
import type { Gstr1Report } from "@/lib/types";

function firstOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export default function Gstr1Page() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<Gstr1Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getGstr1({ from, to })
      .then((res) => setData(res.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load GSTR-1."))
      .finally(() => setLoading(false));
  }, [from, to]);

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadGstr1({ from, to });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not download GSTR-1.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>GSTR-1</h1>
        <p>Outward supplies for a period — B2B, B2C, Exports (Table 6A), HSN summary, and credit notes.</p>
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

      <p style={{ fontSize: 11.5, color: "var(--color-muted)", marginBottom: 14 }}>
        Place of supply is the customer's own state (bill-to) — this app doesn't track a separate ship-to state. B2C is
        one summarized table by state + rate rather than the &gt;₹2.5L invoice-wise split. Exports (foreign-currency
        Sales Invoices) always go to Table 6A below, never B2B/B2C, regardless of whether the customer has a GSTIN on
        file. No cess, exempt/nil-rated, or reverse-charge handling. Treat this as a working draft for filing, not a
        final return.
      </p>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {loading && <p style={{ fontSize: 13, color: "var(--color-muted)" }}>Loading…</p>}

      {data && (
        <>
          <div className="grid-4" style={{ marginBottom: 20 }}>
            <div className="stat-card">
              <div className="value">₹{data.totals.taxableValue.toFixed(2)}</div>
              <div className="label">Taxable Value</div>
            </div>
            <div className="stat-card">
              <div className="value" style={{ color: "#2563eb" }}>₹{(data.totals.cgst + data.totals.sgst).toFixed(2)}</div>
              <div className="label">CGST + SGST</div>
            </div>
            <div className="stat-card">
              <div className="value" style={{ color: "#16a34a" }}>₹{data.totals.igst.toFixed(2)}</div>
              <div className="label">IGST</div>
            </div>
            <div className="stat-card">
              <div className="value">₹{data.totals.invoiceValue.toFixed(2)}</div>
              <div className="label">Total Invoice Value</div>
            </div>
          </div>

          <div className="ent-section">
            <div className="ent-section-hdr"><span className="ent-section-title">B2B Invoices ({data.b2b.length})</span></div>
            <table className="ent-table">
              <thead>
                <tr>
                  <th>GSTIN</th><th>Receiver</th><th>Invoice #</th><th>Date</th><th>Place of Supply</th>
                  <th>Rate</th><th>Taxable Value</th><th>CGST</th><th>SGST</th><th>IGST</th>
                </tr>
              </thead>
              <tbody>
                {data.b2b.length === 0 && <tr><td colSpan={10} className="ent-empty">No B2B invoices this period.</td></tr>}
                {data.b2b.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: "monospace" }}>{r.gstin}</td>
                    <td>{r.receiverName}</td>
                    <td>{r.invoiceNumber}</td>
                    <td>{new Date(r.invoiceDate).toLocaleDateString()}</td>
                    <td>{r.placeOfSupply}</td>
                    <td>{r.rate}%</td>
                    <td>{r.taxableValue.toFixed(2)}</td>
                    <td style={{ color: "#2563eb" }}>{r.cgst.toFixed(2)}</td>
                    <td style={{ color: "#2563eb" }}>{r.sgst.toFixed(2)}</td>
                    <td style={{ color: "#16a34a" }}>{r.igst.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ent-section">
            <div className="ent-section-hdr"><span className="ent-section-title">B2C Summary ({data.b2c.length})</span></div>
            <table className="ent-table">
              <thead>
                <tr><th>Place of Supply</th><th>Rate</th><th>Taxable Value</th><th>CGST</th><th>SGST</th><th>IGST</th></tr>
              </thead>
              <tbody>
                {data.b2c.length === 0 && <tr><td colSpan={6} className="ent-empty">No B2C supplies this period.</td></tr>}
                {data.b2c.map((r, i) => (
                  <tr key={i}>
                    <td>{r.placeOfSupply}</td>
                    <td>{r.rate}%</td>
                    <td>{r.taxableValue.toFixed(2)}</td>
                    <td style={{ color: "#2563eb" }}>{r.cgst.toFixed(2)}</td>
                    <td style={{ color: "#2563eb" }}>{r.sgst.toFixed(2)}</td>
                    <td style={{ color: "#16a34a" }}>{r.igst.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ent-section">
            <div className="ent-section-hdr"><span className="ent-section-title">Exports — Table 6A ({data.exports.length})</span></div>
            <div className="grid-3" style={{ padding: "12px 14px 0" }}>
              <div className="stat-card">
                <div className="value">₹{data.exportsTotal.taxableValue.toFixed(2)}</div>
                <div className="label">Export Taxable Value</div>
              </div>
              <div className="stat-card">
                <div className="value" style={{ color: "#16a34a" }}>₹{data.exportsTotal.igst.toFixed(2)}</div>
                <div className="label">Export IGST</div>
              </div>
              <div className="stat-card">
                <div className="value">₹{data.exportsTotal.invoiceValue.toFixed(2)}</div>
                <div className="label">Export Invoice Value</div>
              </div>
            </div>
            <table className="ent-table">
              <thead>
                <tr>
                  <th>Invoice #</th><th>Date</th><th>Invoice Value</th><th>Shipping Bill #</th><th>Shipping Bill Date</th>
                  <th>Port</th><th>Rate</th><th>Taxable Value</th><th>IGST</th><th>Export Type</th>
                </tr>
              </thead>
              <tbody>
                {data.exports.length === 0 && <tr><td colSpan={10} className="ent-empty">No export invoices this period.</td></tr>}
                {data.exports.map((r, i) => (
                  <tr key={i}>
                    <td>{r.invoiceNumber}</td>
                    <td>{new Date(r.invoiceDate).toLocaleDateString()}</td>
                    <td>{r.invoiceValue.toFixed(2)}</td>
                    <td>{r.shippingBillNumber ?? <span style={{ color: "#a16207" }}>not added yet</span>}</td>
                    <td>{r.shippingBillDate ? new Date(r.shippingBillDate).toLocaleDateString() : "—"}</td>
                    <td>{r.portCode ?? "—"}</td>
                    <td>{r.rate}%</td>
                    <td>{r.taxableValue.toFixed(2)}</td>
                    <td style={{ color: "#16a34a" }}>{r.igst.toFixed(2)}</td>
                    <td>{r.exportType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ent-section">
            <div className="ent-section-hdr"><span className="ent-section-title">HSN Summary ({data.hsn.length})</span></div>
            <table className="ent-table">
              <thead>
                <tr><th>HSN</th><th>Description</th><th>UOM</th><th>Rate</th><th>Qty</th><th>Taxable Value</th><th>CGST</th><th>SGST</th><th>IGST</th></tr>
              </thead>
              <tbody>
                {data.hsn.length === 0 && <tr><td colSpan={9} className="ent-empty">No lines this period.</td></tr>}
                {data.hsn.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: "monospace" }}>{r.hsnCode}</td>
                    <td>{r.description}</td>
                    <td>{r.uom}</td>
                    <td>{r.rate}%</td>
                    <td>{r.quantity}</td>
                    <td>{r.taxableValue.toFixed(2)}</td>
                    <td style={{ color: "#2563eb" }}>{r.cgst.toFixed(2)}</td>
                    <td style={{ color: "#2563eb" }}>{r.sgst.toFixed(2)}</td>
                    <td style={{ color: "#16a34a" }}>{r.igst.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ent-section">
            <div className="ent-section-hdr"><span className="ent-section-title">Credit Notes ({data.creditNotes.length})</span></div>
            <table className="ent-table">
              <thead>
                <tr>
                  <th>Note #</th><th>Date</th><th>Original Invoice</th><th>GSTIN</th><th>Receiver</th>
                  <th>Rate</th><th>Taxable Value</th><th>CGST</th><th>SGST</th><th>IGST</th>
                </tr>
              </thead>
              <tbody>
                {data.creditNotes.length === 0 && <tr><td colSpan={10} className="ent-empty">No credit notes this period.</td></tr>}
                {data.creditNotes.map((r, i) => (
                  <tr key={i}>
                    <td>{r.noteNumber}</td>
                    <td>{new Date(r.noteDate).toLocaleDateString()}</td>
                    <td>{r.originalInvoiceNumber}</td>
                    <td style={{ fontFamily: "monospace" }}>{r.gstin ?? "—"}</td>
                    <td>{r.receiverName}</td>
                    <td>{r.rate}%</td>
                    <td>{r.taxableValue.toFixed(2)}</td>
                    <td style={{ color: "#2563eb" }}>{r.cgst.toFixed(2)}</td>
                    <td style={{ color: "#2563eb" }}>{r.sgst.toFixed(2)}</td>
                    <td style={{ color: "#16a34a" }}>{r.igst.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AppShell>
  );
}
