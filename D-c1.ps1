$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Phase D-c: the transfer screen...' -ForegroundColor Cyan

# This script is pure ASCII. Every non-ASCII character travels as ~U+XXXX~
# and is decoded below, so it behaves identically whether PowerShell reads it
# as UTF-8 or as Windows-1252. No byte-order mark needed.
$decoder = [Text.RegularExpressions.MatchEvaluator] {
  param($m)
  [char]::ConvertFromUtf32([Convert]::ToInt32($m.Groups[1].Value, 16))
}
function Decode($s) {
  return [Text.RegularExpressions.Regex]::Replace($s, '~U\+([0-9A-Fa-f]{4,6})~', $decoder)
}

function Set-FileText($rel, $text) {
  $p = Join-Path $repo $rel
  $dir = Split-Path $p -Parent
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [IO.File]::WriteAllText($p, (Decode $text).Replace([string][char]13, ''), (New-Object Text.UTF8Encoding $false))
  Write-Host "  wrote  $rel"
}
$f0 = @'
"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import {
  ApiError, cancelStockTransfer, createStockTransfer, getBranches, getItems,
  getStockTransfer, getStockTransfers, getTransferSeries, receiveStockTransfer,
  setTransferSeries,
} from "@/lib/api";
import { canPostTransactions } from "@/lib/auth";
import type {
  Branch, Item, StockTransferDetail, StockTransferSummary, TransferSeries,
} from "@/lib/types";
import { VALUATION_BASIS_LABEL } from "@/lib/types";

// Stock transfers between branches.
//
// One screen rather than a list and a detail page, because a transfer has a
// short life: it is dispatched, and then it is received. Expanding a row
// shows what is on it and the two things that can still be done to it.
//
// TWO KINDS OF TRANSFER, AND THE SCREEN HAS TO SAY WHICH
//
// Same GSTIN at both ends: one legal person moving its own goods. Not a
// supply. A delivery challan under Rule 55, and two journal entries through
// 1304 Stock in Transit.
//
// Different GSTINs: section 25(4) makes them distinct persons, so this IS a
// supply ~U+2014~ a tax invoice under section 31 / Rule 46, GST on a Rule 28 value,
// and three journal entries because two registrations keep two trial
// balances. The tax is computed on cost, because the second proviso to Rule
// 28 deems the invoice value to be open market value wherever the receiving
// branch can claim full input tax credit.
//
// Which one applies is decided by the two branches' GSTINs and nothing else,
// so the screen can say so the moment both are picked ~U+2014~ before anything is
// submitted. Everything that would make the server REFUSE a taxable dispatch
// (no state code, no invoice series, a branch that cannot claim full credit)
// is checked here too, for the same reason: a lorry should not be loaded
// against a document that cannot be issued.

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const STATUS_BADGE: Record<string, string> = {
  DISPATCHED: "badge badge-yellow",
  RECEIVED: "badge badge-green",
  CANCELLED: "badge badge-gray",
};
const STATUS_LABEL: Record<string, string> = {
  DISPATCHED: "In transit",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};

interface LineDraft { key: string; itemId: string; quantity: string }
let seq = 0;
const nextKey = () => `r${++seq}`;

