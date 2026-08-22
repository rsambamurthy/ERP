"use client";

import { useEffect, useState } from "react";
import { ApiError, getDepreciationSchedule } from "@/lib/api";
import type { DepreciationSchedule } from "@/lib/types";

// The whole life of one asset, period by period.
//
// A projection, not a promise — it is computed from the asset as it stands
// and at the company's current frequency, so a policy change will change
// what actually posts. Periods already charged are marked and show what the
// ledger says rather than what the projection says, because the ledger is
// the fact and this is the estimate.

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dateLabel(v: string): string {
  const d = new Date(`${v}T00:00:00Z`);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function periodLabel(start: string, end: string, frequency: string): string {
  if (frequency === "MONTHLY") {
    const d = new Date(`${start}T00:00:00Z`);
    return isNaN(d.getTime()) ? start : d.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
  }
  return `${dateLabel(start)} – ${dateLabel(end)}`;
}

const FREQUENCY_LABEL: Record<string, string> = {
  MONTHLY: "monthly",
  QUARTERLY: "quarterly",
  HALF_YEARLY: "half-yearly",
  ANNUAL: "annual",
};

export default function DepreciationScheduleModal({ assetId, onClose }: { assetId: string; onClose: () => void }) {
  const [data, setData] = useState<DepreciationSchedule | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await getDepreciationSchedule(assetId);
        setData(res.data);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not build the schedule.");
      }
    })();
  }, [assetId]);

  // Escape closes it, which is what everyone tries first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const muted = { color: "var(--color-muted)", fontSize: 12 } as const;
  const postedCount = data?.periods.filter((p) => p.posted).length ?? 0;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20, zIndex: 60,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--color-surface)", borderRadius: 8, width: "min(900px, 100%)",
          maxHeight: "88vh", display: "flex", flexDirection: "column",
          boxShadow: "0 12px 40px rgba(15,23,42,0.25)",
        }}
      >
        <div className="ent-section-hdr" style={{ borderRadius: "8px 8px 0 0" }}>
          <span className="ent-section-title">
            {data ? `${data.assetCode} — ${data.name}` : "Depreciation schedule"}
          </span>
          <button type="button" className="ent-btn-cancel" onClick={onClose}>Close</button>
        </div>

        {error && <p style={{ color: "#dc2626", fontSize: 13, padding: 14 }}>{error}</p>}
        {!data && !error && <p style={{ ...muted, padding: 14 }}>Building the schedule…</p>}

        {data && (
          <>
            <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--color-border)", fontSize: 12.5, lineHeight: 1.6 }}>
              {money(data.grossCost)} over {data.usefulLifeMonths} months on the{" "}
              {data.method === "WDV" ? "written-down value" : "straight line"} method, charged{" "}
              {FREQUENCY_LABEL[data.frequency] ?? data.frequency.toLowerCase()}, down to a residual of{" "}
              {money(data.residualValue)}.
              <div style={muted}>
                {postedCount > 0
                  ? `${postedCount} period${postedCount === 1 ? "" : "s"} already posted — those rows show the ledger, the rest are projected.`
                  : "Nothing posted yet, so every row is a projection. A change of policy before a period is charged will change it."}
              </div>
            </div>

            <div style={{ overflow: "auto" }}>
              <table className="ent-table" style={{ width: "100%" }}>
                <thead style={{ position: "sticky", top: 0, background: "#f8fafd", zIndex: 1 }}>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th>Period</th>
                    <th style={{ textAlign: "right" }}>Opening</th>
                    <th style={{ textAlign: "right" }}>Charge</th>
                    <th style={{ textAlign: "right" }}>Closing</th>
                    <th style={{ width: 90 }} />
                  </tr>
                </thead>
                <tbody>
                  {data.periods.map((p, i) => {
                    const partial = p.daysCharged < p.daysInPeriod;
                    return (
                      <tr key={p.periodStart} style={p.posted ? undefined : { color: "var(--color-muted)" }}>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>{i + 1}</td>
                        <td style={{ fontWeight: p.posted ? 600 : 400, color: "var(--color-text)" }}>
                          {periodLabel(p.periodStart, p.periodEnd, p.frequency)}
                          {partial && (
                            <div style={{ ...muted, fontSize: 11 }}>
                              {p.daysCharged} of {p.daysInPeriod} days — pro rata from the date of use
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(p.openingWdv)}</td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--color-text)", fontWeight: p.posted ? 600 : 400 }}>
                          {money(p.amount)}
                        </td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(p.closingWdv)}</td>
                        <td>
                          {p.posted && <span className="badge badge-green">Posted</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>{data.periods.length} periods</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                      {money(data.periods.reduce((s, p) => s + p.amount, 0))}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(data.residualValue)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            <div style={{ padding: "10px 14px", borderTop: "1px solid var(--color-border)", ...muted, lineHeight: 1.5 }}>
              The last period is the balancing figure, so the asset lands on exactly{" "}
              {money(data.residualValue)} rather than a rounding remainder either side of it.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
