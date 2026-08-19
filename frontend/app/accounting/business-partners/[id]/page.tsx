"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import {
  ApiError, getBusinessPartner, updateBusinessPartner, toggleBusinessPartner, deleteBusinessPartner,
  submitBusinessPartnerForApproval, approveBusinessPartner, rejectBusinessPartner,
  createVendorContact, updateVendorContact, deleteVendorContact,
  createVendorAddress, updateVendorAddress, deleteVendorAddress,
  createVendorBankAccount, updateVendorBankAccount, deleteVendorBankAccount,
} from "@/lib/api";
import { canManageBusinessPartners } from "@/lib/auth";
import { GST_STATE_CODES } from "@/lib/gstStates";
import { VENDOR_CATEGORIES, TAX_ID_TYPE_SUGGESTIONS, COMMON_COUNTRIES } from "@/lib/types";
import type { BusinessPartner, VendorContact, VendorAddress, VendorBankAccount } from "@/lib/types";

// Business Partner detail — customers and vendors both. Basic Details,
// Contacts/Addresses/Bank Accounts child lists, and (vendors only) the
// minimal single-step approval workflow that stands in for a future generic
// Workflow Management System — see migration_028's comment.
//
// The child lists are still named vendor* in the schema and API because
// that is where migration_028 introduced them; they were never
// vendor-specific in behaviour.
export default function BusinessPartnerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const canManage = canManageBusinessPartners();

  const [bp, setBp] = useState<BusinessPartner | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [editingBasics, setEditingBasics] = useState(false);
  const [basics, setBasics] = useState({
    name: "", gstin: "", stateCode: "", phone: "", email: "",
    vendorCategory: "", taxIdType: "", taxId: "",
  });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await getBusinessPartner(id);
      setBp(res.data);
      setBasics({
        name: res.data.name, gstin: res.data.gstin ?? "", stateCode: res.data.stateCode ?? "",
        phone: res.data.phone ?? "", email: res.data.email ?? "",
        vendorCategory: res.data.vendorCategory ?? "", taxIdType: res.data.taxIdType ?? "", taxId: res.data.taxId ?? "",
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this business partner.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [id]);

  async function handleSaveBasics() {
    if (!bp) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await updateBusinessPartner(bp.id, {
        name: basics.name, gstin: basics.gstin || null, stateCode: basics.stateCode || null,
        phone: basics.phone || null, email: basics.email || null,
        ...(bp.bpType === "VENDOR" ? {
          vendorCategory: basics.vendorCategory || null,
          taxIdType: basics.taxIdType || null,
          taxId: basics.taxId || null,
        } : {}),
      });
      setEditingBasics(false);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not save changes.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleToggleActive() {
    if (!bp) return;
    await toggleBusinessPartner(bp.id);
    await load();
  }

  async function handleDelete() {
    if (!bp) return;
    setActionBusy(true);
    setDeleteError(null);
    try {
      await deleteBusinessPartner(bp.id);
      router.push("/accounting/business-partners");
    } catch (err) {
      // 409 once the partner has any journal line — which includes every
      // invoice, bill, receipt and payment. Say what to do instead rather
      // than leaving the bare server message.
      setDeleteError(
        err instanceof ApiError
          ? `${err.message} Deactivate instead to take it out of new documents.`
          : "Could not delete this business partner."
      );
      setConfirmingDelete(false);
    } finally {
      setActionBusy(false);
    }
  }

  async function handleSubmitForApproval() {
    if (!bp) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await submitBusinessPartnerForApproval(bp.id);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not submit for approval.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleApprove() {
    if (!bp) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await approveBusinessPartner(bp.id);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not approve.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleReject() {
    if (!bp || !rejectReason.trim()) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await rejectBusinessPartner(bp.id, rejectReason.trim());
      setShowRejectBox(false);
      setRejectReason("");
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not reject.");
    } finally {
      setActionBusy(false);
    }
  }

  if (loading) return <AppShell><p className="ent-empty">Loading…</p></AppShell>;
  if (!bp) return <AppShell><p style={{ color: "#dc2626", fontSize: 13 }}>{error ?? "Not found."}</p></AppShell>;

  const isVendor = bp.bpType === "VENDOR";

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>{bp.name}</h1>
        <p>
          {bp.bpType === "CUSTOMER" ? "Customer" : "Vendor"}
          {" · "}
          <button className="ent-ia ent-ia-edit" style={{ padding: 0 }} onClick={() => router.push("/accounting/business-partners")}>
            Back to list
          </button>
        </p>
      </div>

      {isVendor && (
        <div className="ent-section" style={{ marginBottom: 16, padding: 14 }}>
          <div className="ent-section-hdr"><span className="ent-section-title">Approval Status</span></div>
          <span className={
            bp.approvalStatus === "APPROVED" ? "badge badge-green"
              : bp.approvalStatus === "REJECTED" ? "badge badge-red" : "badge badge-yellow"
          } style={{ marginRight: 12 }}>
            {bp.approvalStatus === "PENDING_APPROVAL" ? "Pending Approval" : bp.approvalStatus === "APPROVED" ? "Approved" : "Rejected"}
          </span>

          {bp.approvalStatus === "REJECTED" && bp.rejectionReason && (
            <span style={{ fontSize: 13, color: "var(--color-muted)" }}>Reason: {bp.rejectionReason}</span>
          )}

          {canManage && bp.approvalStatus !== "PENDING_APPROVAL" && (
            <button className="ent-ia ent-ia-edit" disabled={actionBusy} onClick={handleSubmitForApproval} style={{ marginLeft: 8 }}>
              {bp.approvalStatus === "APPROVED" ? "Re-submit for Approval" : "Submit for Approval"}
            </button>
          )}

          {canManage && bp.approvalStatus === "PENDING_APPROVAL" && (
            <span style={{ marginLeft: 8 }}>
              <button className="ent-ia ent-ia-edit" disabled={actionBusy} onClick={handleApprove}>Approve</button>
              <button className="ent-ia ent-ia-del" disabled={actionBusy} onClick={() => setShowRejectBox((s) => !s)} style={{ marginLeft: 6 }}>
                Reject
              </button>
            </span>
          )}

          {showRejectBox && (
            <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
              <input
                className="ent-fc" style={{ maxWidth: 360 }} placeholder="Reason for rejection"
                value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
              />
              <button className="ent-ia ent-ia-del" disabled={actionBusy || !rejectReason.trim()} onClick={handleReject}>
                {actionBusy ? "…" : "Confirm Reject"}
              </button>
              <button className="ent-ia ent-ia-edit" onClick={() => { setShowRejectBox(false); setRejectReason(""); }}>Cancel</button>
            </div>
          )}

          {actionError && <p style={{ color: "#dc2626", fontSize: 13, marginTop: 8 }}>{actionError}</p>}
        </div>
      )}

      <div className="ent-section" style={{ marginBottom: 16, padding: 14 }}>
        <div className="ent-section-hdr">
          <span className="ent-section-title">Basic Details</span>
          {!editingBasics && (
            <button className="ent-ia ent-ia-edit" onClick={() => setEditingBasics(true)}>Edit</button>
          )}
        </div>

        {editingBasics ? (
          <>
            <div className="ent-form-grid">
              <div className="ent-fg"><label className="ent-fl">Name</label><input className="ent-fc" value={basics.name} onChange={(e) => setBasics((f) => ({ ...f, name: e.target.value }))} /></div>
              <div className="ent-fg"><label className="ent-fl">GSTIN</label><input className="ent-fc" value={basics.gstin} onChange={(e) => setBasics((f) => ({ ...f, gstin: e.target.value }))} /></div>
              <div className="ent-fg">
                <label className="ent-fl">State (GST)</label>
                <select className="ent-fc" value={basics.stateCode} onChange={(e) => setBasics((f) => ({ ...f, stateCode: e.target.value }))}>
                  <option value="">Auto from GSTIN, or select…</option>
                  {GST_STATE_CODES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                </select>
              </div>
              <div className="ent-fg"><label className="ent-fl">Phone</label><input className="ent-fc" value={basics.phone} onChange={(e) => setBasics((f) => ({ ...f, phone: e.target.value }))} /></div>
              <div className="ent-fg"><label className="ent-fl">Email</label><input className="ent-fc" value={basics.email} onChange={(e) => setBasics((f) => ({ ...f, email: e.target.value }))} /></div>
              {isVendor && (
                <>
                  <div className="ent-fg">
                    <label className="ent-fl">Vendor Category</label>
                    <input className="ent-fc" list="vendor-category-list" value={basics.vendorCategory} onChange={(e) => setBasics((f) => ({ ...f, vendorCategory: e.target.value }))} />
                    <datalist id="vendor-category-list">{VENDOR_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
                  </div>
                  <div className="ent-fg">
                    <label className="ent-fl">Tax ID Type (non-India)</label>
                    <input className="ent-fc" list="tax-id-type-list" placeholder="e.g. EIN, VAT No." value={basics.taxIdType} onChange={(e) => setBasics((f) => ({ ...f, taxIdType: e.target.value }))} />
                    <datalist id="tax-id-type-list">{TAX_ID_TYPE_SUGGESTIONS.map((t) => <option key={t} value={t} />)}</datalist>
                  </div>
                  <div className="ent-fg"><label className="ent-fl">Tax ID</label><input className="ent-fc" value={basics.taxId} onChange={(e) => setBasics((f) => ({ ...f, taxId: e.target.value }))} /></div>
                </>
              )}
            </div>
            {actionError && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 0 10px" }}>{actionError}</p>}
            <button className="ent-btn-save" disabled={actionBusy} onClick={handleSaveBasics}>{actionBusy ? "Saving…" : "Save"}</button>
            <button className="ent-ia ent-ia-del" onClick={() => { setEditingBasics(false); setActionError(null); }} style={{ marginLeft: 8 }}>Cancel</button>
          </>
        ) : (
          <div className="ent-form-grid">
            <div><span style={{ color: "var(--color-muted)", fontSize: 12 }}>Code</span><div>{bp.code || "—"}</div></div>
            <div><span style={{ color: "var(--color-muted)", fontSize: 12 }}>GSTIN</span><div>{bp.gstin || "—"}</div></div>
            <div><span style={{ color: "var(--color-muted)", fontSize: 12 }}>State (GST)</span><div>{GST_STATE_CODES.find((s) => s.code === bp.stateCode)?.name || bp.stateCode || "—"}</div></div>
            <div><span style={{ color: "var(--color-muted)", fontSize: 12 }}>Phone</span><div>{bp.phone || "—"}</div></div>
            <div><span style={{ color: "var(--color-muted)", fontSize: 12 }}>Email</span><div>{bp.email || "—"}</div></div>
            <div style={{ gridColumn: "1 / -1" }}><span style={{ color: "var(--color-muted)", fontSize: 12 }}>Address</span><div>{bp.address?.full || "—"}</div></div>
            {isVendor && (
              <>
                <div><span style={{ color: "var(--color-muted)", fontSize: 12 }}>Vendor Category</span><div>{bp.vendorCategory || "—"}</div></div>
                <div><span style={{ color: "var(--color-muted)", fontSize: 12 }}>Tax ID</span><div>{bp.taxId ? `${bp.taxIdType ? bp.taxIdType + ": " : ""}${bp.taxId}` : "—"}</div></div>
              </>
            )}
            <div><span style={{ color: "var(--color-muted)", fontSize: 12 }}>Status</span><div><span className={bp.isActive ? "badge badge-green" : "badge badge-gray"}>{bp.isActive ? "Active" : "Inactive"}</span> <button className="ent-ia ent-ia-edit" onClick={handleToggleActive}>{bp.isActive ? "Deactivate" : "Activate"}</button></div></div>
          </div>
        )}
      </div>

      {/* Not gated on bpType. The tables and the API were always
          type-neutral — GET /:id returns all three "regardless of bpType"
          — only this page hid them, which left a customer with multiple
          delivery sites or AP contacts nowhere to record them. Approval
          status and Vendor Category above stay vendor-only; those really
          are vendor concepts. */}
      <ContactsSection businessPartnerId={bp.id} contacts={bp.vendorContacts ?? []} canManage={canManage} onChanged={load} />
      <AddressesSection businessPartnerId={bp.id} addresses={bp.vendorAddresses ?? []} canManage={canManage} onChanged={load} />
      <BankAccountsSection businessPartnerId={bp.id} accounts={bp.vendorBankAccounts ?? []} canManage={canManage} onChanged={load} />

      {canManage && (
        <div className="ent-section" style={{ padding: 14 }}>
          <div className="ent-section-hdr"><span className="ent-section-title">Delete</span></div>
          <p style={{ color: "var(--color-muted)", fontSize: 12, paddingBottom: 8 }}>
            Only possible while this partner has never been posted against. Once it appears on
            any journal entry the server refuses — deactivate it instead, which keeps its
            ledger history and removes it from new documents.
          </p>
          {deleteError && <p style={{ color: "#dc2626", fontSize: 13, paddingBottom: 8 }}>{deleteError}</p>}
          {confirmingDelete ? (
            <>
              <span style={{ fontSize: 13, marginRight: 8 }}>Delete <strong>{bp.name}</strong>?</span>
              <button className="ent-ia ent-ia-del" disabled={actionBusy} onClick={handleDelete}>
                {actionBusy ? "Deleting…" : "Yes, delete"}
              </button>
              <button className="ent-ia ent-ia-edit" style={{ marginLeft: 6 }} onClick={() => setConfirmingDelete(false)}>Cancel</button>
            </>
          ) : (
            <button className="ent-ia ent-ia-del" onClick={() => { setConfirmingDelete(true); setDeleteError(null); }}>
              Delete {bp.bpType === "CUSTOMER" ? "Customer" : "Vendor"}
            </button>
          )}
        </div>
      )}
    </AppShell>
  );
}

// ── Contacts ─────────────────────────────────────────────────────────────

function ContactsSection({ businessPartnerId, contacts, canManage, onChanged }: {
  businessPartnerId: string; contacts: VendorContact[]; canManage: boolean; onChanged: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", designation: "", phone: "", email: "", isPrimary: false });

  function startAdd() {
    setForm({ name: "", designation: "", phone: "", email: "", isPrimary: contacts.length === 0 });
    setEditingId(null);
    setShowForm(true);
    setErr(null);
  }
  function startEdit(c: VendorContact) {
    setForm({ name: c.name, designation: c.designation ?? "", phone: c.phone ?? "", email: c.email ?? "", isPrimary: c.isPrimary });
    setEditingId(c.id);
    setShowForm(true);
    setErr(null);
  }

  async function handleSave() {
    setBusy(true);
    setErr(null);
    try {
      const body = {
        name: form.name, designation: form.designation || null, phone: form.phone || null,
        email: form.email || null, isPrimary: form.isPrimary,
      };
      if (editingId) await updateVendorContact(businessPartnerId, editingId, body);
      else await createVendorContact(businessPartnerId, body);
      setShowForm(false);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save contact.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this contact?")) return;
    setBusy(true);
    try {
      await deleteVendorContact(businessPartnerId, id);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not delete contact.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ent-page-table" style={{ marginBottom: 16 }}>
      <div className="ent-section-hdr">
        <span className="ent-section-title">Contacts</span>
        {canManage && <button className="ent-btn-add" onClick={startAdd}>{showForm && !editingId ? "Cancel" : "+ Add Contact"}</button>}
      </div>

      {showForm && (
        <div className="ent-form-grid" style={{ padding: "0 14px 12px" }}>
          <div className="ent-fg"><label className="ent-fl">Name</label><input className="ent-fc" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
          <div className="ent-fg"><label className="ent-fl">Designation</label><input className="ent-fc" value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} /></div>
          <div className="ent-fg"><label className="ent-fl">Phone</label><input className="ent-fc" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
          <div className="ent-fg"><label className="ent-fl">Email</label><input className="ent-fc" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
          <div className="ent-fg" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={form.isPrimary} onChange={(e) => setForm((f) => ({ ...f, isPrimary: e.target.checked }))} id="contact-primary" />
            <label htmlFor="contact-primary" className="ent-fl" style={{ margin: 0 }}>Primary contact</label>
          </div>
          {err && <p style={{ color: "#dc2626", fontSize: 13, gridColumn: "1/-1" }}>{err}</p>}
          <div style={{ gridColumn: "1/-1" }}>
            <button className="ent-btn-save" disabled={busy || !form.name} onClick={handleSave}>{busy ? "Saving…" : "Save Contact"}</button>
            <button className="ent-ia ent-ia-del" onClick={() => setShowForm(false)} style={{ marginLeft: 8 }}>Cancel</button>
          </div>
        </div>
      )}

      <table>
        <thead><tr><th>Name</th><th>Designation</th><th>Phone</th><th>Email</th><th /><th /></tr></thead>
        <tbody>
          {contacts.length === 0 && <tr><td colSpan={6} className="ent-empty">No contacts yet.</td></tr>}
          {contacts.map((c) => (
            <tr key={c.id}>
              <td style={{ fontWeight: 500 }}>{c.name}{c.isPrimary && <span className="badge badge-purple" style={{ marginLeft: 6 }}>Primary</span>}</td>
              <td>{c.designation || "—"}</td>
              <td>{c.phone || "—"}</td>
              <td>{c.email || "—"}</td>
              <td style={{ textAlign: "right" }}>
                {canManage && <button className="ent-ia ent-ia-edit" onClick={() => startEdit(c)}>Edit</button>}
              </td>
              <td style={{ textAlign: "right" }}>
                {canManage && <button className="ent-ia ent-ia-del" disabled={busy} onClick={() => handleDelete(c.id)}>Delete</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Addresses ────────────────────────────────────────────────────────────

function AddressesSection({ businessPartnerId, addresses, canManage, onChanged }: {
  businessPartnerId: string; addresses: VendorAddress[]; canManage: boolean; onChanged: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    label: "Registered", line1: "", line2: "", city: "", state: "", stateCode: "",
    pincode: "", country: "India", isPrimary: false,
  });

  function startAdd() {
    setForm({ label: "Registered", line1: "", line2: "", city: "", state: "", stateCode: "", pincode: "", country: "India", isPrimary: addresses.length === 0 });
    setEditingId(null);
    setShowForm(true);
    setErr(null);
  }
  function startEdit(a: VendorAddress) {
    setForm({
      label: a.label, line1: a.line1 ?? "", line2: a.line2 ?? "", city: a.city ?? "",
      state: a.state ?? "", stateCode: a.stateCode ?? "", pincode: a.pincode ?? "",
      country: a.country, isPrimary: a.isPrimary,
    });
    setEditingId(a.id);
    setShowForm(true);
    setErr(null);
  }

  async function handleSave() {
    setBusy(true);
    setErr(null);
    try {
      const body = {
        label: form.label, line1: form.line1 || null, line2: form.line2 || null, city: form.city || null,
        state: form.state || null, stateCode: form.stateCode || null, pincode: form.pincode || null,
        country: form.country || "India", isPrimary: form.isPrimary,
      };
      if (editingId) await updateVendorAddress(businessPartnerId, editingId, body);
      else await createVendorAddress(businessPartnerId, body);
      setShowForm(false);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save address.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this address?")) return;
    setBusy(true);
    try {
      await deleteVendorAddress(businessPartnerId, id);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not delete address.");
    } finally {
      setBusy(false);
    }
  }

  const isIndia = form.country.trim().toLowerCase() === "india";

  return (
    <div className="ent-page-table" style={{ marginBottom: 16 }}>
      <div className="ent-section-hdr">
        <span className="ent-section-title">Addresses</span>
        {canManage && <button className="ent-btn-add" onClick={startAdd}>{showForm && !editingId ? "Cancel" : "+ Add Address"}</button>}
      </div>

      {showForm && (
        <div className="ent-form-grid" style={{ padding: "0 14px 12px" }}>
          <div className="ent-fg"><label className="ent-fl">Label</label><input className="ent-fc" placeholder="Registered / Billing / Shipping / Warehouse" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} /></div>
          <div className="ent-fg">
            <label className="ent-fl">Country</label>
            <input className="ent-fc" list="country-list" value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} />
            <datalist id="country-list">{COMMON_COUNTRIES.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div className="ent-fg"><label className="ent-fl">Address Line 1</label><input className="ent-fc" value={form.line1} onChange={(e) => setForm((f) => ({ ...f, line1: e.target.value }))} /></div>
          <div className="ent-fg"><label className="ent-fl">Address Line 2</label><input className="ent-fc" value={form.line2} onChange={(e) => setForm((f) => ({ ...f, line2: e.target.value }))} /></div>
          <div className="ent-fg"><label className="ent-fl">City</label><input className="ent-fc" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} /></div>
          {isIndia ? (
            <div className="ent-fg">
              <label className="ent-fl">State</label>
              <select
                className="ent-fc" value={form.stateCode}
                onChange={(e) => {
                  const s = GST_STATE_CODES.find((x) => x.code === e.target.value);
                  setForm((f) => ({ ...f, stateCode: e.target.value, state: s?.name ?? f.state }));
                }}
              >
                <option value="">Select…</option>
                {GST_STATE_CODES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select>
            </div>
          ) : (
            <div className="ent-fg"><label className="ent-fl">State / Province</label><input className="ent-fc" value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} /></div>
          )}
          <div className="ent-fg"><label className="ent-fl">{isIndia ? "PIN Code" : "Postal Code"}</label><input className="ent-fc" value={form.pincode} onChange={(e) => setForm((f) => ({ ...f, pincode: e.target.value }))} /></div>
          <div className="ent-fg" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={form.isPrimary} onChange={(e) => setForm((f) => ({ ...f, isPrimary: e.target.checked }))} id="address-primary" />
            <label htmlFor="address-primary" className="ent-fl" style={{ margin: 0 }}>Primary address</label>
          </div>
          {err && <p style={{ color: "#dc2626", fontSize: 13, gridColumn: "1/-1" }}>{err}</p>}
          <div style={{ gridColumn: "1/-1" }}>
            <button className="ent-btn-save" disabled={busy} onClick={handleSave}>{busy ? "Saving…" : "Save Address"}</button>
            <button className="ent-ia ent-ia-del" onClick={() => setShowForm(false)} style={{ marginLeft: 8 }}>Cancel</button>
          </div>
        </div>
      )}

      <table>
        <thead><tr><th>Label</th><th>Address</th><th>Country</th><th /><th /></tr></thead>
        <tbody>
          {addresses.length === 0 && <tr><td colSpan={5} className="ent-empty">No addresses yet.</td></tr>}
          {addresses.map((a) => (
            <tr key={a.id}>
              <td style={{ fontWeight: 500 }}>{a.label}{a.isPrimary && <span className="badge badge-purple" style={{ marginLeft: 6 }}>Primary</span>}</td>
              <td>{[a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(", ") || "—"}</td>
              <td>{a.country}</td>
              <td style={{ textAlign: "right" }}>
                {canManage && <button className="ent-ia ent-ia-edit" onClick={() => startEdit(a)}>Edit</button>}
              </td>
              <td style={{ textAlign: "right" }}>
                {canManage && <button className="ent-ia ent-ia-del" disabled={busy} onClick={() => handleDelete(a.id)}>Delete</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Bank Accounts ────────────────────────────────────────────────────────

function BankAccountsSection({ businessPartnerId, accounts, canManage, onChanged }: {
  businessPartnerId: string; accounts: VendorBankAccount[]; canManage: boolean; onChanged: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    accountHolderName: "", bankName: "", accountNumber: "", ifscCode: "", swiftCode: "",
    routingNumber: "", branchName: "", isPrimary: false,
  });

  function startAdd() {
    setForm({ accountHolderName: "", bankName: "", accountNumber: "", ifscCode: "", swiftCode: "", routingNumber: "", branchName: "", isPrimary: accounts.length === 0 });
    setEditingId(null);
    setShowForm(true);
    setErr(null);
  }
  function startEdit(b: VendorBankAccount) {
    setForm({
      accountHolderName: b.accountHolderName ?? "", bankName: b.bankName ?? "", accountNumber: b.accountNumber ?? "",
      ifscCode: b.ifscCode ?? "", swiftCode: b.swiftCode ?? "", routingNumber: b.routingNumber ?? "",
      branchName: b.branchName ?? "", isPrimary: b.isPrimary,
    });
    setEditingId(b.id);
    setShowForm(true);
    setErr(null);
  }

  async function handleSave() {
    setBusy(true);
    setErr(null);
    try {
      const body = {
        accountHolderName: form.accountHolderName || null, bankName: form.bankName || null,
        accountNumber: form.accountNumber || null, ifscCode: form.ifscCode || null,
        swiftCode: form.swiftCode || null, routingNumber: form.routingNumber || null,
        branchName: form.branchName || null, isPrimary: form.isPrimary,
      };
      if (editingId) await updateVendorBankAccount(businessPartnerId, editingId, body);
      else await createVendorBankAccount(businessPartnerId, body);
      setShowForm(false);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save bank account.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this bank account?")) return;
    setBusy(true);
    try {
      await deleteVendorBankAccount(businessPartnerId, id);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not delete bank account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ent-page-table" style={{ marginBottom: 16 }}>
      <div className="ent-section-hdr">
        <span className="ent-section-title">Bank Accounts</span>
        {canManage && <button className="ent-btn-add" onClick={startAdd}>{showForm && !editingId ? "Cancel" : "+ Add Bank Account"}</button>}
      </div>

      {showForm && (
        <div className="ent-form-grid" style={{ padding: "0 14px 12px" }}>
          <div className="ent-fg"><label className="ent-fl">Account Holder Name</label><input className="ent-fc" value={form.accountHolderName} onChange={(e) => setForm((f) => ({ ...f, accountHolderName: e.target.value }))} /></div>
          <div className="ent-fg"><label className="ent-fl">Bank Name</label><input className="ent-fc" value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} /></div>
          <div className="ent-fg"><label className="ent-fl">Account Number</label><input className="ent-fc" value={form.accountNumber} onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))} /></div>
          <div className="ent-fg"><label className="ent-fl">Branch Name</label><input className="ent-fc" value={form.branchName} onChange={(e) => setForm((f) => ({ ...f, branchName: e.target.value }))} /></div>
          <div className="ent-fg"><label className="ent-fl">IFSC Code (India)</label><input className="ent-fc" value={form.ifscCode} onChange={(e) => setForm((f) => ({ ...f, ifscCode: e.target.value }))} /></div>
          <div className="ent-fg"><label className="ent-fl">SWIFT / BIC (international)</label><input className="ent-fc" value={form.swiftCode} onChange={(e) => setForm((f) => ({ ...f, swiftCode: e.target.value }))} /></div>
          <div className="ent-fg"><label className="ent-fl">Routing Number (US ABA / Canada)</label><input className="ent-fc" value={form.routingNumber} onChange={(e) => setForm((f) => ({ ...f, routingNumber: e.target.value }))} /></div>
          <div className="ent-fg" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={form.isPrimary} onChange={(e) => setForm((f) => ({ ...f, isPrimary: e.target.checked }))} id="bank-primary" />
            <label htmlFor="bank-primary" className="ent-fl" style={{ margin: 0 }}>Primary account</label>
          </div>
          <p style={{ fontSize: 12, color: "var(--color-muted)", gridColumn: "1/-1" }}>
            Fill in whichever code applies to this partner&apos;s country — IFSC, SWIFT/BIC, and Routing Number can all coexist. Master data only; SmartERP has no payment-execution feature.
          </p>
          {err && <p style={{ color: "#dc2626", fontSize: 13, gridColumn: "1/-1" }}>{err}</p>}
          <div style={{ gridColumn: "1/-1" }}>
            <button className="ent-btn-save" disabled={busy} onClick={handleSave}>{busy ? "Saving…" : "Save Bank Account"}</button>
            <button className="ent-ia ent-ia-del" onClick={() => setShowForm(false)} style={{ marginLeft: 8 }}>Cancel</button>
          </div>
        </div>
      )}

      <table>
        <thead><tr><th>Bank</th><th>Account No.</th><th>IFSC / SWIFT / Routing</th><th /><th /></tr></thead>
        <tbody>
          {accounts.length === 0 && <tr><td colSpan={5} className="ent-empty">No bank accounts yet.</td></tr>}
          {accounts.map((b) => (
            <tr key={b.id}>
              <td style={{ fontWeight: 500 }}>{b.bankName || "—"}{b.isPrimary && <span className="badge badge-purple" style={{ marginLeft: 6 }}>Primary</span>}</td>
              <td>{b.accountNumber || "—"}</td>
              <td>{[b.ifscCode, b.swiftCode, b.routingNumber].filter(Boolean).join(" / ") || "—"}</td>
              <td style={{ textAlign: "right" }}>
                {canManage && <button className="ent-ia ent-ia-edit" onClick={() => startEdit(b)}>Edit</button>}
              </td>
              <td style={{ textAlign: "right" }}>
                {canManage && <button className="ent-ia ent-ia-del" disabled={busy} onClick={() => handleDelete(b.id)}>Delete</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
