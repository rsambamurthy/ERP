$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Depreciation Due screen...' -ForegroundColor Cyan

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

function Set-FileText($rel, $text) {
  $p = Join-Path $repo $rel
  $dir = Split-Path $p -Parent
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [IO.File]::WriteAllText($p, $text.Replace([string][char]13, ''), (New-Object Text.UTF8Encoding $false))
  Write-Host "  wrote  $rel"
}

Edit-FileText 'frontend/lib/types.ts' '
export interface RecurringGenerateResult {
  created: { recurringExpenseId: string; billNumber: string; grandTotal: number }[];
  failed: { recurringExpenseId: string; message: string }[];
}' '
export interface RecurringGenerateResult {
  created: { recurringExpenseId: string; billNumber: string; grandTotal: number }[];
  failed: { recurringExpenseId: string; message: string }[];
}
// Depreciation Due — one period, the whole organization, posted in order.
//
// Unlike Amortization Due there is no month picker and no per-row selection.
// A depreciation period is not independent of the one before it: under WDV
// every charge compounds on the previous closing balance, so the period on
// offer is always the next one, and it posts whole or not at all.

export interface DepreciationDuePeriod {
  periodStart: string;
  periodEnd: string;
  label: string;
  months: number;
}

export interface DepreciationDueSubPeriod {
  periodStart: string;
  periodEnd: string;
  label: string;
  method: string;
  // Equal except in an asset''s first period, which Schedule II charges pro
  // rata from the date the asset was put to use.
  daysCharged: number;
  daysInPeriod: number;
  openingWdv: number;
  amount: number;
  closingWdv: number;
}

export interface DepreciationDueAsset {
  id: string;
  assetCode: string;
  name: string;
  assetClass: { id: string; name: string };
  branch: { id: string; name: string } | null;
  depExpenseAccount: { accountCode: string; accountName: string };
  accumDepAccount: { accountCode: string; accountName: string };
  method: string;
  openingWdv: number;
  amount: number;
  closingWdv: number;
  // This charge takes the asset to its residual and ends its life.
  final: boolean;
  periods: DepreciationDueSubPeriod[];
  // More than zero only for an asset capitalised with an in-use date behind
  // periods already posted — it is charged for all of them at once.
  catchUpPeriods: number;
  partFirstPeriod: boolean;
}

export interface DepreciationBlockedAsset {
  id: string;
  assetCode: string;
  name: string;
  assetClass: { id: string; name: string };
  reason: string;
  message: string;
}

export interface DepreciationDue {
  frequency: string;
  // null when nothing can be offered — an empty register, or a frequency
  // change that would overlap what is already posted.
  period: DepreciationDuePeriod | null;
  today?: string;
  canPost: boolean;
  // Why not, when canPost is false.
  reason: string | null;
  lastPosted: { periodStart: string; periodEnd: string; label: string } | null;
  totalAmount: number;
  assets: DepreciationDueAsset[];
  blocked: DepreciationBlockedAsset[];
}

export interface DepreciationPostResult {
  periodStart: string;
  periodEnd: string;
  label: string;
  assetCount: number;
  totalAmount: number;
  journalEntryIds: string[];
}

export interface DepreciationReverseResult {
  periodStart: string;
  runsRemoved: number;
  journalEntriesRemoved: number;
}
'

Edit-FileText 'frontend/lib/api.ts' '  VendorContact,
  VendorAddress,
  VendorBankAccount,
  ValuationResponse,
} from "./types";
import { getToken } from "./auth";

// Points at the Railway-hosted backend. Set NEXT_PUBLIC_API_URL in Vercel''s
' '  VendorContact,
  VendorAddress,
  VendorBankAccount,
  ValuationResponse,
  DepreciationDue,
  DepreciationPostResult,
  DepreciationReverseResult,
} from "./types";
import { getToken } from "./auth";

// Points at the Railway-hosted backend. Set NEXT_PUBLIC_API_URL in Vercel''s
'

