"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { ApiError, getPrepaidSchedule } from "@/lib/api";
import type { PrepaidScheduleDetail } from "@/lib/types";

// One schedule, month by month. The instalment table is derived rather than
// stored: the runs table records what actually posted, and this shows what is
// meant to post, so a gap between the two is visible instead of implied.

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function monthLabel(v: string): string {
  const d = new Date(`${v}-01T00:00:00Z`);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
}

export default function PrepaidScheduleDetailPage() {
  const params = useParams<{ id: string }>();
  const [s, setS] = useState<PrepaidScheduleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    (async () => {
      try {
        const res = await getPrepaidSchedule(params.id);
        setS(res.data);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load the schedule.");
      } finally {
        setLoading(false);
      }
    })();
  }, [params?.id]);

  const muted = { color: "var(--color-muted)", fontSize: 12 } as const;

  if (loading) {
    return <AppShell><div className="ent-page-hdr"><h1>Prepaid Schedule</h1></div><p style={muted}>Loading…</p></AppShell>;
  }
  if (error || !s) {
    return (
      <AppShell>
        <div className="ent-page-hdr"><h1>Prepaid Schedule</h1></div>
        <p style={{ color: "#dc2626", fontSize: 13 }}>{error ?? "Not found."}</p>
        <Link href="/accounting/prepaid-schedules" className="ent-ia ent-ia-edit">← All schedules</Link>
      </AppShell>
    );
  }

  const pct = s.totalAmount > 0 ? Math.round((s.released / s.totalAmount) * 100) : 0;

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>{s.name}</h1>
        <p>
          <Link href="/accounting/prepaid-schedules" className="ent-ia ent-ia-edit" style={{ padding: 0 }}>← All schedules</Link>
          {s.purchaseBill && <> · from bill <strong>{s.purchaseBill.billNumber}</strong> dated {s.purchaseBill.billDate}</>}
        </p>
      </div>

      <div className="ent-section" style={{ marginBottom: 16 }}>
        <div className="ent-section-hdr" style={{ borderRadius: "6px 6px 0 0" }}>
          <span className="ent-section-title">Summary</span>
          <span className={s.status === "ACTIVE" ? "badge badge-green" : "badge badge-gray"}>
            {s.status.charAt(0) + s.status.slice(1).toLowerCase()}
          </span>
        </div>
        <div className="ent-form-grid" style={{ padding: 14 }}>
          <div className="ent-fg">
            <span className="ent-fl">Total</span>
            <div style={{ fontSize: 18, fontVariantNumeric: "tabular-nums" }}>{money(s.totalAmount)}</div>
            <span style={muted}>net of GST — the tax was claimed in full on the bill</span>
          </div>
          <div className="ent-fg">
            <span className="ent-fl">Released</span>
            <div style={{ fontSize: 18, fontVariantNumeric: "tabular-nums" }}>{money(s.released)}</div>
            <span style={muted}>{pct}% · {s.instalments.filter((i) => i.postedAt).length} of {s.months} instalments</span>
          </div>
          <div className="ent-fg">
            <span className="ent-fl">Remaining in 1105</span>
            <div style={{ fontSize: 18, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{money(s.remaining)}</div>
            <span style={muted}>this schedule&rsquo;s card balance</span>
          </div>
          <div className="ent-fg">
            <span className="ent-fl">Paid to</span>
            <div style={{ fontSize: 15 }}>{s.vendor ? s.vendor.name : "—"}</div>
            <span style={muted}>
              {s.vendor
                ? "from the originating bill — an amortization entry itself has no counterparty"
                : "no bill behind this schedule"}
            </span>
          </div>
          <div className="ent-fg">
            <span className="ent-fl">Period</span>
            <div style={{ fontSize: 15 }}>{monthLabel(s.startMonth)} – {monthLabel(s.endMonth)}</div>
            <span style={muted}>{s.months} monthly instalments</span>
          </div>
          <div className="ent-fg">
            <span className="ent-fl">Releases into</span>
            <div style={{ fontSize: 15 }}>{s.expenseAccount.accountCode} — {s.expenseAccount.accountName}</div>
            <span style={muted}>pinned when the bill posted, not read from the item now</span>
          </div>
          <div className="ent-fg">
            <span className="ent-fl">Held in</span>
            <div style={{ fontSize: 15 }}>{s.prepaidAccount.accountCode} — {s.prepaidAccount.accountName}</div>
            <span style={muted}>sub-ledger card: {s.businessPartner.name}</span>
          </div>
        </div>
      </div>

      <div className="ent-page-table">
        <table>
          <thead>
            <tr>
              <th style={{ width: 50 }}>#</th>
              <th>Month</th>
              <th style={{ textAlign: "right" }}>Amount</th>
              <th style={{ textAlign: "right" }}>Cumulative</th>
              <th style={{ textAlign: "right" }}>Balance</th>
              <th style={{ width: 150 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {s.instalments.map((i) => {
              // A posted amount that differs from the derived one would mean the
              // schedule changed after the fact. It cannot happen today, but
              // showing the posted figure rather than the expected one means the
              // table never quietly misreports history.
              const drift = i.postedAmount !== null && Math.abs(i.postedAmount - i.amount) > 0.004;
              return (
                <tr key={i.instalmentNo} style={i.postedAt ? undefined : { background: "#fcfdff" }}>
                  <td style={{ color: "var(--color-muted)", fontVariantNumeric: "tabular-nums" }}>{i.instalmentNo}</td>
                  <td style={{ fontWeight: i.postedAt ? 400 : 500 }}>{monthLabel(i.month)}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {money(i.postedAmount ?? i.amount)}
                    {drift && <div style={{ ...muted, color: "#b45309" }}>expected {money(i.amount)}</div>}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--color-muted)" }}>{money(i.cumulative)}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--color-muted)" }}>{money(i.balance)}</td>
                  <td>
                    {i.postedAt
                      ? <span className="badge badge-gray">Posted {new Date(i.postedAt).toLocaleDateString()}</span>
                      : <span style={muted}>Not posted</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ ...muted, marginTop: 12 }}>
        The final instalment is the balancing figure — whatever brings the total released to exactly{" "}
        {money(s.totalAmount)} — so the schedule always closes to zero rather than leaving a rounding
        remainder on the balance sheet.
      </p>
    </AppShell>
  );
}
