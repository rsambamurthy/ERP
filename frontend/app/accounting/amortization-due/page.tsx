"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { ApiError, getPrepaidDue, postPrepaidAmortization } from "@/lib/api";
import type { PrepaidDueRow } from "@/lib/types";

// Amortization Due — the release side of prepaid expenses.
//
// Without this screen a prepaid bill line is a one-way door: money enters
// Prepaid Expenses (1105) and never comes out, so the balance sheet carries
// an asset that should have become an expense months ago. This is the way
// out, and it is deliberately manual for the same reason Recurring Due is —
// nothing reaches the ledger without someone looking at it.

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

export default function AmortizationDuePage() {
  const [month, setMonth] = useState(currentMonth());
  const [rows, setRows] = useState<PrepaidDueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<{ posted: number; total: number; failed: { name: string; message: string }[] } | null>(null);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getPrepaidDue(m);
      setRows(res.data);
      // A selection belongs to the month it was made in.
      setSelected({});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load what's due.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(month); }, [month, load]);

  const pending = useMemo(() => rows.filter((r) => !r.alreadyPosted), [rows]);
  const done = useMemo(() => rows.filter((r) => r.alreadyPosted), [rows]);
  const chosen = useMemo(() => pending.filter((r) => selected[r.id]), [pending, selected]);
  const chosenTotal = useMemo(
    () => round2(chosen.reduce((s, r) => s + r.amount, 0)),
    [chosen],
  );
  const allSelected = pending.length > 0 && chosen.length === pending.length;

  // Worth surfacing at the top rather than only per row: a gap usually means
  // a month was skipped entirely, not that one schedule started late.
  const withGaps = useMemo(() => pending.filter((r) => r.missingBefore > 0).length, [pending]);

  function toggleAll() {
    if (allSelected) return setSelected({});
    const next: Record<string, boolean> = {};
    for (const r of pending) next[r.id] = true;
    setSelected(next);
  }

  async function handlePost() {
    if (chosen.length === 0) return;
    const label = chosen.length === 1
      ? `Post the amortization for ${chosen[0].name}?`
      : `Post ${chosen.length} amortization entries totalling ${money(chosenTotal)}?`;
    if (!window.confirm(`${label}\n\nThis writes to the ledger and cannot be undone from this screen.`)) return;

    setPosting(true);
    setError(null);
    setResult(null);
    try {
      const res = await postPrepaidAmortization({ month, scheduleIds: chosen.map((r) => r.id) });
      const nameById = new Map(rows.map((r) => [r.id, r.name]));
      setResult({
        posted: res.data.posted.length,
        total: round2(res.data.posted.reduce((s, p) => s + p.amount, 0)),
        failed: res.data.failed.map((f) => ({ name: nameById.get(f.id) ?? "Unknown", message: f.message })),
      });
      await load(month);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post the amortization.");
    } finally {
      setPosting(false);
    }
  }

  const muted = { color: "var(--color-muted)", fontSize: 12 } as const;

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Amortization Due</h1>
        <p>Prepaid expenses scheduled to be released this month. Each one posts a journal entry moving an instalment out of Prepaid Expenses into its expense head.</p>
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
          {loading ? "Loading…" : `${pending.length} to post · ${done.length} already posted`}
        </span>
        <Link href="/accounting/prepaid-schedules" className="ent-ia ent-ia-edit">All schedules →</Link>
        <div style={{ flex: 1 }} />
        {chosen.length > 0 && (
          <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
            {chosen.length} selected · <strong>{money(chosenTotal)}</strong>
          </span>
        )}
        <button className="ent-btn-save" disabled={chosen.length === 0 || posting} onClick={handlePost}>
          {posting ? "Posting…" : "Post Selected"}
        </button>
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {!loading && withGaps > 0 && (
        <div className="ent-section" style={{ marginBottom: 16, padding: "10px 14px", borderLeft: "3px solid #b45309" }}>
          <p style={{ fontSize: 13, margin: 0 }}>
            <strong>{withGaps}</strong> schedule{withGaps === 1 ? " has" : "s have"} earlier instalments that were never
            posted. Posting this month is still arithmetically correct — each instalment is independent — but those
            earlier months will stay unreleased until you go back and post them.
          </p>
        </div>
      )}

      {result && (
        <div className="ent-section" style={{ marginBottom: 16, padding: 14 }}>
          <p style={{ fontSize: 13, margin: 0 }}>
            {result.posted > 0
              ? <>Posted <strong>{result.posted}</strong> entr{result.posted === 1 ? "y" : "ies"} totalling <strong>{money(result.total)}</strong>. </>
              : <>Nothing was posted. </>}
            {result.posted > 0 && (
              <Link href="/accounting/journal" className="ent-ia ent-ia-edit" style={{ padding: 0 }}>View journal</Link>
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
                <input type="checkbox" checked={allSelected} disabled={pending.length === 0} onChange={toggleAll} aria-label="Select all" />
              </th>
              <th>Schedule</th>
              <th>Expense account</th>
              <th>Source</th>
              <th style={{ width: 90 }}>Instalment</th>
              <th style={{ width: 120, textAlign: "right" }}>This month</th>
              <th style={{ width: 130, textAlign: "right" }}>Remaining after</th>
              <th style={{ width: 110 }} />
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="ent-empty">Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className="ent-empty">Nothing is scheduled for this month.</td></tr>
            )}
            {!loading && rows.map((row) => {
              const posted = row.alreadyPosted;
              const remainingAfter = posted
                ? round2(row.totalAmount - row.released)
                : round2(row.remaining - row.amount);
              return (
                <tr key={row.id} style={posted ? { opacity: 0.65 } : undefined}>
                  <td>
                    {posted ? <span style={muted}>✓</span> : (
                      <input
                        type="checkbox"
                        checked={!!selected[row.id]}
                        onChange={(e) => setSelected((s) => ({ ...s, [row.id]: e.target.checked }))}
                        aria-label={`Select ${row.name}`}
                      />
                    )}
                  </td>
                  <td style={{ fontWeight: 500 }}>
                    <Link href={`/accounting/prepaid-schedules/${row.id}`} style={{ color: "inherit", textDecoration: "none" }}>
                      {row.name}
                    </Link>
                    {row.missingBefore > 0 && (
                      <div style={{ ...muted, color: "#b45309" }}>
                        {row.missingBefore} earlier instalment{row.missingBefore === 1 ? "" : "s"} not posted
                      </div>
                    )}
                  </td>
                  <td style={{ color: "var(--color-muted)" }}>
                    {row.expenseAccount.accountCode} — {row.expenseAccount.accountName}
                  </td>
                  <td style={{ color: "var(--color-muted)" }}>{row.purchaseBill?.billNumber ?? "—"}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{row.instalmentNo} of {row.months}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {money(posted ? posted.amount : row.amount)}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--color-muted)" }}>
                    {money(remainingAfter)}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {posted
                      ? <span className="badge badge-green">Posted</span>
                      : <Link href={`/accounting/prepaid-schedules/${row.id}`} className="ent-ia ent-ia-edit">View</Link>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
