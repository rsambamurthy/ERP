$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Schedule popup: component and register wiring...' -ForegroundColor Cyan

function Set-FileText($rel, $text) {
  $p = Join-Path $repo $rel
  $dir = Split-Path $p -Parent
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [IO.File]::WriteAllText($p, $text.Replace([string][char]13, ''), (New-Object Text.UTF8Encoding $false))
  Write-Host "  wrote  $rel"
}
function Edit-FileText($rel, $old, $new) {
  $p = Join-Path $repo $rel
  if (-not (Test-Path -LiteralPath $p)) { throw "Missing file: $rel" }
  $old = $old.Replace([string][char]13, '')
  $new = $new.Replace([string][char]13, '')
  $t = [IO.File]::ReadAllText($p).Replace([string][char]13, '')
  if ($t.Contains($new)) { Write-Host "  skip   $rel"; return }
  $i = $t.IndexOf($old)
  if ($i -lt 0) { throw "Anchor not found in $rel." }
  if ($t.IndexOf($old, $i + 1) -ge 0) { throw "Anchor is not unique in $rel." }
  $t = $t.Substring(0, $i) + $new + $t.Substring($i + $old.Length)
  [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false))
  Write-Host "  edit   $rel"
}

Set-FileText 'frontend/components/accounting/DepreciationScheduleModal.tsx' '"use client";

import { useEffect, useState } from "react";
import { ApiError, getDepreciationSchedule } from "@/lib/api";
import type { DepreciationSchedule } from "@/lib/types";

// The whole life of one asset, period by period.
//
// A projection, not a promise — it is computed from the asset as it stands
// and at the company''s current frequency, so a policy change will change
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
'

Edit-FileText 'frontend/app/accounting/fixed-assets/page.tsx' 'import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { ApiError, getFixedAssets } from "@/lib/api";
import type { FixedAssetSummary } from "@/lib/types";

// The fixed asset register.' 'import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { ApiError, getFixedAssets } from "@/lib/api";
import DepreciationScheduleModal from "@/components/accounting/DepreciationScheduleModal";
import type { FixedAssetSummary } from "@/lib/types";

// The fixed asset register.'

Edit-FileText 'frontend/app/accounting/fixed-assets/page.tsx' '  const [search, setSearch] = useState("");
  const [includeDisposed, setIncludeDisposed] = useState(false);
  const [onlyDeviations, setOnlyDeviations] = useState(false);

  useEffect(() => {
    (async () => {' '  const [search, setSearch] = useState("");
  const [includeDisposed, setIncludeDisposed] = useState(false);
  const [onlyDeviations, setOnlyDeviations] = useState(false);
  const [scheduleFor, setScheduleFor] = useState<string | null>(null);

  useEffect(() => {
    (async () => {'

Edit-FileText 'frontend/app/accounting/fixed-assets/page.tsx' '              <th style={{ textAlign: "right" }}>Accum. dep.</th>
              <th style={{ textAlign: "right" }}>Net block</th>
              <th style={{ width: 110 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="ent-empty">Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={9} className="ent-empty">
                No assets yet. One is created by ticking &ldquo;Capitalise this line&rdquo; on a Purchase Bill.
              </td></tr>
            )}
            {!loading && rows.length > 0 && visible.length === 0 && (
              <tr><td colSpan={9} className="ent-empty">Nothing matches.</td></tr>
            )}
            {visible.map((r) => (
              <tr key={r.id}>' '              <th style={{ textAlign: "right" }}>Accum. dep.</th>
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
              <tr key={r.id}>'

Edit-FileText 'frontend/app/accounting/fixed-assets/page.tsx' '                    {r.status.charAt(0) + r.status.slice(1).toLowerCase().replace(/_/g, " ")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>' '                    {r.status.charAt(0) + r.status.slice(1).toLowerCase().replace(/_/g, " ")}
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <button type="button" className="ent-ia ent-ia-edit" onClick={() => setScheduleFor(r.id)}>
                    Schedule
                  </button>
                </td>
              </tr>
            ))}
          </tbody>'

Edit-FileText 'frontend/app/accounting/fixed-assets/page.tsx' '                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(totals.accum)}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(totals.net)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </AppShell>
  );
}' '                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(totals.accum)}</td>
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
}'

Edit-FileText 'frontend/app/accounting/fixed-assets/[id]/page.tsx' 'import { useParams } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { ApiError, getFixedAsset } from "@/lib/api";
import type { FixedAssetDetail } from "@/lib/types";

// One asset: where it came from, what it is being depreciated on, and every' 'import { useParams } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { ApiError, getFixedAsset } from "@/lib/api";
import DepreciationScheduleModal from "@/components/accounting/DepreciationScheduleModal";
import type { FixedAssetDetail } from "@/lib/types";

// One asset: where it came from, what it is being depreciated on, and every'

Edit-FileText 'frontend/app/accounting/fixed-assets/[id]/page.tsx' '  const [a, setA] = useState<FixedAssetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;' '  const [a, setA] = useState<FixedAssetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);

  useEffect(() => {
    if (!params?.id) return;'

Edit-FileText 'frontend/app/accounting/fixed-assets/[id]/page.tsx' '      <div className="ent-section" style={{ marginBottom: 16 }}>
        <div className="ent-section-hdr" style={{ borderRadius: "6px 6px 0 0" }}>
          <span className="ent-section-title">Position</span>
          <span className={a.status === "ACTIVE" ? "badge badge-green" : "badge badge-gray"}>
            {a.status.charAt(0) + a.status.slice(1).toLowerCase().replace(/_/g, " ")}
          </span>
        </div>
        <div className="ent-form-grid" style={{ padding: 14 }}>' '      <div className="ent-section" style={{ marginBottom: 16 }}>
        <div className="ent-section-hdr" style={{ borderRadius: "6px 6px 0 0" }}>
          <span className="ent-section-title">Position</span>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className={a.status === "ACTIVE" ? "badge badge-green" : "badge badge-gray"}>
              {a.status.charAt(0) + a.status.slice(1).toLowerCase().replace(/_/g, " ")}
            </span>
            <button type="button" className="ent-btn-add" onClick={() => setShowSchedule(true)}>
              Depreciation schedule
            </button>
          </span>
        </div>
        <div className="ent-form-grid" style={{ padding: 14 }}>'

Edit-FileText 'frontend/app/accounting/fixed-assets/[id]/page.tsx' '
      <p style={{ ...muted, marginTop: 12, lineHeight: 1.5 }}>
        This table is what posted, not what is forecast. A period appears only once its journal entry
        exists, so the register can always be reconciled against the ledger line by line.
      </p>
    </AppShell>
  );
}' '
      <p style={{ ...muted, marginTop: 12, lineHeight: 1.5 }}>
        This table is what posted, not what is forecast. A period appears only once its journal entry
        exists, so the register can always be reconciled against the ledger line by line. Everything
        still to come is on the <button type="button" className="ent-ia ent-ia-edit" style={{ padding: 0 }} onClick={() => setShowSchedule(true)}>depreciation schedule</button>.
      </p>

      {showSchedule && (
        <DepreciationScheduleModal assetId={a.id} onClose={() => setShowSchedule(false)} />
      )}
    </AppShell>
  );
}'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green