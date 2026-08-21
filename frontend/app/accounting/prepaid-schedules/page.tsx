"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { ApiError, getPrepaidSchedules } from "@/lib/api";
import type { PrepaidScheduleSummary } from "@/lib/types";

// Prepaid Schedules — the register. Read-only: a schedule is created by
// ticking "Spread over time" on a Purchase Bill line, and released on the
// Amortization Due screen. Nothing is edited here.
//
// The total of the Remaining column is what account 1105 should show. That is
// the number this page exists to make checkable at a glance.

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function monthLabel(v: string): string {
  const d = new Date(`${v}-01T00:00:00Z`);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
}

const STATUS_CLASS: Record<string, string> = {
  ACTIVE: "badge badge-green",
  COMPLETED: "badge badge-gray",
  CANCELLED: "badge badge-gray",
};

export default function PrepaidSchedulesPage() {
  const [rows, setRows] = useState<PrepaidScheduleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await getPrepaidSchedules();
        setRows(res.data);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load schedules.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showCompleted && r.status !== "ACTIVE") return false;
      if (!q) return true;
      return `${r.name} ${r.purchaseBill?.billNumber ?? ""} ${r.expenseAccount.accountName}`.toLowerCase().includes(q);
    });
  }, [rows, search, showCompleted]);

  const outstanding = useMemo(
    () => rows.filter((r) => r.status === "ACTIVE").reduce((s, r) => s + r.remaining, 0),
    [rows],
  );

  const muted = { color: "var(--color-muted)", fontSize: 12 } as const;

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Prepaid Schedules</h1>
        <p>Amounts sitting in Prepaid Expenses and the months they release over. Created from a Purchase Bill line, released on the Amortization Due screen.</p>
      </div>

      <div className="ent-toolbar">
        <input
          className="ent-fc"
          style={{ flex: "1 1 300px", maxWidth: 400, height: 34 }}
          placeholder="Search by name, bill or account…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label style={{ ...muted, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} />
          Show completed
        </label>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
          Outstanding: <strong>{money(outstanding)}</strong>
        </span>
        <Link href="/accounting/amortization-due" className="ent-btn-add" style={{ textDecoration: "none" }}>
          What&rsquo;s due →
        </Link>
      </div>

      <p style={{ ...muted, marginBottom: 12 }}>
        Outstanding is what account 1105 Prepaid Expenses should show. If the ledger disagrees, something
        was posted to that account outside a schedule.
      </p>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="ent-page-table">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Expense account</th>
              <th>Source</th>
              <th>Period</th>
              <th style={{ textAlign: "right" }}>Total</th>
              <th style={{ textAlign: "right" }}>Released</th>
              <th style={{ textAlign: "right" }}>Remaining</th>
              <th style={{ width: 90 }}>Progress</th>
              <th style={{ width: 100 }} />
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="ent-empty">Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={9} className="ent-empty">
                No prepaid schedules yet. Tick &ldquo;Spread over time&rdquo; on a service line when entering a Purchase Bill.
              </td></tr>
            )}
            {!loading && rows.length > 0 && visible.length === 0 && (
              <tr><td colSpan={9} className="ent-empty">Nothing matches.</td></tr>
            )}
            {visible.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 500 }}>
                  <Link href={`/accounting/prepaid-schedules/${r.id}`} style={{ color: "inherit", textDecoration: "none" }}>
                    {r.name}
                  </Link>
                </td>
                <td style={{ color: "var(--color-muted)" }}>
                  {r.expenseAccount.accountCode} — {r.expenseAccount.accountName}
                </td>
                <td style={{ color: "var(--color-muted)" }}>{r.purchaseBill?.billNumber ?? "—"}</td>
                <td style={{ color: "var(--color-muted)" }}>
                  {monthLabel(r.startMonth)} – {monthLabel(r.endMonth)}
                </td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(r.totalAmount)}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(r.released)}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{money(r.remaining)}</td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.instalmentsPosted} / {r.months}</td>
                <td style={{ textAlign: "right" }}>
                  <span className={STATUS_CLASS[r.status] ?? "badge badge-gray"}>
                    {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
