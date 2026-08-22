"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { ApiError, getFixedAssets } from "@/lib/api";
import DepreciationScheduleModal from "@/components/accounting/DepreciationScheduleModal";
import type { FixedAssetSummary } from "@/lib/types";

// The fixed asset register.
//
// Read-only, and there is no "add asset" button on purpose: an asset comes
// into existence by capitalising a Purchase Bill line, inside the same
// transaction that posts the bill. An asset created here by hand would have
// no journal entry behind it, and the register would stop reconciling to the
// ledger — which is the one thing this screen exists to let you check.
//
// The three totals are the ones Schedule III requires shown separately:
// gross block, accumulated depreciation, net block. They should agree with
// accounts 1401–1405 and 1451–1455 respectively.

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dateLabel(v: string | null): string {
  if (!v) return "—";
  const d = new Date(`${v}T00:00:00Z`);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

const STATUS_CLASS: Record<string, string> = {
  ACTIVE: "badge badge-green",
  FULLY_DEPRECIATED: "badge badge-gray",
  DISPOSED: "badge badge-gray",
};

export default function FixedAssetsPage() {
  const [rows, setRows] = useState<FixedAssetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [includeDisposed, setIncludeDisposed] = useState(false);
  const [onlyDeviations, setOnlyDeviations] = useState(false);
  const [scheduleFor, setScheduleFor] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await getFixedAssets(includeDisposed);
        setRows(res.data);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load the register.");
      } finally {
        setLoading(false);
      }
    })();
  }, [includeDisposed]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyDeviations && !r.departsFromScheduleII) return false;
      if (!q) return true;
      return `${r.assetCode} ${r.name} ${r.assetClass.name} ${r.vendor ?? ""} ${r.billNumber ?? ""}`
        .toLowerCase().includes(q);
    });
  }, [rows, search, onlyDeviations]);

  const totals = useMemo(() => visible.reduce(
    (t, r) => ({
      gross: t.gross + r.grossCost,
      accum: t.accum + r.accumulatedDepreciation,
      net: t.net + r.netBookValue,
    }),
    { gross: 0, accum: 0, net: 0 },
  ), [visible]);

  const deviations = useMemo(() => rows.filter((r) => r.departsFromScheduleII).length, [rows]);
  const muted = { color: "var(--color-muted)", fontSize: 12 } as const;

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Fixed Assets</h1>
        <p>
          Every asset capitalised from a Purchase Bill. Gross block, accumulated depreciation and
          net block, which is what Schedule III asks to be shown separately.
        </p>
      </div>

      <div className="ent-toolbar">
        <input
          className="ent-fc"
          style={{ flex: "1 1 300px", maxWidth: 400, height: 34 }}
          placeholder="Search by code, name, class, vendor or bill…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label style={{ ...muted, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={includeDisposed} onChange={(e) => setIncludeDisposed(e.target.checked)} />
          Include disposed
        </label>
        {deviations > 0 && (
          <label style={{ ...muted, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={onlyDeviations} onChange={(e) => setOnlyDeviations(e.target.checked)} />
            Only lives departing from Schedule II ({deviations})
          </label>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
          Net block: <strong>{money(totals.net)}</strong>
        </span>
      </div>

      <p style={{ ...muted, marginBottom: 12 }}>
        Gross block should equal the total of accounts 1401&ndash;1405, and accumulated depreciation the
        total of 1451&ndash;1455. If they disagree, something reached those accounts without going
        through this register.
      </p>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="ent-page-table">
        <table>
          <thead>
            <tr>
              <th style={{ width: 90 }}>Code</th>
              <th>Asset</th>
              <th>Class</th>
              <th>In use from</th>
              <th style={{ width: 130 }}>Basis</th>
              <th style={{ textAlign: "right" }}>Gross</th>
              <th style={{ textAlign: "right" }}>Accum. dep.</th>
              <th style={{ textAlign: "right" }}>Net block</th>
              <th style={{ width: 110 }}>Status</th>
              <th style={{ width: 90 }} />
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={10} className="ent-empty">Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={10} className="ent-empty">
                No assets yet. One is created by ticking &ldquo;Capitalise this line&rdquo; on a Purchase Bill.
              </td></tr>
            )}
            {!loading && rows.length > 0 && visible.length === 0 && (
              <tr><td colSpan={10} className="ent-empty">Nothing matches.</td></tr>
            )}
            {visible.map((r) => (
              <tr key={r.id}>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>
                  <Link href={`/accounting/fixed-assets/${r.id}`} className="ent-ia ent-ia-edit" style={{ padding: 0 }}>
                    {r.assetCode}
                  </Link>
                </td>
                <td style={{ fontWeight: 500 }}>
                  {r.name}
                  {r.vendor && <div style={muted}>{r.vendor}{r.billNumber ? ` · ${r.billNumber}` : ""}</div>}
                </td>
                <td style={{ color: "var(--color-muted)" }}>{r.assetClass.name}</td>
                <td style={{ color: "var(--color-muted)" }}>{dateLabel(r.inUseDate)}</td>
                <td style={{ fontSize: 12 }}>
                  {r.usefulLifeMonths} mo · {r.method === "WDV" ? "WDV" : "SLM"}
                  {r.departsFromScheduleII && (
                    <div style={{ color: "#b45309", fontSize: 11.5 }}>
                      Schedule II: {r.scheduleIiLifeMonths} mo
                    </div>
                  )}
                </td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(r.grossCost)}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--color-muted)" }}>
                  {money(r.accumulatedDepreciation)}
                  {r.periodsPosted === 0 && <div style={{ ...muted, fontSize: 11 }}>nothing posted</div>}
                </td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{money(r.netBookValue)}</td>
                <td>
                  <span className={STATUS_CLASS[r.status] ?? "badge badge-gray"}>
                    {r.status.charAt(0) + r.status.slice(1).toLowerCase().replace(/_/g, " ")}
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <button type="button" className="ent-ia ent-ia-edit" onClick={() => setScheduleFor(r.id)}>
                    Schedule
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {visible.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={5}>{visible.length} asset{visible.length === 1 ? "" : "s"}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(totals.gross)}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(totals.accum)}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(totals.net)}</td>
                <td />
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {scheduleFor && (
        <DepreciationScheduleModal assetId={scheduleFor} onClose={() => setScheduleFor(null)} />
      )}
    </AppShell>
  );
}
