"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { ApiError, generateRecurringExpenses, getRecurringExpensesDue } from "@/lib/api";
import type { RecurringDueRow } from "@/lib/types";

// Recurring Due — the review-and-post screen.
//
// This is the only thing in the app that turns a recurring expense template
// into a real payable, and it is deliberately manual: nothing posts on a
// schedule, nothing posts without someone looking at the amounts first. A
// FIXED template arrives with its figures filled in; a PROMPTED one arrives
// blank and can't be selected until an amount is typed.
//
// Rows that were already raised this month stay visible with a link to the
// bill instead of disappearing, so "did I miss one?" is answerable by
// looking rather than by reconciling.

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Rate overrides, keyed `${templateId}:${lineIndex}`, held as raw strings so
// a half-typed "12." doesn't get normalised out from under the cursor.
type Overrides = Record<string, string>;

export default function RecurringDuePage() {
  const [month, setMonth] = useState(currentMonth());
  const [rows, setRows] = useState<RecurringDueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [overrides, setOverrides] = useState<Overrides>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<{ created: number; failed: { name: string; message: string }[] } | null>(null);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getRecurringExpensesDue(m);
      setRows(res.data);
      // Changing month invalidates every selection and typed amount — they
      // belonged to the period that was on screen.
      setSelected({});
      setOverrides({});
      setExpanded({});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load what's due.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(month); }, [month, load]);

  // Effective rate for a line: the typed override if there is one, else
  // whatever the template carries.
  const rateOf = useCallback((row: RecurringDueRow, index: number): number | null => {
    const raw = overrides[`${row.id}:${index}`];
    if (raw !== undefined) {
      if (raw.trim() === "") return null;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : null;
    }
    return row.lines[index]?.rate ?? null;
  }, [overrides]);

  // Recomputed client-side so the figure moves as you type. The server
  // recomputes it from the same inputs when posting — this is a preview,
  // never the source of truth.
  const totalOf = useCallback((row: RecurringDueRow): number | null => {
    let total = 0;
    for (let i = 0; i < row.lines.length; i++) {
      const rate = rateOf(row, i);
      if (rate === null) return null;
      const line = row.lines[i];
      const sub = round2(line.quantity * rate);
      total += sub + round2((sub * line.taxRate) / 100);
    }
    return round2(total);
  }, [rateOf]);

  const pending = useMemo(() => rows.filter((r) => !r.alreadyRaised), [rows]);
  const raised = useMemo(() => rows.filter((r) => r.alreadyRaised), [rows]);

  const selectable = useMemo(
    () => pending.filter((r) => totalOf(r) !== null),
    [pending, totalOf],
  );

  const chosen = useMemo(
    () => selectable.filter((r) => selected[r.id]),
    [selectable, selected],
  );

  const chosenTotal = useMemo(
    () => round2(chosen.reduce((s, r) => s + (totalOf(r) ?? 0), 0)),
    [chosen, totalOf],
  );

  const allSelected = selectable.length > 0 && chosen.length === selectable.length;

  function toggleAll() {
    if (allSelected) return setSelected({});
    const next: Record<string, boolean> = {};
    for (const r of selectable) next[r.id] = true;
    setSelected(next);
  }

  async function handlePost() {
    if (chosen.length === 0) return;
    const label = chosen.length === 1
      ? `Raise a Purchase Bill for ${chosen[0].name}?`
      : `Raise ${chosen.length} Purchase Bills totalling ${money(chosenTotal)}?`;
    if (!window.confirm(`${label}\n\nThis posts to the ledger and cannot be undone from this screen.`)) return;

    setPosting(true);
    setError(null);
    setResult(null);
    try {
      const res = await generateRecurringExpenses({
        month,
        items: chosen.map((r) => ({
          recurringExpenseId: r.id,
          // Only sent for PROMPTED templates — a FIXED one must post the
          // amount it was configured with, not whatever happened to be on
          // screen.
          lines: r.amountMode === "PROMPTED"
            ? r.lines.map((l, i) => ({
                itemId: l.itemId,
                quantity: l.quantity,
                rate: rateOf(r, i),
                taxRate: l.taxRate,
              }))
            : undefined,
        })),
      });
      const nameById = new Map(rows.map((r) => [r.id, r.name]));
      setResult({
        created: res.data.created.length,
        failed: res.data.failed.map((f) => ({
          name: nameById.get(f.recurringExpenseId) ?? "Unknown",
          message: f.message,
        })),
      });
      await load(month);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not raise the bills.");
    } finally {
      setPosting(false);
    }
  }

  const muted = { color: "var(--color-muted)", fontSize: 12 } as const;

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Recurring Due</h1>
        <p>Recurring expenses scheduled for the selected month. Check the amounts, then raise them as Purchase Bills.</p>
      </div>

      <div className="ent-toolbar">
        <label className="ent-fl" style={{ margin: 0 }}>Month</label>
        <input
          type="month"
          className="ent-fc"
          style={{ width: 170, height: 34 }}
          value={month}
          onChange={(e) => setMonth(e.target.value || currentMonth())}
        />
        <span style={muted}>
          {loading ? "Loading…" : `${pending.length} to raise · ${raised.length} already raised`}
        </span>
        <div style={{ flex: 1 }} />
        {chosen.length > 0 && (
          <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
            {chosen.length} selected · <strong>{money(chosenTotal)}</strong>
          </span>
        )}
        <button
          className="ent-btn-save"
          disabled={chosen.length === 0 || posting}
          onClick={handlePost}
        >
          {posting ? "Posting…" : "Post Selected"}
        </button>
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {result && (
        <div className="ent-section" style={{ marginBottom: 16, padding: 14 }}>
          <p style={{ fontSize: 13, margin: 0 }}>
            {result.created > 0
              ? <>Raised <strong>{result.created}</strong> Purchase Bill{result.created === 1 ? "" : "s"}. </>
              : <>Nothing was raised. </>}
            {result.created > 0 && (
              <Link href="/purchase/bills" className="ent-ia ent-ia-edit" style={{ padding: 0 }}>View bills</Link>
            )}
          </p>
          {result.failed.length > 0 && (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13, color: "#dc2626" }}>
              {result.failed.map((f, i) => <li key={i}><strong>{f.name}</strong> — {f.message}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="ent-page-table">
        <table>
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  disabled={selectable.length === 0}
                  onChange={toggleAll}
                  aria-label="Select all"
                />
              </th>
              <th>Name</th>
              <th>Vendor</th>
              <th style={{ width: 110 }}>Bill Date</th>
              <th style={{ width: 100 }}>Amount</th>
              <th style={{ width: 150, textAlign: "right" }}>Total</th>
              <th style={{ width: 130 }} />
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="ent-empty">Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="ent-empty">Nothing is scheduled for this month.</td></tr>
            )}

            {!loading && rows.map((row) => {
              const total = totalOf(row);
              const done = row.alreadyRaised;
              const needsAmount = !done && total === null;
              const open = !!expanded[row.id];
              return (
                <Fragment key={row.id}>
                  <tr style={done ? { opacity: 0.65 } : undefined}>
                    <td>
                      {done ? <span style={muted}>✓</span> : (
                        <input
                          type="checkbox"
                          checked={!!selected[row.id]}
                          disabled={needsAmount}
                          onChange={(e) => setSelected((s) => ({ ...s, [row.id]: e.target.checked }))}
                          aria-label={`Select ${row.name}`}
                        />
                      )}
                    </td>
                    <td style={{ fontWeight: 500 }}>
                      <Link href={`/settings/recurring-expenses/${row.id}`} style={{ color: "inherit", textDecoration: "none" }}>
                        {row.name}
                      </Link>
                      {row.narration && <div style={muted}>{row.narration}</div>}
                    </td>
                    <td style={{ color: "var(--color-muted)" }}>
                      {row.businessPartner.code ? `${row.businessPartner.code} · ` : ""}{row.businessPartner.name}
                    </td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{row.billDate}</td>
                    <td>
                      <span className={row.amountMode === "FIXED" ? "badge badge-gray" : "badge badge-green"}>
                        {row.amountMode === "FIXED" ? "Fixed" : "Prompted"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {done
                        ? money(Number(done.grandTotal))
                        : total === null
                          ? <span style={{ ...muted, color: "#b45309" }}>Enter amount</span>
                          : money(total)}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {done ? (
                        // The bills screen has no per-bill route — it lists
                        // and expands inline — so this points at the list
                        // and the number identifies which row to look for.
                        <Link href="/purchase/bills" className="ent-ia ent-ia-edit">
                          {done.billNumber}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="ent-ia ent-ia-edit"
                          onClick={() => setExpanded((x) => ({ ...x, [row.id]: !open }))}
                        >
                          {open ? "Hide lines" : "Lines"}
                        </button>
                      )}
                    </td>
                  </tr>

                  {open && !done && (
                    <tr>
                      <td />
                      <td colSpan={6} style={{ padding: "0 0 10px" }}>
                        <table style={{ width: "100%" }}>
                          <thead>
                            <tr>
                              <th style={{ width: "40%" }}>Service Item</th>
                              <th style={{ width: 90 }}>Qty</th>
                              <th style={{ width: 150 }}>Rate</th>
                              <th style={{ width: 80 }}>Tax %</th>
                              <th style={{ textAlign: "right" }}>Line Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {row.lines.map((line, i) => {
                              const rate = rateOf(row, i);
                              const sub = rate === null ? null : round2(line.quantity * rate);
                              const lineTotal = sub === null ? null : round2(sub + (sub * line.taxRate) / 100);
                              const key = `${row.id}:${i}`;
                              return (
                                <tr key={key}>
                                  <td>
                                    {line.item ? `${line.item.sku} — ${line.item.name}` : <span style={muted}>Item missing</span>}
                                  </td>
                                  <td style={{ fontVariantNumeric: "tabular-nums" }}>
                                    {line.quantity}{line.item?.uom ? ` ${line.item.uom}` : ""}
                                  </td>
                                  <td>
                                    {row.amountMode === "PROMPTED" ? (
                                      <input
                                        type="number" min="0" step="0.01" className="ent-fc"
                                        placeholder="Amount"
                                        value={overrides[key] ?? (line.rate === null ? "" : String(line.rate))}
                                        onChange={(e) => setOverrides((o) => ({ ...o, [key]: e.target.value }))}
                                      />
                                    ) : (
                                      <span style={{ fontVariantNumeric: "tabular-nums" }}>
                                        {line.rate === null ? "—" : money(line.rate)}
                                      </span>
                                    )}
                                  </td>
                                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{line.taxRate}</td>
                                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                                    {lineTotal === null ? "—" : money(lineTotal)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {row.amountMode === "PROMPTED" && (
                          <p style={{ ...muted, margin: "6px 0 0" }}>
                            Quantity and tax rate come from the template — only the amount can be changed here.
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
