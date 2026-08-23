"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import {
  ApiError, addProductionCost, cancelProductionOrder, closeProductionOrder,
  getExpenseAccounts, getProductionOrder, issueProductionMaterial, receiveProductionOutput,
} from "@/lib/api";
import { canPostTransactions } from "@/lib/auth";
import type { Account, ProductionOrderDetail } from "@/lib/types";

// A production order, and the four things that can be posted against it.
//
// The number the whole screen exists to produce is the finished good's unit
// cost, and it is never typed: it is the work-in-progress absorbed divided by
// the quantity received. Everything above it — what the material actually
// cost when it left stock, what conversion cost was added — feeds that one
// figure.

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const ENTRY_LABEL: Record<string, string> = {
  ISSUE: "Material issued",
  COST: "Conversion cost",
  RECEIPT: "Output received",
  WRITEOFF: "Written off",
};

type Panel = "none" | "issue" | "cost" | "receive";

interface IssueDraft { key: string; itemId: string; quantity: string }
interface CostDraft { key: string; accountId: string; amount: string }

let seq = 0;
const nextKey = () => `r${++seq}`;

export default function ProductionOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const canPost = canPostTransactions();

  const [order, setOrder] = useState<ProductionOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [panel, setPanel] = useState<Panel>("none");
  const [entryDate, setEntryDate] = useState(today());
  const [issueDraft, setIssueDraft] = useState<IssueDraft[]>([]);
  const [costDraft, setCostDraft] = useState<CostDraft[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<Account[]>([]);
  const [receiveQty, setReceiveQty] = useState("");
  const [receiveFinal, setReceiveFinal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getProductionOrder(id);
      setOrder(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this order.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  function openIssue() {
    if (!order) return;
    // Prefilled from the bill of materials exploded for the planned quantity.
    // A suggestion — the quantities are corrected against what was actually
    // taken to the shop floor before anything posts.
    setIssueDraft(order.suggestedIssue.map((s) => ({
      key: nextKey(), itemId: s.itemId, quantity: String(s.quantity),
    })));
    setEntryDate(today());
    setPanel("issue");
    setError(null);
  }

  async function openCost() {
    setEntryDate(today());
    setCostDraft([{ key: nextKey(), accountId: "", amount: "" }]);
    setPanel("cost");
    setError(null);
    try {
      const res = await getExpenseAccounts();
      setExpenseAccounts(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the expense accounts.");
    }
  }

  function openReceive() {
    if (!order) return;
    const outstanding = Math.max(order.plannedQuantity - order.receivedQuantity, 0);
    setReceiveQty(outstanding > 0 ? String(outstanding) : "");
    setReceiveFinal(false);
    setEntryDate(today());
    setPanel("receive");
    setError(null);
  }

  async function run(fn: () => Promise<string>) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const msg = await fn();
      setNotice(msg);
      setPanel("none");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not post. Nothing was written.");
    } finally {
      setBusy(false);
    }
  }

  const muted = { color: "var(--color-muted)", fontSize: 12 } as const;
  const num = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

  if (loading) return <AppShell><p style={muted}>Loading…</p></AppShell>;
  if (!order) return <AppShell><p style={{ color: "#dc2626" }}>{error ?? "Not found."}</p></AppShell>;

  const isOpen = order.status === "OPEN";
  const outstanding = Math.max(order.plannedQuantity - order.receivedQuantity, 0);

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>{order.orderNumber}</h1>
        <p>
          {order.plannedQuantity} {order.finishedItem.uom} of {order.finishedItem.sku} — {order.finishedItem.name}
          {order.branch ? ` · ${order.branch.name}` : ""} · opened {order.orderDate}
        </p>
      </div>

      <div className="ent-toolbar">
        <span className={order.status === "OPEN" ? "badge badge-yellow" : order.status === "COMPLETED" ? "badge badge-green" : "badge badge-gray"}>
          {order.status === "OPEN" ? "Open" : order.status === "COMPLETED" ? "Completed" : "Cancelled"}
        </span>
        <Link href="/manufacturing/production-orders" className="ent-ia ent-ia-edit">All orders →</Link>
        <div style={{ flex: 1 }} />
        {canPost && isOpen && (
          <>
            <button className="ent-btn-add" disabled={busy} onClick={openIssue}>Issue Material</button>
            <button className="ent-btn-add" disabled={busy} onClick={openCost}>Add Cost</button>
            <button className="ent-btn-add" disabled={busy} onClick={openReceive}>Receive Output</button>
            <button className="ent-btn-cancel" disabled={busy}
              onClick={() => run(async () => {
                const r = await closeProductionOrder(order.id);
                return `${order.orderNumber} closed — ${r.data.receivedQuantity} made.`;
              })}>
              Close
            </button>
            <button className="ent-ia ent-ia-del" disabled={busy}
              onClick={() => {
                if (!window.confirm(
                  `Cancel ${order.orderNumber}?\n\n`
                  + (order.wipBalance > 0
                    ? `${money(order.wipBalance)} of work in progress will be written off to 4003 Abnormal Production Loss. `
                    : "")
                  + "Material already issued is not returned to stock.",
                )) return;
                void run(async () => {
                  const r = await cancelProductionOrder(order.id);
                  return r.data.writtenOff > 0
                    ? `${order.orderNumber} cancelled — ${money(r.data.writtenOff)} written off.`
                    : `${order.orderNumber} cancelled.`;
                });
              }}>
              Cancel Order
            </button>
          </>
        )}
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

      {/* The position. Every figure is summed from the postings below — none
          of it is stored, so it cannot drift from the ledger. */}
      <div className="ent-section" style={{ marginBottom: 16 }}>
        <div className="ent-section-hdr"><span className="ent-section-title">Where this order stands</span></div>
        <div style={{ padding: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
          <div><span style={muted}>Material issued</span><div style={{ fontVariantNumeric: "tabular-nums" }}>{money(order.issued)}</div></div>
          <div><span style={muted}>Conversion cost</span><div style={{ fontVariantNumeric: "tabular-nums" }}>{money(order.costed)}</div></div>
          <div><span style={muted}>Absorbed by output</span><div style={{ fontVariantNumeric: "tabular-nums" }}>({money(order.absorbed)})</div></div>
          {order.writtenOff > 0 && (
            <div><span style={muted}>Written off</span><div style={{ fontVariantNumeric: "tabular-nums", color: "#b45309" }}>({money(order.writtenOff)})</div></div>
          )}
          <div>
            <span style={muted}>Work in progress</span>
            <div style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{money(order.wipBalance)}</div>
          </div>
          <div>
            <span style={muted}>Received</span>
            <div style={{ fontVariantNumeric: "tabular-nums" }}>{order.receivedQuantity} of {order.plannedQuantity} {order.finishedItem.uom}</div>
          </div>
          <div>
            <span style={muted}>Unit cost so far</span>
            <div style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
              {order.unitCostSoFar === null ? "—" : money(order.unitCostSoFar)}
            </div>
          </div>
        </div>
      </div>

      {panel === "issue" && (
        <div className="ent-section" style={{ marginBottom: 16 }}>
          <div className="ent-section-hdr"><span className="ent-section-title">Issue material</span></div>
          <div style={{ padding: 14 }}>
            <p style={{ ...muted, marginTop: 0 }}>
              Prefilled from the bill of materials for {order.plannedQuantity} {order.finishedItem.uom}. Correct the
              quantities against what actually went to the floor. The cost is whatever the stock is worth today —
              it is not entered here and cannot be.
            </p>
            <div className="ent-fg" style={{ maxWidth: 220 }}>
              <span className="ent-fl">Date</span>
              <input type="date" className="ent-fc" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
            </div>
            <table style={{ width: "100%", marginTop: 10 }}>
              <thead>
                <tr><th>Component</th><th style={{ width: 180 }}>Quantity</th><th style={{ width: 70 }} /></tr>
              </thead>
              <tbody>
                {issueDraft.map((d, i) => {
                  const s = order.suggestedIssue.find((x) => x.itemId === d.itemId);
                  return (
                    <tr key={d.key}>
                      <td>
                        <select className="ent-fc" value={d.itemId}
                          onChange={(e) => setIssueDraft((r) => r.map((x, j) => j === i ? { ...x, itemId: e.target.value } : x))}>
                          <option value="">Pick a component…</option>
                          {order.suggestedIssue.map((x) => (
                            <option key={x.itemId} value={x.itemId}>{x.sku} — {x.name}</option>
                          ))}
                        </select>
                        {s && <div style={muted}>{s.qtyPerUnit} {s.uom} per unit</div>}
                      </td>
                      <td>
                        <input type="number" min={0} step="0.0001" className="ent-fc" value={d.quantity}
                          onChange={(e) => setIssueDraft((r) => r.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} />
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button className="ent-ia ent-ia-del" onClick={() => setIssueDraft((r) => r.filter((_, j) => j !== i))}>Remove</button>
                      </td>
                    </tr>
                  );
                })}
                {issueDraft.length === 0 && (
                  <tr><td colSpan={3} className="ent-empty">
                    Nothing to issue. {order.suggestedIssue.length === 0
                      ? "This item has no bill of materials — add one on the item master, or add lines by hand."
                      : "Add a line."}
                  </td></tr>
                )}
              </tbody>
            </table>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="ent-ia ent-ia-edit"
                onClick={() => setIssueDraft((d) => [...d, { key: nextKey(), itemId: "", quantity: "" }])}>
                Add line
              </button>
              <div style={{ flex: 1 }} />
              <button className="ent-btn-add" disabled={busy || issueDraft.length === 0}
                onClick={() => run(async () => {
                  const lines = issueDraft
                    .filter((d) => d.itemId && Number(d.quantity) > 0)
                    .map((d) => ({ itemId: d.itemId, quantity: Number(d.quantity) }));
                  if (lines.length === 0) throw new ApiError("Add at least one component with a quantity.", 400);
                  const r = await issueProductionMaterial(order.id, { entryDate, lines });
                  return `Issued ${lines.length} component${lines.length === 1 ? "" : "s"} — ${money(r.data.total)} into work in progress.`;
                })}>
                {busy ? "Posting…" : "Post the issue"}
              </button>
              <button className="ent-btn-cancel" onClick={() => setPanel("none")}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {panel === "cost" && (
        <div className="ent-section" style={{ marginBottom: 16 }}>
          <div className="ent-section-hdr"><span className="ent-section-title">Add conversion cost</span></div>
          <div style={{ padding: 14 }}>
            <p style={{ ...muted, marginTop: 0 }}>
              Direct labour, power, factory overhead. AS 2 requires cost of conversion to sit in inventory rather
              than the period, so this moves the amount out of the expense head and into work in progress — where
              the output will absorb it.
            </p>
            <div className="ent-fg" style={{ maxWidth: 220 }}>
              <span className="ent-fl">Date</span>
              <input type="date" className="ent-fc" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
            </div>
            <table style={{ width: "100%", marginTop: 10 }}>
              <thead>
                <tr><th>Expense account</th><th style={{ width: 180 }}>Amount</th><th style={{ width: 70 }} /></tr>
              </thead>
              <tbody>
                {costDraft.map((d, i) => (
                  <tr key={d.key}>
                    <td>
                      <select className="ent-fc" value={d.accountId}
                        onChange={(e) => setCostDraft((r) => r.map((x, j) => j === i ? { ...x, accountId: e.target.value } : x))}>
                        <option value="">Pick an account…</option>
                        {expenseAccounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.accountCode} — {a.accountName}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input type="number" min={0} step="0.01" className="ent-fc" value={d.amount}
                        onChange={(e) => setCostDraft((r) => r.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button className="ent-ia ent-ia-del" onClick={() => setCostDraft((r) => r.filter((_, j) => j !== i))}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="ent-ia ent-ia-edit"
                onClick={() => setCostDraft((d) => [...d, { key: nextKey(), accountId: "", amount: "" }])}>
                Add line
              </button>
              <div style={{ flex: 1 }} />
              <button className="ent-btn-add" disabled={busy}
                onClick={() => run(async () => {
                  const lines = costDraft
                    .filter((d) => d.accountId && Number(d.amount) > 0)
                    .map((d) => ({ accountId: d.accountId, amount: Number(d.amount) }));
                  if (lines.length === 0) throw new ApiError("Add at least one cost line.", 400);
                  const r = await addProductionCost(order.id, { entryDate, lines });
                  return `${money(r.data.total)} of conversion cost absorbed into work in progress.`;
                })}>
                {busy ? "Posting…" : "Post the cost"}
              </button>
              <button className="ent-btn-cancel" onClick={() => setPanel("none")}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {panel === "receive" && (
        <div className="ent-section" style={{ marginBottom: 16 }}>
          <div className="ent-section-hdr"><span className="ent-section-title">Receive output</span></div>
          <div style={{ padding: 14 }}>
            <p style={{ ...muted, marginTop: 0 }}>
              The unit cost is not entered. It is the work in progress absorbed divided by the quantity received —
              currently {money(order.wipBalance)} in the pool.
            </p>
            <div className="ent-form-grid">
              <div className="ent-fg">
                <span className="ent-fl">Date</span>
                <input type="date" className="ent-fc" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
              </div>
              <div className="ent-fg">
                <span className="ent-fl">Quantity</span>
                <input type="number" min={0} step="0.0001" className="ent-fc" value={receiveQty}
                  onChange={(e) => setReceiveQty(e.target.value)} />
                <span style={muted}>{outstanding > 0 ? `${outstanding} still expected` : "The planned quantity is already made"}</span>
              </div>
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12, fontSize: 13 }}>
              <input type="checkbox" checked={receiveFinal} onChange={(e) => setReceiveFinal(e.target.checked)} style={{ marginTop: 3 }} />
              <span>
                This is the last of it.
                <div style={muted}>
                  Absorbs the whole remaining {money(order.wipBalance)} into this receipt and closes the order. The
                  good units carry the cost of the units lost, which is the normal treatment for ordinary process
                  loss. Set automatically once the planned quantity has been made.
                </div>
              </span>
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button className="ent-btn-add" disabled={busy}
                onClick={() => run(async () => {
                  const q = Number(receiveQty);
                  if (!Number.isFinite(q) || q <= 0) throw new ApiError("Quantity received must be more than zero.", 400);
                  const r = await receiveProductionOutput(order.id, { entryDate, quantity: q, final: receiveFinal });
                  return `Received ${q} ${order.finishedItem.uom} at ${money(r.data.unitCost)} each — ${money(r.data.absorbed)} absorbed${r.data.completed ? ", order closed" : ""}.`;
                })}>
                {busy ? "Posting…" : "Post the receipt"}
              </button>
              <button className="ent-btn-cancel" onClick={() => setPanel("none")}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="ent-section">
        <div className="ent-section-hdr"><span className="ent-section-title">Postings</span></div>
        <table>
          <thead>
            <tr>
              <th style={{ width: 110 }}>Date</th>
              <th style={{ width: 150 }}>What</th>
              <th>Detail</th>
              <th style={{ width: 140, ...num }}>Value</th>
            </tr>
          </thead>
          <tbody>
            {order.entries.length === 0 && (
              <tr><td colSpan={4} className="ent-empty">Nothing posted yet. Issue the material to start.</td></tr>
            )}
            {order.entries.map((e) => (
              <tr key={e.id}>
                <td>{e.entryDate}</td>
                <td style={{ fontWeight: 500 }}>{ENTRY_LABEL[e.entryType] ?? e.entryType}</td>
                <td style={{ fontSize: 12.5 }}>
                  {e.lines.map((l) => (
                    <div key={l.id}>
                      {l.item
                        ? <>{l.item.sku} — {l.item.name} · {l.quantity} {l.item.uom}
                          {l.unitCost !== null && <> @ {money(l.unitCost)}</>}</>
                        : <>{l.account?.accountCode} — {l.account?.accountName}</>}
                      <span style={{ ...muted, marginLeft: 8 }}>{money(l.lineValue)}</span>
                    </div>
                  ))}
                  {e.narration && <div style={muted}>{e.narration}</div>}
                </td>
                <td style={{ ...num, fontWeight: 500 }}>
                  {e.entryType === "ISSUE" || e.entryType === "COST" ? money(e.totalValue) : `(${money(e.totalValue)})`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
