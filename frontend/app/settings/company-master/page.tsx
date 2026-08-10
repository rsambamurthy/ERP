"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import {
  ApiError,
  createAuditor,
  createDirector,
  deleteAuditor,
  deleteDirector,
  getCompanyMaster,
  updateAuditor,
  updateCompanyMaster,
  updateDirector,
} from "@/lib/api";
import type { Auditor, CompanyMaster, Director } from "@/lib/types";

const COMPANY_TYPES = [
  "PRIVATE_LIMITED", "PUBLIC_LIMITED", "ONE_PERSON_COMPANY", "SECTION_8", "LLP", "PARTNERSHIP", "SOLE_PROPRIETORSHIP",
];
const COMPANY_TYPE_LABELS: Record<string, string> = {
  PRIVATE_LIMITED: "Private Limited Company",
  PUBLIC_LIMITED: "Public Limited Company",
  ONE_PERSON_COMPANY: "One Person Company (OPC)",
  SECTION_8: "Section 8 Company",
  LLP: "Limited Liability Partnership",
  PARTNERSHIP: "Partnership",
  SOLE_PROPRIETORSHIP: "Sole Proprietorship",
};

const emptyDirectorForm = () => ({ name: "", din: "", designation: "", appointmentDate: "" });
const emptyAuditorForm = () => ({ name: "", membershipNumber: "", firmRegistrationNumber: "", appointmentDate: "" });

