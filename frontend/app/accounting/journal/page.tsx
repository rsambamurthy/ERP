"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import AccountPicker from "@/components/shared/AccountPicker";
import PartnerPicker from "@/components/shared/PartnerPicker";
import {
  ApiError,
  createJournalEntry,
  downloadJournalAttachment,
  getAccounts,
  getBusinessPartnerLookup,
  getJournalEntries,
  removeJournalAttachment,
  updateJournalEntry,
  uploadJournalAttachment,
} from "@/lib/api";
import { useBulkUpload } from "@/components/shared/BulkUpload";
import type { Account, BusinessPartnerLookup, JournalEntry, JournalLineInput, JournalUploadRow } from "@/lib/types";

// One row per LINE, not per entry — see routes/journal.ts's bulk-upload
// section. voucherRef is the only column worth showing beyond the usual
// account/amount fields; entryDate/narration are header fields that only
// need to appear once per voucher in the uploaded file, so most rows show
// them blank here even on success.
const JOURNAL_UPLOAD_COLUMNS: { key: keyof JournalUploadRow; label: string }[] = [
  { key: "voucherRef", label: "Voucher Ref" },
  { key: "accountCode", label: "Account" },
  { key: "businessPartnerCode", label: "Partner" },
  { key: "debit", label: "Debit" },
  { key: "credit", label: "Credit" },
];

// Voucher-class abstraction (SmartAppt Gold's UX): the user picks a class —
// Bank / Cash / Journal — plus, for Bank/Cash, a Receipt/Payment direction.
// This only turns into a raw voucher_type (BV/CV/JV) at save time. The
// distinctive part: for Bank/Cash the "money" line is never typed in — it's
// the account with code 1002/1001, and its amount is just the total of
// whatever contra lines the user entered.
type VoucherClass = "BANK" | "CASH" | "JOURNAL";
type Direction = "RECEIPT" | "PAYMENT";

const CASH_CODE = "1001";
const BANK_CODE = "1002";

interface ContraLine {
  accountId: string;
  businessPartnerId: string | null;
  amount: number;
}

const emptyContra = (): ContraLine => ({ accountId: "", businessPartnerId: null, amount: 0 });
const emptyFullLine = (): JournalLineInput => ({ accountId: "", businessPartnerId: null, debit: 0, credit: 0 });

function referenceLabel(e: JournalEntry): string {
  if (e.salesInvoice) return e.salesInvoice.invoiceNumber;
  if (e.purchaseBill) return e.purchaseBill.billNumber;
  if (e.salesReturn) return e.salesReturn.returnNumber;
  if (e.purchaseReturn) return e.purchaseReturn.returnNumber;
  if (e.stockAdjustment) return "Stock Adj.";
  return e.voucherNumber ?? e.voucherType ?? "—";
}

function sourceLabel(e: JournalEntry): string {
  if (e.salesInvoice) return "Sales Invoice";
  if (e.purchaseBill) return "Purchase Bill";
  if (e.salesReturn) return "Sales Return";
  if (e.purchaseReturn) return "Purchase Return";
  if (e.stockAdjustment) return "Stock Adjustment";
  return "Manual";
}