export default function StockTransfersPage() {
  const canPost = canPostTransactions();

  const [rows, setRows] = useState<StockTransferSummary[]>([]);
  const [status, setStatus] = useState("DISPATCHED");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<StockTransferDetail | null>(null);

  const [creating, setCreating] = useState(false);
  // The invoice-numbering panel. Loaded on demand ~U+2014~ most sessions never
  // touch it, and a branch's prefix is set once a year at most.
  const [series, setSeries] = useState<TransferSeries | null>(null);
  const [showSeries, setShowSeries] = useState(false);
  const [prefixDraft, setPrefixDraft] = useState<Record<string, string>>({});

  const [branches, setBranches] = useState<Branch[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [form, setForm] = useState({
    fromBranchId: "", toBranchId: "", transferDate: today(),
    documentNumber: "", ewayBillNumber: "",
  });
  const [draft, setDraft] = useState<LineDraft[]>([]);

  const load = useCallback(async (s: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getStockTransfers(s);
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load transfers.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(status); }, [status, load]);

  async function toggleRow(id: string) {
    if (expanded === id) { setExpanded(null); setDetail(null); return; }
    setExpanded(id);
    setDetail(null);
    try {
      const res = await getStockTransfer(id);
      setDetail(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load that transfer.");
    }
  }

  async function beginCreate() {
    setCreating(true);
    setError(null);
    setDraft([{ key: nextKey(), itemId: "", quantity: "" }]);
    try {
      // The series comes along because the form needs it to tell the user, up
      // front, whether a taxable dispatch from the chosen branch can even be
      // numbered.
      const [b, i, s] = await Promise.all([getBranches(), getItems(), getTransferSeries()]);
      const live = b.data.filter((x) => x.status !== "INACTIVE");
      setBranches(live);
      setItems(i.data.filter((x) => x.itemKind !== "SERVICE" && x.isActive));
      setSeries(s.data);
      setForm((f) => ({ ...f, fromBranchId: f.fromBranchId || (live[0]?.id ?? "") }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the pickers.");
    }
  }

  async function openSeries() {
    setShowSeries(true);
    setError(null);
    try {
      const s = await getTransferSeries();
      setSeries(s.data);
      setPrefixDraft(Object.fromEntries(s.data.branches.map((b) => [b.branchId, b.prefix ?? ""])));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the numbering series.");
    }
  }

  async function run(fn: () => Promise<string>) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const msg = await fn();
      setNotice(msg);
      setExpanded(null); setDetail(null);
      await load(status);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not post. Nothing was written.");
    } finally {
      setBusy(false);
    }
  }

  const muted = { color: "var(--color-muted)", fontSize: 12 } as const;
  const num = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

  const from = branches.find((b) => b.id === form.fromBranchId);
  const to = branches.find((b) => b.id === form.toBranchId);

  // Equal GSTINs ~U+2014~ including both blank, which is one unregistered person ~U+2014~
  // is one registration, so nothing is supplied to anybody. Anything else is
  // two distinct persons under section 25(4), and a supply.
  const taxable = !!from && !!to
    && (from.gstin ?? "").trim().toUpperCase() !== (to.gstin ?? "").trim().toUpperCase();

  const fromSeries = series?.branches.find((s) => s.branchId === form.fromBranchId);
  const toSeries = series?.branches.find((s) => s.branchId === form.toBranchId);

  // Every reason the server would refuse this dispatch, worked out here so
  // the form can say so before stock is committed to a lorry. Each mirrors a
  // refusal in routes/stockTransfers.ts; the wording differs because there it
  // explains to an API caller and here it tells someone what to go and fix.
  const blockers: string[] = [];
  if (taxable && from && to) {
    if (toSeries && toSeries.itcEligibility !== "FULL") {
      blockers.push(
        `${to.name} is marked as not able to claim full input tax credit. The second proviso to Rule 28 does not `
        + "apply to it, so the tax stops being revenue-neutral and becomes a cost that has to be capitalised into "
        + "that branch's stock ~U+2014~ which is not built. Change the branch, or its ITC setting if that marking is wrong.",
      );
    }
    if (!from.stateCode || !to.stateCode) {
      blockers.push(
        `${!from.stateCode ? from.name : to.name} has no GST state code, so this cannot be split into CGST+SGST or `
        + "IGST. Set it on the branch ~U+2014~ this is your own registration, and guessing would put the tax under the "
        + "wrong heads on a real return.",
      );
    }
    if (series && !fromSeries?.configured) {
      blockers.push(
        `${from.name} has no tax-invoice series for ${series.financialYear}. Rule 46(b) wants a consecutive serial `
        + "number and there is none to take ~U+2014~ set the prefix under Invoice numbering.",
      );
    }
  }

  // Same-state means CGST+SGST, different means IGST. Two registrations are
  // usually in two states, but not always: section 25(2) allows more than one
  // in a single state, and those are CGST+SGST.
  const interState = taxable && !!from?.stateCode && !!to?.stateCode && from.stateCode !== to.stateCode;

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Stock Transfers</h1>
        <p>
          Goods moving from one branch to another. Dispatched stock sits in 1304 Stock in Transit until the
          receiving branch confirms it ~U+2014~ which is where it actually is. Between branches on different GSTINs
          it is a taxable supply and a tax invoice is raised; on the same GSTIN it is a delivery challan.
        </p>
      </div>

      <div className="ent-toolbar">
        <label className="ent-fl" style={{ margin: 0 }}>Status</label>
        <select className="ent-fc" style={{ width: 160, height: 34 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="DISPATCHED">In transit</option>
          <option value="RECEIVED">Received</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="ALL">All</option>
        </select>
        <span style={muted}>{loading ? "Loading~U+2026~" : `${rows.length} transfer${rows.length === 1 ? "" : "s"}`}</span>
        <div style={{ flex: 1 }} />
        {canPost && !showSeries && (
          <button className="ent-ia ent-ia-edit" onClick={openSeries}>Invoice numbering</button>
        )}
        {canPost && !creating && <button className="ent-btn-add" onClick={beginCreate}>New Transfer</button>}
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {notice && (
        <div className="ent-section" style={{ marginBottom: 16, padding: 14 }}>
          <p style={{ fontSize: 13, margin: 0 }}>
            {notice}{" "}
            <Link href="/accounting/journal" className="ent-ia ent-ia-edit" style={{ padding: 0 }}>View journal</Link>
          </p>
        </div>
      )}

      {/* Invoice numbering. A branch cannot send a taxable transfer without a
          series, so this is not an advanced setting tucked away somewhere ~U+2014~
          it is one click from the screen that needs it. */}
      {showSeries && (
        <div className="ent-section" style={{ marginBottom: 16 }}>
          <div className="ent-section-hdr">
            <span className="ent-section-title">
              Tax invoice numbering{series ? ` ~U+2014~ ${series.financialYear}` : ""}
            </span>
            <button className="ent-ia ent-ia-edit" onClick={() => setShowSeries(false)}>Close</button>
          </div>
          <div style={{ padding: 14 }}>
            <p style={{ ...muted, marginTop: 0 }}>
              A branch transfer between different GSTINs needs a tax invoice with a consecutive serial number under
              Rule 46(b), and two branches are distinct persons under section 25(4) ~U+2014~ so the series belongs to the
              sending branch, not the company. The running number is not editable: moving it backwards would
              re-issue a number that has already been on a document.
            </p>
            {!series && <p style={muted}>Loading~U+2026~</p>}
            {series && (
              <table style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>Branch</th>
                    <th style={{ width: 150 }}>GSTIN</th>
                    <th style={{ width: 220 }}>Prefix</th>
                    <th style={{ width: 120, ...num }}>Next number</th>
                    <th style={{ width: 90 }} />
                  </tr>
                </thead>
                <tbody>
                  {series.branches.map((b) => {
                    const draftPrefix = prefixDraft[b.branchId] ?? "";
                    const changed = draftPrefix.trim() !== (b.prefix ?? "");
                    return (
                      <tr key={b.branchId}>
                        <td>
                          {b.name}
                          {b.itcEligibility !== "FULL" && (
                            <div style={muted}>Cannot claim full ITC ~U+2014~ transfers into it are refused</div>
                          )}
                          {!b.stateCode && <div style={muted}>No GST state code set</div>}
                        </td>
                        <td style={muted}>{b.gstin || "not set"}</td>
                        <td>
                          <input type="text" className="ent-fc" maxLength={18} placeholder="GST/IBT/TN"
                            value={draftPrefix}
                            onChange={(e) => setPrefixDraft((d) => ({ ...d, [b.branchId]: e.target.value }))} />
                          {draftPrefix.trim() && (
                            <span style={muted}>
                              Numbers will read {draftPrefix.trim()}/{series.financialYear.slice(2)}/
                              {String(b.nextNumber ?? 1).padStart(4, "0")}
                            </span>
                          )}
                        </td>
                        <td style={num}>{b.nextNumber ?? "~U+2014~"}</td>
                        <td style={{ textAlign: "right" }}>
                          <button className="ent-ia ent-ia-edit" disabled={busy || !changed || !draftPrefix.trim()}
                            onClick={() => run(async () => {
                              await setTransferSeries({
                                branchId: b.branchId, financialYear: series.financialYear,
                                prefix: draftPrefix.trim(),
                              });
                              const s = await getTransferSeries(series.financialYear);
                              setSeries(s.data);
                              return `${b.name} will number its transfer invoices ${draftPrefix.trim()}.`;
                            })}>
                            Save
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {creating && (
        <div className="ent-section" style={{ marginBottom: 16 }}>
          <div className="ent-section-hdr"><span className="ent-section-title">New transfer</span></div>
          <div style={{ padding: 14 }}>
            <div className="ent-form-grid">
              <div className="ent-fg">
                <span className="ent-fl">From</span>
                <select className="ent-fc" value={form.fromBranchId} onChange={(e) => setForm((f) => ({ ...f, fromBranchId: e.target.value }))}>
                  <option value="">Pick a branch~U+2026~</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                {from && <span style={muted}>GSTIN {from.gstin || "not set"}</span>}
              </div>
              <div className="ent-fg">
                <span className="ent-fl">To</span>
                <select className="ent-fc" value={form.toBranchId} onChange={(e) => setForm((f) => ({ ...f, toBranchId: e.target.value }))}>
                  <option value="">Pick a branch~U+2026~</option>
                  {branches.filter((b) => b.id !== form.fromBranchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                {to && <span style={muted}>GSTIN {to.gstin || "not set"}</span>}
              </div>
              <div className="ent-fg">
                <span className="ent-fl">Dispatch date</span>
                <input type="date" className="ent-fc" value={form.transferDate}
                  onChange={(e) => setForm((f) => ({ ...f, transferDate: e.target.value }))} />
              </div>
              <div className="ent-fg">
                <span className="ent-fl">Delivery challan no.</span>
                <input type="text" className="ent-fc" maxLength={30} value={form.documentNumber}
                  onChange={(e) => setForm((f) => ({ ...f, documentNumber: e.target.value }))} />
                <span style={muted}>Rule 55 requires the challan; the number here is for your record.</span>
              </div>
              <div className="ent-fg">
                <span className="ent-fl">E-way bill no.</span>
                <input type="text" className="ent-fc" maxLength={20} value={form.ewayBillNumber}
                  onChange={(e) => setForm((f) => ({ ...f, ewayBillNumber: e.target.value }))} />
                <span style={muted}>Needed above ~U+20B9~50,000 under Rule 138; intra-state limits vary by state.</span>
              </div>
            </div>

            {/* What kind of document this is, decided the moment both
                branches are picked. Said here rather than discovered after
                submitting, because it changes what the operator is doing:
                raising a tax invoice, not writing out a challan. */}
            {taxable && (
              <div className="ent-section" style={{ marginTop: 12, padding: "10px 14px", borderLeft: "3px solid #1d4ed8" }}>
                <p style={{ fontSize: 13, margin: 0 }}>
                  <strong>{from?.name}</strong> and <strong>{to?.name}</strong> have different GSTINs, so under
                  section 25(4) they are distinct persons and this is a <strong>taxable supply</strong>. A tax
                  invoice will be raised{fromSeries?.prefix ? <> from <code>{fromSeries.prefix}</code></> : null}
                  {" "}and {interState ? "IGST" : "CGST + SGST"} charged on the value of the goods at cost ~U+2014~ the
                  second proviso to Rule 28 deems that to be the open market value, because {to?.name} can claim it
                  all back as input tax credit.
                </p>
                <p style={{ ...muted, margin: "6px 0 0" }}>
                  Stock still moves at cost: the tax is a separate leg and never enters the value of the goods.
                </p>
              </div>
            )}

            {blockers.map((b, i) => (
              <div key={i} className="ent-section"
                style={{ marginTop: 8, padding: "10px 14px", borderLeft: "3px solid #b45309" }}>
                <p style={{ fontSize: 13, margin: 0 }}>{b}</p>
              </div>
            ))}

            <table style={{ width: "100%", marginTop: 12 }}>
              <thead>
                <tr><th>Item</th><th style={{ width: 180 }}>Quantity</th><th style={{ width: 70 }} /></tr>
              </thead>
              <tbody>
                {draft.map((d, i) => (
                  <tr key={d.key}>
                    <td>
                      <select className="ent-fc" value={d.itemId}
                        onChange={(e) => setDraft((r) => r.map((x, j) => j === i ? { ...x, itemId: e.target.value } : x))}>
                        <option value="">Pick an item~U+2026~</option>
                        {items.map((it) => <option key={it.id} value={it.id}>{it.sku} ~U+2014~ {it.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <input type="number" min={0} step="0.0001" className="ent-fc" value={d.quantity}
                        onChange={(e) => setDraft((r) => r.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button className="ent-ia ent-ia-del" onClick={() => setDraft((r) => r.filter((_, j) => j !== i))}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="ent-ia ent-ia-edit"
                onClick={() => setDraft((d) => [...d, { key: nextKey(), itemId: "", quantity: "" }])}>
                Add item
              </button>
              <div style={{ flex: 1 }} />
              <button className="ent-btn-add" disabled={busy || blockers.length > 0}
                onClick={() => run(async () => {
                  const lines = draft
                    .filter((d) => d.itemId && Number(d.quantity) > 0)
                    .map((d) => ({ itemId: d.itemId, quantity: Number(d.quantity) }));
                  if (lines.length === 0) throw new ApiError("Add at least one item with a quantity.", 400);
                  const r = await createStockTransfer({
                    fromBranchId: form.fromBranchId, toBranchId: form.toBranchId,
                    transferDate: form.transferDate,
                    documentNumber: form.documentNumber.trim() || undefined,
                    ewayBillNumber: form.ewayBillNumber.trim() || undefined,
                    lines,
                  });
                  setCreating(false);
                  return r.data.taxTreatment === "TAXABLE"
                    ? `${r.data.transferNumber} dispatched on tax invoice ${r.data.documentNumber} ~U+2014~ `
                      + `${money(r.data.total)} of goods plus ${money(r.data.taxTotal)} tax.`
                    : `${r.data.transferNumber} dispatched ~U+2014~ ${money(r.data.total)} into stock in transit.`;
                })}>
                {busy ? "Dispatching~U+2026~" : "Dispatch"}
              </button>
              <button className="ent-btn-cancel" onClick={() => { setCreating(false); setError(null); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="ent-page-table">
        <table>
          <thead>
            <tr>
              <th style={{ width: 110 }}>Transfer</th>
              <th style={{ width: 110 }}>Dispatched</th>
              <th>Route</th>
              <th style={{ width: 90, ...num }}>Items</th>
              <th style={{ width: 140, ...num }}>Value</th>
              <th style={{ width: 120 }}>Status</th>
              <th style={{ width: 80 }} />
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="ent-empty">Loading~U+2026~</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={7} className="ent-empty">No transfers.</td></tr>}
            {!loading && rows.map((t) => (
              // Fragment carries the key, not the rows inside it ~U+2014~ a row and
              // its expanded detail are two <tr> for one transfer.
              <Fragment key={t.id}>
                <tr>
                  <td style={{ fontWeight: 500 }}>{t.transferNumber}</td>
                  <td>{t.transferDate}</td>
                  <td>
                    {t.fromBranch.name} ~U+2192~ {t.toBranch.name}
                    {/* A challan and a tax invoice are different documents;
                        calling both "challan" would be wrong on the one that
                        carries GST. */}
                    {t.documentNumber && (
                      <div style={muted}>
                        {t.taxTreatment === "TAXABLE" ? "Tax invoice" : "Challan"} {t.documentNumber}
                      </div>
                    )}
                    {t.receivedDate && <div style={muted}>Received {t.receivedDate}</div>}
                  </td>
                  <td style={num}>{t.lineCount}</td>
                  <td style={num}>
                    {money(t.totalValue)}
                    {t.taxTotal > 0 && <div style={muted}>+ {money(t.taxTotal)} tax</div>}
                  </td>
                  <td><span className={STATUS_BADGE[t.status] ?? "badge badge-gray"}>{STATUS_LABEL[t.status] ?? t.status}</span></td>
                  <td style={{ textAlign: "right" }}>
                    <button className="ent-ia ent-ia-edit" onClick={() => toggleRow(t.id)}>
                      {expanded === t.id ? "Hide" : "Open"}
                    </button>
                  </td>
                </tr>
                {expanded === t.id && (
                  <tr>
                    <td colSpan={7} style={{ background: "#fafcff" }}>
                      {!detail && <p style={muted}>Loading~U+2026~</p>}
                      {detail && (
                        <div style={{ padding: "4px 0 8px" }}>
                          {detail.taxTreatment === "TAXABLE" && (
                            <p style={{ ...muted, marginTop: 0 }}>
                              Tax invoice <strong>{detail.documentNumber}</strong> ~U+2014~ {detail.fromBranch.gstin} to{" "}
                              {detail.toBranch.gstin}. Valued under{" "}
                              {VALUATION_BASIS_LABEL[detail.lines[0]?.valuationBasis ?? "SECOND_PROVISO"]}.
                            </p>
                          )}
                          <table style={{ width: "100%" }}>
                            <thead>
                              <tr>
                                <th>Item</th>
                                <th style={{ width: 120, ...num }}>Quantity</th>
                                <th style={{ width: 110, ...num }}>Cost each</th>
                                <th style={{ width: 120, ...num }}>Value</th>
                                {detail.taxTreatment === "TAXABLE" && <>
                                  <th style={{ width: 90, ...num }}>HSN</th>
                                  <th style={{ width: 70, ...num }}>Rate</th>
                                  <th style={{ width: 120, ...num }}>Tax</th>
                                </>}
                              </tr>
                            </thead>
                            <tbody>
                              {detail.lines.map((l) => (
                                <tr key={l.id}>
                                  <td>{l.item.sku} ~U+2014~ {l.item.name}</td>
                                  <td style={num}>{l.quantity} {l.item.uom}</td>
                                  <td style={num}>{money(l.unitCost)}</td>
                                  <td style={num}>{money(l.lineValue)}</td>
                                  {detail.taxTreatment === "TAXABLE" && <>
                                    <td style={num}>{l.item.hsnCode ?? "~U+2014~"}</td>
                                    <td style={num}>{l.gstRate ?? 0}%</td>
                                    <td style={num}>
                                      {money((l.cgst ?? 0) + (l.sgst ?? 0) + (l.igst ?? 0))}
                                      {/* Which heads, not just how much ~U+2014~ a
                                          wrong split is a filing error even
                                          when the total is right. */}
                                      <div style={muted}>
                                        {(l.igst ?? 0) > 0 ? "IGST" : (l.cgst ?? 0) > 0 ? "CGST+SGST" : "nil"}
                                      </div>
                                    </td>
                                  </>}
                                </tr>
                              ))}
                            </tbody>
                            {detail.taxTreatment === "TAXABLE" && (
                              <tfoot>
                                <tr>
                                  <td colSpan={3} style={{ textAlign: "right", fontWeight: 500 }}>
                                    Invoice total (goods at cost + tax)
                                  </td>
                                  <td style={num}>{money(detail.totalValue)}</td>
                                  <td colSpan={2} />
                                  <td style={{ ...num, fontWeight: 500 }}>{money(detail.invoiceTotal)}</td>
                                </tr>
                              </tfoot>
                            )}
                          </table>
                          {canPost && detail.status === "DISPATCHED" && (
                            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                              <button className="ent-btn-add" disabled={busy}
                                onClick={() => run(async () => {
                                  const r = await receiveStockTransfer(detail.id, today());
                                  return r.data.taxTotal > 0
                                    ? `${detail.transferNumber} received at ${detail.toBranch.name} ~U+2014~ `
                                      + `${money(r.data.total)} of goods and ${money(r.data.taxTotal)} input tax credit.`
                                    : `${detail.transferNumber} received at ${detail.toBranch.name} ~U+2014~ ${money(r.data.total)}.`;
                                })}>
                                Receive at {detail.toBranch.name}
                              </button>
                              <button className="ent-ia ent-ia-del" disabled={busy}
                                onClick={() => {
                                  // The credit-note point goes in the
                                  // confirmation, not the result: it changes
                                  // whether someone should press the button,
                                  // and telling them afterwards is too late.
                                  const taxWarning = detail.taxTreatment === "TAXABLE" && detail.documentNumber
                                    ? `\n\nTax invoice ${detail.documentNumber} has already been issued. The output tax `
                                      + "is reversed in the ledger, but under section 34 an issued invoice is undone by a "
                                      + "CREDIT NOTE, which this does not raise. You will have to account for that in the return."
                                    : "";
                                  if (!window.confirm(
                                    `Cancel ${detail.transferNumber}?\n\nThe goods return to ${detail.fromBranch.name} `
                                    + "and a reversing entry is posted. Only possible while they are still in transit."
                                    + taxWarning,
                                  )) return;
                                  void run(async () => {
                                    const r = await cancelStockTransfer(detail.id, today());
                                    return r.data.creditNoteNeeded
                                      ? `${detail.transferNumber} cancelled ~U+2014~ ${money(r.data.total)} returned to `
                                        + `${detail.fromBranch.name}. Raise a credit note for invoice ${detail.documentNumber}.`
                                      : `${detail.transferNumber} cancelled ~U+2014~ ${money(r.data.total)} returned to ${detail.fromBranch.name}.`;
                                  });
                                }}>
                                Cancel and return
                              </button>
                            </div>
                          )}
                          {detail.status === "RECEIVED" && (
                            <p style={{ ...muted, marginTop: 10 }}>
                              Received at {detail.toBranch.name} on {detail.receivedDate}. To move it back, raise a
                              transfer the other way ~U+2014~ cancelling now would take stock off a branch that is holding it.
                            </p>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
'@
Set-FileText 'frontend/app/inventory/stock-transfers/page.tsx' $f0
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green