export default function CompanyMasterPage() {
  const [data, setData] = useState<CompanyMaster | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [orgForm, setOrgForm] = useState({
    cin: "", companyPan: "", companyType: "", incorporationDate: "", registeredOfficeAddress: "",
    poApprovalThreshold: "", priceVarianceTolerancePct: "", soApprovalThreshold: "",
  });
  const [savingOrg, setSavingOrg] = useState(false);

  const [showDirectorForm, setShowDirectorForm] = useState(false);
  const [directorForm, setDirectorForm] = useState(emptyDirectorForm());
  const [savingDirector, setSavingDirector] = useState(false);

  const [showAuditorForm, setShowAuditorForm] = useState(false);
  const [auditorForm, setAuditorForm] = useState(emptyAuditorForm());
  const [savingAuditor, setSavingAuditor] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await getCompanyMaster();
      setData(res.data);
      setOrgForm({
        cin: res.data.cin ?? "",
        companyPan: res.data.companyPan ?? "",
        companyType: res.data.companyType ?? "",
        incorporationDate: res.data.incorporationDate ? res.data.incorporationDate.slice(0, 10) : "",
        registeredOfficeAddress: res.data.registeredOfficeAddress ?? "",
        poApprovalThreshold: res.data.poApprovalThreshold ?? "",
        priceVarianceTolerancePct: res.data.priceVarianceTolerancePct ?? "",
        soApprovalThreshold: res.data.soApprovalThreshold ?? "",
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load company master data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSaveOrg(e: React.FormEvent) {
    e.preventDefault();
    setSavingOrg(true);
    setError(null);
    try {
      await updateCompanyMaster({
        cin: orgForm.cin || null,
        companyPan: orgForm.companyPan || null,
        companyType: orgForm.companyType || null,
        incorporationDate: orgForm.incorporationDate || null,
        registeredOfficeAddress: orgForm.registeredOfficeAddress || null,
        poApprovalThreshold: orgForm.poApprovalThreshold ? Number(orgForm.poApprovalThreshold) : null,
        priceVarianceTolerancePct: orgForm.priceVarianceTolerancePct ? Number(orgForm.priceVarianceTolerancePct) : null,
        soApprovalThreshold: orgForm.soApprovalThreshold ? Number(orgForm.soApprovalThreshold) : null,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save company details.");
    } finally {
      setSavingOrg(false);
    }
  }

  async function handleAddDirector(e: React.FormEvent) {
    e.preventDefault();
    setSavingDirector(true);
    setError(null);
    try {
      await createDirector({
        name: directorForm.name,
        din: directorForm.din || undefined,
        designation: directorForm.designation || undefined,
        appointmentDate: directorForm.appointmentDate || undefined,
      });
      setShowDirectorForm(false);
      setDirectorForm(emptyDirectorForm());
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add director.");
    } finally {
      setSavingDirector(false);
    }
  }

  async function handleToggleDirector(d: Director) {
    try {
      await updateDirector(d.id, { isActive: !d.isActive });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update director.");
    }
  }

  async function handleDeleteDirector(id: string) {
    try {
      await deleteDirector(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove director.");
    }
  }

  async function handleAddAuditor(e: React.FormEvent) {
    e.preventDefault();
    setSavingAuditor(true);
    setError(null);
    try {
      await createAuditor({
        name: auditorForm.name,
        membershipNumber: auditorForm.membershipNumber || undefined,
        firmRegistrationNumber: auditorForm.firmRegistrationNumber || undefined,
        appointmentDate: auditorForm.appointmentDate || undefined,
      });
      setShowAuditorForm(false);
      setAuditorForm(emptyAuditorForm());
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add auditor.");
    } finally {
      setSavingAuditor(false);
    }
  }

  async function handleToggleAuditor(a: Auditor) {
    try {
      await updateAuditor(a.id, { isActive: !a.isActive });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update auditor.");
    }
  }

  async function handleDeleteAuditor(id: string) {
    try {
      await deleteAuditor(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove auditor.");
    }
  }

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Company Master</h1>
        <p>Statutory identity data — for filings like AOC-4, not used by any posting elsewhere in the app.</p>
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {loading && <p style={{ fontSize: 13, color: "var(--color-muted)" }}>Loading…</p>}

      {data && (
        <>
          <form onSubmit={handleSaveOrg} className="ent-section">
            <div className="ent-section-hdr"><span className="ent-section-title">{data.name}</span></div>
            <div className="ent-form-grid">
              <div className="ent-fg">
                <label className="ent-fl">CIN</label>
                <input
                  className="ent-fc" value={orgForm.cin} placeholder="U12345KA2020PTC123456" maxLength={21}
                  onChange={(e) => setOrgForm((f) => ({ ...f, cin: e.target.value.toUpperCase() }))}
                />
              </div>
              <div className="ent-fg">
                <label className="ent-fl">Company PAN</label>
                <input
                  className="ent-fc" value={orgForm.companyPan} placeholder="ABCDE1234F" maxLength={10}
                  onChange={(e) => setOrgForm((f) => ({ ...f, companyPan: e.target.value.toUpperCase() }))}
                />
              </div>
              <div className="ent-fg">
                <label className="ent-fl">Company Type</label>
                <select className="ent-fc" value={orgForm.companyType} onChange={(e) => setOrgForm((f) => ({ ...f, companyType: e.target.value }))}>
                  <option value="">Select…</option>
                  {COMPANY_TYPES.map((t) => <option key={t} value={t}>{COMPANY_TYPE_LABELS[t]}</option>)}
                </select>
              </div>
              <div className="ent-fg">
                <label className="ent-fl">Incorporation Date</label>
                <input
                  type="date" className="ent-fc" value={orgForm.incorporationDate}
                  onChange={(e) => setOrgForm((f) => ({ ...f, incorporationDate: e.target.value }))}
                />
              </div>
              <div className="ent-fg" style={{ gridColumn: "1 / -1" }}>
                <label className="ent-fl">Registered Office Address</label>
                <textarea
                  className="ent-fc" style={{ minHeight: 60 }}
                  value={orgForm.registeredOfficeAddress}
                  onChange={(e) => setOrgForm((f) => ({ ...f, registeredOfficeAddress: e.target.value }))}
                />
              </div>
              <div className="ent-fg">
                <label className="ent-fl">Purchase Order Auto-Approval Threshold (₹)</label>
                <input
                  type="number" min={0} step="0.01" className="ent-fc" placeholder="Leave blank to always require approval"
                  value={orgForm.poApprovalThreshold}
                  onChange={(e) => setOrgForm((f) => ({ ...f, poApprovalThreshold: e.target.value }))}
                />
              </div>
              <div className="ent-fg" style={{ gridColumn: "1 / -1" }}>
                <p style={{ fontSize: 11.5, color: "var(--color-muted)", margin: 0 }}>
                  A submitted Purchase Order below this amount is approved automatically. Blank means every Purchase
                  Order needs manual approval, regardless of amount — the safe default.
                </p>
              </div>
              <div className="ent-fg">
                <label className="ent-fl">3-Way Match Price Tolerance (%)</label>
                <input
                  type="number" min={0} max={100} step="0.01" className="ent-fc" placeholder="Leave blank for 0% — any variance needs approval"
                  value={orgForm.priceVarianceTolerancePct}
                  onChange={(e) => setOrgForm((f) => ({ ...f, priceVarianceTolerancePct: e.target.value }))}
                />
              </div>
              <div className="ent-fg" style={{ gridColumn: "1 / -1" }}>
                <p style={{ fontSize: 11.5, color: "var(--color-muted)", margin: 0 }}>
                  A Purchase Bill raised against a Purchase Order whose rate differs from the order by more than this
                  percentage is held Pending Approval instead of posting immediately. Blank means 0% — any price
                  variance at all needs approval, the safe default.
                </p>
              </div>
              <div className="ent-fg">
                <label className="ent-fl">Sales Order Auto-Approval Threshold (₹)</label>
                <input
                  type="number" min={0} step="0.01" className="ent-fc" placeholder="Leave blank to always require approval"
                  value={orgForm.soApprovalThreshold}
                  onChange={(e) => setOrgForm((f) => ({ ...f, soApprovalThreshold: e.target.value }))}
                />
              </div>
              <div className="ent-fg" style={{ gridColumn: "1 / -1" }}>
                <p style={{ fontSize: 11.5, color: "var(--color-muted)", margin: 0 }}>
                  A submitted Sales Order below this amount is approved automatically. Blank means every Sales Order
                  needs manual approval, regardless of amount — the safe default.
                </p>
              </div>
            </div>
            <div style={{ padding: "0 14px 14px" }}>
              <button type="submit" className="ent-btn-save" disabled={savingOrg}>
                {savingOrg ? "Saving…" : "Save Company Details"}
              </button>
            </div>
          </form>

          <div className="ent-toolbar">
            <span style={{ fontWeight: 600, fontSize: 14 }}>Directors</span>
            <div style={{ flex: 1 }} />
            <button className="ent-btn-add" onClick={() => setShowDirectorForm((s) => !s)}>
              {showDirectorForm ? "Cancel" : "+ Add Director"}
            </button>
          </div>

          {showDirectorForm && (
            <form onSubmit={handleAddDirector} className="ent-section">
              <div className="ent-form-grid">
                <div className="ent-fg">
                  <label className="ent-fl">Name</label>
                  <input className="ent-fc" value={directorForm.name} onChange={(e) => setDirectorForm((f) => ({ ...f, name: e.target.value }))} required />
                </div>
                <div className="ent-fg">
                  <label className="ent-fl">DIN</label>
                  <input className="ent-fc" value={directorForm.din} onChange={(e) => setDirectorForm((f) => ({ ...f, din: e.target.value }))} />
                </div>
                <div className="ent-fg">
                  <label className="ent-fl">Designation</label>
                  <input
                    className="ent-fc" placeholder="Director / Managing Director / Whole-time Director"
                    value={directorForm.designation} onChange={(e) => setDirectorForm((f) => ({ ...f, designation: e.target.value }))}
                  />
                </div>
                <div className="ent-fg">
                  <label className="ent-fl">Appointment Date</label>
                  <input
                    type="date" className="ent-fc" value={directorForm.appointmentDate}
                    onChange={(e) => setDirectorForm((f) => ({ ...f, appointmentDate: e.target.value }))}
                  />
                </div>
              </div>
              <div style={{ padding: "0 14px 14px" }}>
                <button type="submit" className="ent-btn-save" disabled={savingDirector}>
                  {savingDirector ? "Saving…" : "Add Director"}
                </button>
              </div>
            </form>
          )}

          <div className="ent-page-table" style={{ marginBottom: 20 }}>
            <table>
              <thead><tr><th>Name</th><th>DIN</th><th>Designation</th><th>Appointed</th><th>Status</th><th /></tr></thead>
              <tbody>
                {data.directors.length === 0 && <tr><td colSpan={6} className="ent-empty">No directors added yet.</td></tr>}
                {data.directors.map((d) => (
                  <tr key={d.id}>
                    <td style={{ fontWeight: 500 }}>{d.name}</td>
                    <td style={{ color: "var(--color-muted)" }}>{d.din || "—"}</td>
                    <td>{d.designation || "—"}</td>
                    <td>{d.appointmentDate ? new Date(d.appointmentDate).toLocaleDateString() : "—"}</td>
                    <td>
                      <span className={d.isActive ? "badge badge-green" : "badge badge-gray"}>{d.isActive ? "Active" : "Ceased"}</span>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="ent-ia ent-ia-edit" onClick={() => handleToggleDirector(d)}>
                        {d.isActive ? "Mark Ceased" : "Reactivate"}
                      </button>
                      <button className="ent-ia ent-ia-del" onClick={() => handleDeleteDirector(d.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ent-toolbar">
            <span style={{ fontWeight: 600, fontSize: 14 }}>Auditors</span>
            <div style={{ flex: 1 }} />
            <button className="ent-btn-add" onClick={() => setShowAuditorForm((s) => !s)}>
              {showAuditorForm ? "Cancel" : "+ Add Auditor"}
            </button>
          </div>

          {showAuditorForm && (
            <form onSubmit={handleAddAuditor} className="ent-section">
              <div className="ent-form-grid">
                <div className="ent-fg">
                  <label className="ent-fl">Name</label>
                  <input className="ent-fc" value={auditorForm.name} onChange={(e) => setAuditorForm((f) => ({ ...f, name: e.target.value }))} required />
                </div>
                <div className="ent-fg">
                  <label className="ent-fl">Membership Number</label>
                  <input
                    className="ent-fc" value={auditorForm.membershipNumber}
                    onChange={(e) => setAuditorForm((f) => ({ ...f, membershipNumber: e.target.value }))}
                  />
                </div>
                <div className="ent-fg">
                  <label className="ent-fl">Firm Registration Number</label>
                  <input
                    className="ent-fc" value={auditorForm.firmRegistrationNumber}
                    onChange={(e) => setAuditorForm((f) => ({ ...f, firmRegistrationNumber: e.target.value }))}
                  />
                </div>
                <div className="ent-fg">
                  <label className="ent-fl">Appointment Date</label>
                  <input
                    type="date" className="ent-fc" value={auditorForm.appointmentDate}
                    onChange={(e) => setAuditorForm((f) => ({ ...f, appointmentDate: e.target.value }))}
                  />
                </div>
              </div>
              <div style={{ padding: "0 14px 14px" }}>
                <button type="submit" className="ent-btn-save" disabled={savingAuditor}>
                  {savingAuditor ? "Saving…" : "Add Auditor"}
                </button>
              </div>
            </form>
          )}

          <div className="ent-page-table">
            <table>
              <thead><tr><th>Name</th><th>Membership No.</th><th>Firm Reg. No.</th><th>Appointed</th><th>Status</th><th /></tr></thead>
              <tbody>
                {data.auditors.length === 0 && <tr><td colSpan={6} className="ent-empty">No auditors added yet.</td></tr>}
                {data.auditors.map((a) => (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 500 }}>{a.name}</td>
                    <td style={{ color: "var(--color-muted)" }}>{a.membershipNumber || "—"}</td>
                    <td style={{ color: "var(--color-muted)" }}>{a.firmRegistrationNumber || "—"}</td>
                    <td>{a.appointmentDate ? new Date(a.appointmentDate).toLocaleDateString() : "—"}</td>
                    <td>
                      <span className={a.isActive ? "badge badge-green" : "badge badge-gray"}>{a.isActive ? "Active" : "Ceased"}</span>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="ent-ia ent-ia-edit" onClick={() => handleToggleAuditor(a)}>
                        {a.isActive ? "Mark Ceased" : "Reactivate"}
                      </button>
                      <button className="ent-ia ent-ia-del" onClick={() => handleDeleteAuditor(a.id)}>Delete</button>
                    </td>
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