function amountOf(e: JournalEntry): number {
  return e.journalLines.reduce((s, l) => s + Number(l.debit || 0), 0);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function JournalEntriesPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [partners, setPartners] = useState<BusinessPartnerLookup[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | "create">("view");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [voucherClass, setVoucherClass] = useState<VoucherClass>("JOURNAL");
  const [direction, setDirection] = useState<Direction>("RECEIPT");
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [contraLines, setContraLines] = useState<ContraLine[]>([emptyContra()]);
  const [fullLines, setFullLines] = useState<JournalLineInput[]>([emptyFullLine(), emptyFullLine()]);

  const [attachFile, setAttachFile] = useState<File | null>(null);
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const cashAccount = useMemo(() => accounts.find((a) => a.accountCode === CASH_CODE), [accounts]);
  const bankAccount = useMemo(() => accounts.find((a) => a.accountCode === BANK_CODE), [accounts]);
  const moneyAccount = voucherClass === "CASH" ? cashAccount : voucherClass === "BANK" ? bankAccount : undefined;
  const isMoneyClass = voucherClass !== "JOURNAL";

  const selected = entries.find((e) => e.id === selectedId) ?? null;

  async function loadAll() {
    setLoading(true);
    try {
      const [entriesRes, accountsRes, partnersRes] = await Promise.all([
        getJournalEntries(),
        getAccounts(),
        getBusinessPartnerLookup(),
      ]);
      setEntries(entriesRes.data);
      setAccounts(accountsRes.data);
      setPartners(partnersRes.data);
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "Could not load journal entries.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const bulk = useBulkUpload<JournalUploadRow>(
    "journal", "SmartERP_JournalEntries_Template.xlsx", JOURNAL_UPLOAD_COLUMNS, loadAll
  );

  const contraTotal = useMemo(
    () => contraLines.reduce((s, l) => s + Number(l.amount || 0), 0),
    [contraLines]
  );
  const fullTotals = useMemo(() => {
    const debit = fullLines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const credit = fullLines.reduce((s, l) => s + Number(l.credit || 0), 0);
    return { debit, credit, diff: debit - credit, balanced: Math.abs(debit - credit) < 0.01 && debit > 0 };
  }, [fullLines]);

  const balanced = isMoneyClass ? contraTotal > 0 : fullTotals.balanced;

  function needsPartner(accountId: string, businessPartnerId: string | null): boolean {
    const acc = accountId ? accountById.get(accountId) : undefined;
    return !!acc?.isControlAccount && !businessPartnerId;
  }

  function startCreate() {
    setMode("create");
    setSelectedId(null);
    setFormError(null);
    setVoucherClass("JOURNAL");
    setDirection("RECEIPT");
    setEntryDate(new Date().toISOString().slice(0, 10));
    setNarration("");
    setContraLines([emptyContra()]);
    setFullLines([emptyFullLine(), emptyFullLine()]);
  }

  function openEntry(entry: JournalEntry) {
    setSelectedId(entry.id);
    setMode("view");
    setFormError(null);
    setAttachError(null);
    setAttachFile(null);
  }

  function startEdit(entry: JournalEntry) {
    setMode("edit");
    setFormError(null);
    setEntryDate(entry.entryDate.slice(0, 10));
    setNarration(entry.narration);
    if (entry.voucherType === "BV" || entry.voucherType === "CV") {
      const vc: VoucherClass = entry.voucherType === "BV" ? "BANK" : "CASH";
      const moneyCode = vc === "BANK" ? BANK_CODE : CASH_CODE;
      const moneyLine = entry.journalLines.find((l) => l.account.accountCode === moneyCode);
      setVoucherClass(vc);
      setDirection(moneyLine && Number(moneyLine.debit) > 0 ? "RECEIPT" : "PAYMENT");
      const contras = entry.journalLines
        .filter((l) => l.account.accountCode !== moneyCode)
        .map((l) => ({
          accountId: l.accountId,
          businessPartnerId: l.businessPartnerId ?? null,
          amount: Number(l.debit) > 0 ? Number(l.debit) : Number(l.credit),
        }));
      setContraLines(contras.length ? contras : [emptyContra()]);
    } else {
      setVoucherClass("JOURNAL");
      setFullLines(
        entry.journalLines.map((l) => ({
          accountId: l.accountId,
          businessPartnerId: l.businessPartnerId ?? null,
          debit: Number(l.debit),
          credit: Number(l.credit),
        }))
      );
    }
  }

  function cancelForm() {
    setFormError(null);
    setMode("view");
    if (!selected) setSelectedId(null);
  }

  function buildLinesForSave(): JournalLineInput[] {
    if (voucherClass === "JOURNAL") return fullLines.filter((l) => l.accountId);
    if (!moneyAccount) return [];
    const contras = contraLines.filter((l) => l.accountId && Number(l.amount) > 0);
    const total = contras.reduce((s, l) => s + Number(l.amount), 0);
    const moneyLine: JournalLineInput =
      direction === "RECEIPT"
        ? { accountId: moneyAccount.id, debit: total, credit: 0 }
        : { accountId: moneyAccount.id, debit: 0, credit: total };
    const contraOut: JournalLineInput[] = contras.map((l) =>
      direction === "RECEIPT"
        ? { accountId: l.accountId, businessPartnerId: l.businessPartnerId, debit: 0, credit: Number(l.amount) }
        : { accountId: l.accountId, businessPartnerId: l.businessPartnerId, debit: Number(l.amount), credit: 0 }
    );
    return [moneyLine, ...contraOut];
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!narration.trim()) {
      setFormError("Narration is required.");
      return;
    }
    if (!balanced) {
      setFormError(
        isMoneyClass ? "Enter at least one contra line amount." : "Entry isn't balanced — total debit must equal total credit."
      );
      return;
    }
    const lines = buildLinesForSave();
    if (lines.length < 2) {
      setFormError(
        isMoneyClass && !moneyAccount
          ? "The Cash/Bank account (code 1001/1002) wasn't found — sync Chart of Accounts templates first."
          : "At least 2 lines are required."
      );
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (mode === "edit" && selected) {
        const res = await updateJournalEntry(selected.id, { entryDate, narration, lines });
        await loadAll();
        setSelectedId(res.data.id);
        setMode("view");
      } else {
        const voucherType = voucherClass === "BANK" ? "BV" : voucherClass === "CASH" ? "CV" : "JV";
        const res = await createJournalEntry({ entryDate, narration, voucherType, lines });
        await loadAll();
        setSelectedId(res.data.id);
        setMode("view");
      }
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save entry.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAttach() {
    if (!selected || !attachFile) return;
    setAttachBusy(true);
    setAttachError(null);
    try {
      await uploadJournalAttachment(selected.id, attachFile);
      setAttachFile(null);
      await loadAll();
    } catch (err) {
      setAttachError(err instanceof ApiError ? err.message : "Could not upload attachment.");
    } finally {
      setAttachBusy(false);
    }
  }

  async function handleDownloadAttachment() {
    if (!selected?.attachmentFilename) return;
    try {
      await downloadJournalAttachment(selected.id, selected.attachmentFilename);
    } catch (err) {
      setAttachError(err instanceof ApiError ? err.message : "Could not download attachment.");
    }
  }

  async function handleRemoveAttachment() {
    if (!selected) return;
    setAttachBusy(true);
    setAttachError(null);
    try {
      await removeJournalAttachment(selected.id);
      await loadAll();
    } catch (err) {
      setAttachError(err instanceof ApiError ? err.message : "Could not remove attachment.");
    } finally {
      setAttachBusy(false);
    }
  }

  function updateContra(i: number, patch: Partial<ContraLine>) {
    setContraLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function updateFullLine(i: number, patch: Partial<JournalLineInput>) {
    setFullLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  const isFormOpen = mode === "create" || mode === "edit";
  const isManual = selected ? !selected.referenceType : true;

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Journal Entries</h1>
        <p>Every posted transaction, double-entry.</p>
      </div>

      <div className="ent-toolbar">
        <div style={{ flex: 1 }} />
        {bulk.buttons}
        <button className="ent-btn-add" onClick={startCreate}>
          + New Entry
        </button>
      </div>

      {bulk.panel}

      {listError && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{listError}</p>}

      <div className="ent-md">
        <div className="ent-md-list">
          <div className="ent-md-list-body">
            {loading && <div className="ent-empty">Loading…</div>}
            {!loading && entries.length === 0 && <div className="ent-empty">No entries yet.</div>}
            {entries.map((e) => {
              const auto = !!e.referenceType;
              return (
                <button
                  key={e.id}
                  className={`ent-md-row ${selectedId === e.id ? "active" : ""}`}
                  onClick={() => openEntry(e)}
                >
                  <div className="ent-md-row-top">
                    <span className="ent-md-row-ref">{referenceLabel(e)}</span>
                    <span className="ent-md-row-amt">₹{amountOf(e).toFixed(2)}</span>
                  </div>
                  <div className="ent-md-row-narr">{e.narration || "—"}</div>
                  <div className="ent-md-row-date">
                    {new Date(e.entryDate).toLocaleDateString()} ·{" "}
                    <span className={`badge ${auto ? "badge-purple" : "badge-gray"}`} style={{ padding: "1px 6px", fontSize: 10 }}>
                      {sourceLabel(e)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="ent-md-detail">
          {!isFormOpen && !selected && (
            <div className="ent-section">
              <div className="ent-empty" style={{ padding: 40 }}>
                Select an entry on the left, or click “+ New Entry” to post one.
              </div>
            </div>
          )}

          {!isFormOpen && selected && (
            <div className="ent-section">
              <div className="ent-section-hdr">
                <span className="ent-section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "#6d28d9", fontFamily: "monospace" }}>{referenceLabel(selected)}</span>
                  <span className="badge badge-purple">{sourceLabel(selected)}</span>
                </span>
                {isManual && (
                  <button className="ent-btn-cancel" onClick={() => startEdit(selected)}>
                    Edit
                  </button>
                )}
              </div>

              <div className="ent-form-grid" style={{ gridTemplateColumns: "1fr 2fr" }}>
                <div className="ent-fg">
                  <label className="ent-fl">Entry Date</label>
                  <div style={{ fontSize: 13, padding: "6px 0" }}>{new Date(selected.entryDate).toLocaleDateString()}</div>
                </div>
                <div className="ent-fg">
                  <label className="ent-fl">Narration</label>
                  <div style={{ fontSize: 13, padding: "6px 0" }}>{selected.narration}</div>
                </div>
              </div>

              <div style={{ padding: "0 14px" }}>
                <table className="ent-table">
                  <thead>
                    <tr>
                      <th style={{ width: "34%" }}>Account</th>
                      <th style={{ width: "26%" }}>Partner</th>
                      <th>Debit</th>
                      <th>Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.journalLines.map((l) => (
                      <tr key={l.id}>
                        <td>
                          {l.account.accountCode} — {l.account.accountName}
                        </td>
                        <td>{l.businessPartner?.name ?? "—"}</td>
                        <td style={{ color: "#2563eb", fontWeight: Number(l.debit) > 0 ? 600 : 400 }}>
                          {Number(l.debit) > 0 ? Number(l.debit).toFixed(2) : ""}
                        </td>
                        <td style={{ color: "#16a34a", fontWeight: Number(l.credit) > 0 ? 600 : 400 }}>
                          {Number(l.credit) > 0 ? Number(l.credit).toFixed(2) : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    background: "#f8fafd",
                    border: "1px solid var(--color-border)",
                    borderRadius: 6,
                    padding: "8px 14px",
                    fontSize: 13,
                    margin: "10px 0 14px",
                  }}
                >
                  <span>
                    Total: <strong>₹{amountOf(selected).toFixed(2)}</strong>
                  </span>
                  {!isManual && <span style={{ color: "var(--color-muted)" }}>Posted automatically — edit from its own module.</span>}
                </div>
              </div>

              <div className="ent-section-hdr" style={{ borderTop: "1px solid var(--color-border)" }}>
                <span className="ent-section-title">Attachment</span>
              </div>
              <div style={{ padding: "12px 14px" }}>
                {attachError && <p style={{ color: "#dc2626", fontSize: 12, marginBottom: 8 }}>{attachError}</p>}
                {selected.attachmentFilename ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5 }}>
                    <span>
                      📎 {selected.attachmentFilename}
                      {selected.attachmentSize != null && (
                        <span style={{ color: "var(--color-muted)" }}> ({formatSize(selected.attachmentSize)})</span>
                      )}
                    </span>
                    <button className="ent-ia ent-ia-edit" onClick={handleDownloadAttachment} disabled={attachBusy}>
                      Download
                    </button>
                    <button className="ent-ia ent-ia-del" onClick={handleRemoveAttachment} disabled={attachBusy}>
                      Remove
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                      type="file"
                      onChange={(e) => setAttachFile(e.target.files?.[0] ?? null)}
                      style={{ fontSize: 12 }}
                    />
                    <button className="ent-btn-save" disabled={!attachFile || attachBusy} onClick={handleAttach}>
                      {attachBusy ? "Uploading…" : "Upload"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {isFormOpen && (
            <form onSubmit={handleSave} className="ent-section">
              <div className="ent-section-hdr">
                <span className="ent-section-title">{mode === "edit" ? "Edit Entry" : "New Journal Entry"}</span>
                <button type="button" className="ent-btn-cancel" onClick={cancelForm}>
                  Cancel
                </button>
              </div>

              <div className="ent-tabs" style={{ margin: "0 14px" }}>
                {(["JOURNAL", "BANK", "CASH"] as VoucherClass[]).map((vc) => (
                  <button
                    key={vc}
                    type="button"
                    disabled={mode === "edit"}
                    className={`ent-tab ${voucherClass === vc ? "active" : ""}`}
                    style={mode === "edit" && voucherClass !== vc ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
                    onClick={() => setVoucherClass(vc)}
                  >
                    {vc === "JOURNAL" ? "Journal" : vc === "BANK" ? "Bank" : "Cash"}
                  </button>
                ))}
              </div>

              <div className="ent-form-grid" style={{ gridTemplateColumns: "1fr 2fr" }}>
                <div className="ent-fg">
                  <label className="ent-fl">Entry Date</label>
                  <input type="date" className="ent-fc" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
                </div>
                <div className="ent-fg">
                  <label className="ent-fl">Narration</label>
                  <input className="ent-fc" value={narration} onChange={(e) => setNarration(e.target.value)} required />
                </div>
              </div>

              {isMoneyClass && (
                <>
                  <div style={{ padding: "0 14px 10px" }}>
                    <label className="ent-fl" style={{ display: "block", marginBottom: 6 }}>
                      Direction
                    </label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => setDirection("RECEIPT")}
                        style={{
                          flex: 1,
                          padding: "6px 10px",
                          borderRadius: 5,
                          fontSize: 12.5,
                          fontWeight: 600,
                          cursor: "pointer",
                          border: `1px solid ${direction === "RECEIPT" ? "#16a34a" : "var(--color-border)"}`,
                          background: direction === "RECEIPT" ? "#dcfce7" : "#fff",
                          color: direction === "RECEIPT" ? "#15803d" : "var(--color-muted)",
                        }}
                      >
                        Receipt (money in)
                      </button>
                      <button
                        type="button"
                        onClick={() => setDirection("PAYMENT")}
                        style={{
                          flex: 1,
                          padding: "6px 10px",
                          borderRadius: 5,
                          fontSize: 12.5,
                          fontWeight: 600,
                          cursor: "pointer",
                          border: `1px solid ${direction === "PAYMENT" ? "#dc2626" : "var(--color-border)"}`,
                          background: direction === "PAYMENT" ? "#fee2e2" : "#fff",
                          color: direction === "PAYMENT" ? "#991b1b" : "var(--color-muted)",
                        }}
                      >
                        Payment (money out)
                      </button>
                    </div>
                  </div>

                  <div className="ent-money-line">
                    <span>
                      {moneyAccount
                        ? `${moneyAccount.accountCode} — ${moneyAccount.accountName}`
                        : "Cash/Bank account not found — sync Chart of Accounts templates."}
                    </span>
                    <span style={{ color: direction === "RECEIPT" ? "#2563eb" : "#16a34a", fontWeight: 700 }}>
                      {direction === "RECEIPT" ? "Dr" : "Cr"} ₹{contraTotal.toFixed(2)}
                    </span>
                  </div>
                </>
              )}

              <div style={{ padding: "0 14px" }}>
                {isMoneyClass ? (
                  <table className="ent-table">
                    <thead>
                      <tr>
                        <th style={{ width: "40%" }}>Contra Account</th>
                        <th style={{ width: "30%" }}>Partner</th>
                        <th>Amount</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {contraLines.map((line, i) => {
                        const account = line.accountId ? accountById.get(line.accountId) : undefined;
                        const warn = needsPartner(line.accountId, line.businessPartnerId);
                        return (
                          <tr key={i}>
                            <td>
                              <AccountPicker
                                accounts={accounts.filter((a) => a.isActive && !a.isGroup && a.id !== moneyAccount?.id)}
                                value={line.accountId || null}
                                onChange={(id) => updateContra(i, { accountId: id ?? "", businessPartnerId: null })}
                              />
                            </td>
                            <td>
                              <PartnerPicker
                                partners={partners.filter((p) => p.bpType === account?.defaultBpType)}
                                value={line.businessPartnerId ?? null}
                                onChange={(id) => updateContra(i, { businessPartnerId: id })}
                                disabled={!account?.isControlAccount}
                              />
                              {warn && <div className="ent-warn-note">⚠ required</div>}
                            </td>
                            <td>
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                className="ent-fc"
                                value={line.amount || ""}
                                onChange={(e) => updateContra(i, { amount: Number(e.target.value) })}
                              />
                            </td>
                            <td>
                              <button
                                type="button"
                                className="ent-ia ent-ia-del"
                                disabled={contraLines.length <= 1}
                                onClick={() => setContraLines((ls) => ls.filter((_, idx) => idx !== i))}
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <table className="ent-table">
                    <thead>
                      <tr>
                        <th style={{ width: "34%" }}>Account</th>
                        <th style={{ width: "26%" }}>Partner</th>
                        <th>Debit</th>
                        <th>Credit</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {fullLines.map((line, i) => {
                        const account = line.accountId ? accountById.get(line.accountId) : undefined;
                        const warn = needsPartner(line.accountId, line.businessPartnerId ?? null);
                        return (
                          <tr key={i}>
                            <td>
                              <AccountPicker
                                accounts={accounts.filter((a) => a.isActive && !a.isGroup)}
                                value={line.accountId || null}
                                onChange={(id) => updateFullLine(i, { accountId: id ?? "", businessPartnerId: null })}
                              />
                            </td>
                            <td>
                              <PartnerPicker
                                partners={partners.filter((p) => p.bpType === account?.defaultBpType)}
                                value={line.businessPartnerId ?? null}
                                onChange={(id) => updateFullLine(i, { businessPartnerId: id })}
                                disabled={!account?.isControlAccount}
                              />
                              {warn && <div className="ent-warn-note">⚠ required</div>}
                            </td>
                            <td>
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                className="ent-fc"
                                style={{ color: "#2563eb" }}
                                value={line.debit || ""}
                                onChange={(e) => updateFullLine(i, { debit: Number(e.target.value), credit: 0 })}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                className="ent-fc"
                                style={{ color: "#16a34a" }}
                                value={line.credit || ""}
                                onChange={(e) => updateFullLine(i, { credit: Number(e.target.value), debit: 0 })}
                              />
                            </td>
                            <td>
                              <button
                                type="button"
                                className="ent-ia ent-ia-del"
                                disabled={fullLines.length <= 2}
                                onClick={() => setFullLines((ls) => ls.filter((_, idx) => idx !== i))}
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}

                <button
                  type="button"
                  className="ent-add-row"
                  style={{ margin: "10px 0" }}
                  onClick={() =>
                    isMoneyClass
                      ? setContraLines((ls) => [...ls, emptyContra()])
                      : setFullLines((ls) => [...ls, emptyFullLine()])
                  }
                >
                  + Add line
                </button>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: "#f8fafd",
                    border: "1px solid var(--color-border)",
                    borderRadius: 6,
                    padding: "8px 14px",
                    fontSize: 13,
                    marginBottom: 12,
                  }}
                >
                  {isMoneyClass ? (
                    <span>
                      Total: <strong>₹{contraTotal.toFixed(2)}</strong>
                    </span>
                  ) : (
                    <>
                      <span>
                        Total Debit: <strong style={{ color: "#2563eb" }}>{fullTotals.debit.toFixed(2)}</strong>
                      </span>
                      <span>
                        Total Credit: <strong style={{ color: "#16a34a" }}>{fullTotals.credit.toFixed(2)}</strong>
                      </span>
                    </>
                  )}
                  <span style={{ color: balanced ? "#16a34a" : "#d97706", fontWeight: 600 }}>
                    {balanced
                      ? "✓ Balanced"
                      : isMoneyClass
                        ? "⚠ Enter at least one line"
                        : `⚠ Difference: ₹${Math.abs(fullTotals.diff).toFixed(2)}`}
                  </span>
                </div>

                {mode === "create" && (
                  <p style={{ fontSize: 11.5, color: "var(--color-muted)", marginTop: -4, marginBottom: 10 }}>
                    You can attach a supporting document once this entry is saved.
                  </p>
                )}
              </div>

              {formError && <p style={{ color: "#dc2626", fontSize: 13, padding: "0 14px 10px" }}>{formError}</p>}
              <div style={{ padding: "0 14px 14px" }}>
                <button type="submit" className="ent-btn-save" disabled={saving || !balanced}>
                  {saving ? "Saving…" : mode === "edit" ? "Save Changes" : "Post Entry"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </AppShell>
  );
}
