"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { ApiError, getFixedAsset } from "@/lib/api";
import type { FixedAssetDetail } from "@/lib/types";

// One asset: where it came from, what it is being depreciated on, and every
// charge posted against it.
//
// The charge table is the record of what actually happened, not a forecast.
// A period that has not been posted does not appear — the schedule of what
// is still to come belongs on the due screen, where it can still be changed
// by a policy that has not taken effect yet.

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dateLabel(v: string | null): string {
  if (!v) return "—";
  const d = new Date(`${v}T00:00:00Z`);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function periodLabel(start: string | null, end: string | null, frequency: string): string {
  if (!start) return "—";
  if (frequency === "MONTHLY") {
    const d = new Date(`${start}T00:00:00Z`);
    return isNaN(d.getTime()) ? start : d.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
  }
  return `${dateLabel(start)} – ${dateLabel(end)}`;
}

export default function FixedAssetDetailPage() {
  const params = useParams<{ id: string }>();
  const [a, setA] = useState<FixedAssetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    (async () => {
      try {
        const res = await getFixedAsset(params.id);
        setA(res.data);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load the asset.");
      } finally {
        setLoading(false);
      }
    })();
  }, [params?.id]);

  const muted = { color: "var(--color-muted)", fontSize: 12 } as const;

  if (loading) {
    return <AppShell><div className="ent-page-hdr"><h1>Asset</h1></div><p style={muted}>Loading…</p></AppShell>;
  }
  if (error || !a) {
    return (
      <AppShell>
        <div className="ent-page-hdr"><h1>Asset</h1></div>
        <p style={{ color: "#dc2626", fontSize: 13 }}>{error ?? "Not found."}</p>
        <Link href="/accounting/fixed-assets" className="ent-ia ent-ia-edit">← Register</Link>
      </AppShell>
    );
  }

  const depreciable = a.grossCost - a.residualValue;
  const pct = depreciable > 0 ? Math.round((a.accumulatedDepreciation / depreciable) * 100) : 0;

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>{a.assetCode} — {a.name}</h1>
        <p>
          <Link href="/accounting/fixed-assets" className="ent-ia ent-ia-edit" style={{ padding: 0 }}>← Register</Link>
          {" · "}{a.assetClass.name}
          {a.purchaseBill && <> · from bill <strong>{a.purchaseBill.billNumber}</strong>{a.purchaseBill.vendor ? ` — ${a.purchaseBill.vendor.name}` : ""}</>}
        </p>
      </div>

      <div className="ent-section" style={{ marginBottom: 16 }}>
        <div className="ent-section-hdr" style={{ borderRadius: "6px 6px 0 0" }}>
          <span className="ent-section-title">Position</span>
          <span className={a.status === "ACTIVE" ? "badge badge-green" : "badge badge-gray"}>
            {a.status.charAt(0) + a.status.slice(1).toLowerCase().replace(/_/g, " ")}
          </span>
        </div>
        <div className="ent-form-grid" style={{ padding: 14 }}>
          <div className="ent-fg">
            <span className="ent-fl">Gross block</span>
            <div style={{ fontSize: 18, fontVariantNumeric: "tabular-nums" }}>{money(a.grossCost)}</div>
            <span style={muted}>
              {a.gstCapitalised
                ? "GST capitalised into the cost — no input credit claimed"
                : "net of GST — the input credit was claimed on the bill"}
            </span>
          </div>
          <div className="ent-fg">
            <span className="ent-fl">Accumulated depreciation</span>
            <div style={{ fontSize: 18, fontVariantNumeric: "tabular-nums" }}>{money(a.accumulatedDepreciation)}</div>
            <span style={muted}>{pct}% of the depreciable amount · {a.runs.length} period{a.runs.length === 1 ? "" : "s"} posted</span>
          </div>
          <div className="ent-fg">
            <span className="ent-fl">Net block</span>
            <div style={{ fontSize: 18, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{money(a.netBookValue)}</div>
            <span style={muted}>falls to {money(a.residualValue)} at the end of the life, not to nil</span>
          </div>
          <div className="ent-fg">
            <span className="ent-fl">Basis</span>
            <div style={{ fontSize: 15 }}>
              {a.usefulLifeMonths} months · {a.method === "WDV" ? "written-down value" : "straight line"}
            </div>
            <span style={muted}>
              pinned at capitalisation — editing the class or the policy since cannot change this asset
            </span>
          </div>
          <div className="ent-fg">
            <span className="ent-fl">In use from</span>
            <div style={{ fontSize: 15 }}>{dateLabel(a.inUseDate)}</div>
            <span style={muted}>bought {dateLabel(a.purchaseDate)} — Schedule II charges from the date of use</span>
          </div>
          <div className="ent-fg">
            <span className="ent-fl">Sub-ledger card</span>
            <div style={{ fontSize: 15 }}>{a.card.name}</div>
            <span style={muted}>tagged on both {a.assetAccount.accountCode} and {a.accumDepAccount.accountCode}</span>
          </div>
        </div>

        {a.departsFromScheduleII && (
          <div style={{ margin: "0 14px 14px", padding: "8px 10px", borderRadius: 4, background: "#fef3c7", color: "#92400e", fontSize: 12.5, lineHeight: 1.5 }}>
            <strong>{a.usefulLifeMonths} months, against the {a.scheduleIiLifeMonths} Schedule II prescribes.</strong>
            {a.usefulLifeNote
              ? <div style={{ marginTop: 4 }}>{a.usefulLifeNote}</div>
              : <div style={{ marginTop: 4 }}>No justification recorded — which should not be possible.</div>}
          </div>
        )}
      </div>

      <div className="ent-section" style={{ marginBottom: 16 }}>
        <div className="ent-section-hdr" style={{ borderRadius: "6px 6px 0 0" }}>
          <span className="ent-section-title">Where it posts</span>
        </div>
        <div className="ent-form-grid" style={{ padding: 14 }}>
          <div className="ent-fg">
            <span className="ent-fl">Cost</span>
            <div style={{ fontSize: 14 }}>{a.assetAccount.accountCode} — {a.assetAccount.accountName}</div>
          </div>
          <div className="ent-fg">
            <span className="ent-fl">Accumulated depreciation</span>
            <div style={{ fontSize: 14 }}>{a.accumDepAccount.accountCode} — {a.accumDepAccount.accountName}</div>
          </div>
          <div className="ent-fg">
            <span className="ent-fl">Charge</span>
            <div style={{ fontSize: 14 }}>{a.depExpenseAccount.accountCode} — {a.depExpenseAccount.accountName}</div>
          </div>
        </div>
      </div>

      <div className="ent-page-table">
        <table>
          <thead>
            <tr>
              <th>Period</th>
              <th style={{ textAlign: "right" }}>Opening</th>
              <th style={{ textAlign: "right" }}>Charge</th>
              <th style={{ textAlign: "right" }}>Closing</th>
              <th style={{ width: 140 }}>Type</th>
            </tr>
          </thead>
          <tbody>
            {a.runs.length === 0 && (
              <tr><td colSpan={5} className="ent-empty">
                Nothing has been charged against this asset yet.
              </td></tr>
            )}
            {a.runs.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 500 }}>{periodLabel(r.periodStart, r.periodEnd, r.frequency)}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--color-muted)" }}>{money(r.openingWdv)}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(r.amount)}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(r.closingWdv)}</td>
                <td style={muted}>
                  {r.runType === "DISPOSAL_CATCHUP" ? "Up to disposal" : "Periodic"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ ...muted, marginTop: 12, lineHeight: 1.5 }}>
        This table is what posted, not what is forecast. A period appears only once its journal entry
        exists, so the register can always be reconciled against the ledger line by line.
      </p>
    </AppShell>
  );
}