Edit-FileText 'frontend/lib/api.ts' 'export function postPrepaidAmortization(body: { month: string; scheduleIds: string[] }) {
  return request<{ data: PrepaidPostResult }>("/prepaid-schedules/post", {
    method: "POST", body: JSON.stringify(body),
  });
}' 'export function postPrepaidAmortization(body: { month: string; scheduleIds: string[] }) {
  return request<{ data: PrepaidPostResult }>("/prepaid-schedules/post", {
    method: "POST", body: JSON.stringify(body),
  });
}
// Depreciation Due. No month parameter: the period on offer is whichever one
// is next, which the server decides from what has actually been posted.
export function getDepreciationDue() {
  return request<{ data: DepreciationDue }>("/depreciation-runs/due");
}

// One journal entry per branch for the whole period, in one transaction.
// periodStart is echoed back so a screen left open overnight cannot post a
// period it was never showing.
export function postDepreciationRun(body: { periodStart: string }) {
  return request<{ data: DepreciationPostResult }>("/depreciation-runs/post", {
    method: "POST", body: JSON.stringify(body),
  });
}

// Undoes the latest posted period — deletes its charges and its journal
// entries. Only the latest, because every period after one reversed would be
// computed from a closing balance that no longer exists.
export function reverseDepreciationRun(body: { periodStart: string }) {
  return request<{ data: DepreciationReverseResult }>("/depreciation-runs/reverse", {
    method: "POST", body: JSON.stringify(body),
  });
}
'

Edit-FileText 'frontend/components/layout/navGroups.ts' '      { id: "balance_sheet", label: "Balance Sheet", path: "/accounting/balance-sheet", dot: "#7c3aed", roles: ALL_ROLES },
      { id: "prepaid_schedules", label: "Prepaid Schedules", path: "/accounting/prepaid-schedules", dot: "#0d9488", roles: ALL_ROLES },
      { id: "amortization_due", label: "Amortization Due", path: "/accounting/amortization-due", dot: "#e11d48", roles: ["OWNER", "ADMIN", "ACCOUNTANT"], permission: "journal.post" },
      { id: "fixed_assets", label: "Fixed Assets", path: "/accounting/fixed-assets", dot: "#9333ea", roles: ALL_ROLES },
    ],
  },
  {
    id: "statutory",
' '      { id: "balance_sheet", label: "Balance Sheet", path: "/accounting/balance-sheet", dot: "#7c3aed", roles: ALL_ROLES },
      { id: "prepaid_schedules", label: "Prepaid Schedules", path: "/accounting/prepaid-schedules", dot: "#0d9488", roles: ALL_ROLES },
      { id: "amortization_due", label: "Amortization Due", path: "/accounting/amortization-due", dot: "#e11d48", roles: ["OWNER", "ADMIN", "ACCOUNTANT"], permission: "journal.post" },
      { id: "fixed_assets", label: "Fixed Assets", path: "/accounting/fixed-assets", dot: "#9333ea", roles: ALL_ROLES },
      { id: "depreciation_due", label: "Depreciation Due", path: "/accounting/depreciation-due", dot: "#e11d48", roles: ["OWNER", "ADMIN", "ACCOUNTANT"], permission: "journal.post" },
    ],
  },
  {
    id: "statutory",
'

Set-FileText 'frontend/app/accounting/depreciation-due/page.tsx' '"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import {
  ApiError, getDepreciationDue, postDepreciationRun, reverseDepreciationRun,
} from "@/lib/api";
import type { DepreciationDue, DepreciationDueAsset } from "@/lib/types";

// Depreciation Due — the run.
//
// Until this screen existed, depreciation was something the system could
// describe and not something it ever charged: the register knew what each
// asset would cost the P&L and when, and the P&L never heard about it. This
// is where the projection becomes a journal entry.
//
// It deliberately looks less flexible than Amortization Due, which offers a
// month picker and a tick box per row. There is no picker here and no
// selection, because a depreciation period is not independent of the one
// before it. Under written-down value every charge is computed on the
// previous closing balance, so posting August before April would compute
// August from a balance that never existed, and posting half of April would
// leave the other half stranded — the next run would see April as done.
//
// So: one period, the next one, all of it or none of it.

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function DepreciationDuePage() {
  const [due, setDue] = useState<DepreciationDue | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getDepreciationDue();
      setDue(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load what''s due.");
      setDue(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handlePost() {
    if (!due?.period) return;
    const n = due.assets.length;
    const confirmed = window.confirm(
      `Post depreciation for ${due.period.label}?\n\n`
      + `${n} asset${n === 1 ? "" : "s"}, ${money(due.totalAmount)} in total.\n\n`
      + "This writes to the ledger. It can be undone from this screen while it is the latest period posted.",
    );
    if (!confirmed) return;

    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await postDepreciationRun({ periodStart: due.period.periodStart });
      setNotice(
        `Posted ${res.data.label} — ${res.data.assetCount} asset${res.data.assetCount === 1 ? "" : "s"}, `
        + `${money(res.data.totalAmount)}, in ${res.data.journalEntryIds.length} journal `
        + `entr${res.data.journalEntryIds.length === 1 ? "y" : "ies"}.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post the depreciation run.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReverse() {
    const last = due?.lastPosted;
    if (!last) return;
    const confirmed = window.confirm(
      `Reverse the depreciation posted for ${last.label}?\n\n`
      + "The charges and the journal entries for that period are deleted, and the period becomes due again. "
      + "Only the latest posted period can be reversed.",
    );
    if (!confirmed) return;

    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await reverseDepreciationRun({ periodStart: last.periodStart });
      setNotice(
        `Reversed ${last.label} — ${res.data.runsRemoved} charge${res.data.runsRemoved === 1 ? "" : "s"} `
        + `and ${res.data.journalEntriesRemoved} journal `
        + `entr${res.data.journalEntriesRemoved === 1 ? "y" : "ies"} removed.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reverse that period.");
    } finally {
      setBusy(false);
    }
  }

  const muted = { color: "var(--color-muted)", fontSize: 12 } as const;
  const num = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

  const catchUps = due?.assets.filter((a) => a.catchUpPeriods > 0) ?? [];
  const finishing = due?.assets.filter((a) => a.final) ?? [];

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Depreciation Due</h1>
        <p>
          One period at a time, for every asset in the register, in order. Posting writes a journal entry per branch
          — depreciation expense debited, accumulated depreciation credited against each asset&rsquo;s own card.
        </p>
      </div>

      <div className="ent-toolbar">
        <span style={{ fontSize: 15, fontWeight: 600 }}>
          {loading ? "Loading…" : due?.period ? due.period.label : "Nothing due"}
        </span>
        {due && (
          <span style={muted}>
            {due.frequency.toLowerCase().replace("_", "-")}
            {due.lastPosted && <> · posted through {due.lastPosted.label}</>}
          </span>
        )}
        <Link href="/accounting/fixed-assets" className="ent-ia ent-ia-edit">Register →</Link>
        <div style={{ flex: 1 }} />
        {due && due.assets.length > 0 && (
          <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
            {due.assets.length} asset{due.assets.length === 1 ? "" : "s"} · <strong>{money(due.totalAmount)}</strong>
          </span>
        )}
        {due?.lastPosted && (
          <button className="ent-btn-cancel" disabled={busy} onClick={handleReverse}>
            {busy ? "Working…" : `Reverse ${due.lastPosted.label}`}
          </button>
        )}
        <button className="ent-btn-save" disabled={!due?.canPost || busy} onClick={handlePost}>
          {busy ? "Posting…" : "Post the Period"}
        </button>
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

      {!loading && due?.reason && (
        <div className="ent-section" style={{ marginBottom: 16, padding: "10px 14px", borderLeft: "3px solid #b45309" }}>
          <p style={{ fontSize: 13, margin: 0 }}>{due.reason}</p>
        </div>
      )}

      {/* An asset owing several periods at once is unusual enough to say out
          loud. The entry is dated to the period being posted, but the charges
          are recorded at their own periods, so the register stays truthful. */}
      {!loading && catchUps.length > 0 && (
        <div className="ent-section" style={{ marginBottom: 16, padding: "10px 14px", borderLeft: "3px solid #6d28d9" }}>
          <p style={{ fontSize: 13, margin: 0 }}>
            <strong>{catchUps.length}</strong> asset{catchUps.length === 1 ? " is" : "s are"} catching up on earlier
            periods as well as this one — they were capitalised with a date behind what has already been posted. Each
            charge is recorded at its own period; the journal entry is dated to {due?.period?.label}.
          </p>
        </div>
      )}

      {!loading && finishing.length > 0 && (
        <div className="ent-section" style={{ marginBottom: 16, padding: "10px 14px", borderLeft: "3px solid #0d9488" }}>
          <p style={{ fontSize: 13, margin: 0 }}>
            <strong>{finishing.length}</strong> asset{finishing.length === 1 ? "" : "s"} reach
            {finishing.length === 1 ? "es" : ""} the end of its useful life this period. The last charge is a balancing
            figure, so each lands on exactly its residual value rather than a rounding remainder.
          </p>
        </div>
      )}

      <div className="ent-page-table">
        <table>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Class</th>
              <th style={{ width: 70 }}>Method</th>
              <th>Depreciation account</th>
              <th style={{ width: 130, ...num }}>Opening</th>
              <th style={{ width: 120, ...num }}>Charge</th>
              <th style={{ width: 130, ...num }}>Closing</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="ent-empty">Loading…</td></tr>}
            {!loading && (!due || due.assets.length === 0) && (
              <tr><td colSpan={7} className="ent-empty">
                {due?.reason ?? "Nothing is due."}
              </td></tr>
            )}
            {!loading && due?.assets.map((a: DepreciationDueAsset) => (
              <tr key={a.id}>
                <td style={{ fontWeight: 500 }}>
                  <Link href={`/accounting/fixed-assets/${a.id}`} style={{ color: "inherit", textDecoration: "none" }}>
                    {a.assetCode} — {a.name}
                  </Link>
                  {a.branch && <div style={muted}>{a.branch.name}</div>}
                  {a.partFirstPeriod && (
                    <div style={muted}>
                      First period, charged pro rata for {a.periods[0].daysCharged} of {a.periods[0].daysInPeriod} days
                    </div>
                  )}
                  {a.catchUpPeriods > 0 && (
                    <div style={{ ...muted, color: "#6d28d9" }}>
                      {a.periods.length} periods in this entry —{" "}
                      <button
                        type="button"
                        onClick={() => setExpanded((e) => ({ ...e, [a.id]: !e[a.id] }))}
                        style={{
                          background: "none", border: "none", padding: 0, cursor: "pointer",
                          color: "inherit", textDecoration: "underline", font: "inherit",
                        }}
                      >
                        {expanded[a.id] ? "hide" : "show"} them
                      </button>
                    </div>
                  )}
                  {expanded[a.id] && (
                    <div style={{ ...muted, marginTop: 4 }}>
                      {a.periods.map((p) => (
                        <div key={p.periodStart} style={{ fontVariantNumeric: "tabular-nums" }}>
                          {p.label} · {p.method} · {money(p.amount)}
                        </div>
                      ))}
                    </div>
                  )}
                  {a.final && <div><span className="badge badge-green">Final charge</span></div>}
                </td>
                <td style={{ color: "var(--color-muted)" }}>{a.assetClass.name}</td>
                <td>{a.method}</td>
                <td style={{ color: "var(--color-muted)", fontSize: 12 }}>
                  {a.depExpenseAccount.accountCode} — {a.depExpenseAccount.accountName}
                  <div>Cr {a.accumDepAccount.accountCode} — {a.accumDepAccount.accountName}</div>
                </td>
                <td style={num}>{money(a.openingWdv)}</td>
                <td style={{ ...num, fontWeight: 600 }}>{money(a.amount)}</td>
                <td style={{ ...num, color: "var(--color-muted)" }}>{money(a.closingWdv)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Assets the run cannot charge. Listed rather than dropped: an asset
          that quietly stops depreciating is how a register and a ledger
          drift apart without anyone noticing. */}
      {!loading && due && due.blocked.length > 0 && (
        <div className="ent-section" style={{ marginTop: 16 }}>
          <div className="ent-section-hdr" style={{ borderRadius: "6px 6px 0 0" }}>
            <span className="ent-section-title">Not charged this period</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Class</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {due.blocked.map((b) => (
                <tr key={b.id}>
                  <td style={{ fontWeight: 500 }}>
                    <Link href={`/accounting/fixed-assets/${b.id}`} style={{ color: "inherit", textDecoration: "none" }}>
                      {b.assetCode} — {b.name}
                    </Link>
                  </td>
                  <td style={{ color: "var(--color-muted)" }}>{b.assetClass.name}</td>
                  <td style={{ fontSize: 12.5 }}>{b.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green