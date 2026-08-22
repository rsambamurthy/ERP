$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Schedule popup: types, API, bill line...' -ForegroundColor Cyan

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

Edit-FileText 'frontend/lib/types.ts' '  netBookValue: number;
  periodsPosted: number;
  status: string;
}

export interface FixedAssetRun {' '  netBookValue: number;
  periodsPosted: number;
  status: string;
}

// One period of a projected schedule. Not a posted charge — see
// DepreciationSchedule.
export interface DepreciationSchedulePeriod {
  periodStart: string;
  periodEnd: string;
  frequency: string;
  // Fewer than the days in the period only for the first one, which is
  // charged pro rata from the date the asset was put to use.
  daysCharged: number;
  daysInPeriod: number;
  openingWdv: number;
  amount: number;
  closingWdv: number;
  // True when this period has actually been charged, in which case the
  // figures above are the ledger''s rather than the projection''s.
  posted: boolean;
}

// The whole life of an asset, period by period. A projection computed from
// the asset as it stands and the company''s current frequency — a policy
// change before a period is charged will change it.
export interface DepreciationSchedule {
  assetCode: string;
  name: string;
  method: string;
  frequency: string;
  usefulLifeMonths: number;
  grossCost: number;
  residualValue: number;
  periods: DepreciationSchedulePeriod[];
}

export interface FixedAssetRun {'

Edit-FileText 'frontend/lib/api.ts' '  DepreciationPolicy,
  FixedAssetSummary,
  FixedAssetDetail,
  PrepaidScheduleSummary,
  PrepaidScheduleDetail,
  PrepaidDueRow,' '  DepreciationPolicy,
  FixedAssetSummary,
  FixedAssetDetail,
  DepreciationSchedule,
  PrepaidScheduleSummary,
  PrepaidScheduleDetail,
  PrepaidDueRow,'

Edit-FileText 'frontend/lib/api.ts' '  return request<{ data: FixedAssetDetail }>(`/fixed-assets/${id}`);
}

// ── Depreciation policy ──────────────────────────────────────────────────

export function getDepreciationPolicy() {' '  return request<{ data: FixedAssetDetail }>(`/fixed-assets/${id}`);
}

// The asset''s whole life, period by period. Projected from where it stands
// now, with any period already charged showing the ledger instead.
export function getDepreciationSchedule(id: string) {
  return request<{ data: DepreciationSchedule }>(`/fixed-assets/${id}/schedule`);
}

// ── Depreciation policy ──────────────────────────────────────────────────

export function getDepreciationPolicy() {'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '                    )}
                    {canCapitalise && (
                      <td>
                        {isServiceLine(line) ? (
                          <>
                            <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
                              <input' '                    )}
                    {canCapitalise && (
                      <td>
                        {isServiceLine(line) && itemById.get(line.itemId)?.defaultAssetClass ? (
                          <>
                            <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
                              <input'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '                                checked={!!line.capitalise}
                                disabled={!!line.prepaid}
                                onChange={(e) => updateLine(i, e.target.checked
                                  ? { capitalise: true, assetClassId: line.assetClassId || "", inUseDate: line.inUseDate || billDate }
                                  : { capitalise: false, assetClassId: undefined, assetName: undefined, inUseDate: undefined })}
                              />
                              Capitalise this line
                            </label>
                            {line.capitalise && (
                              <>
                                <select
                                  className="ent-fc" style={{ width: "100%", marginTop: 6 }}
                                  value={line.assetClassId ?? ""}
                                  onChange={(e) => updateLine(i, { assetClassId: e.target.value })}
                                >
                                  <option value="">Asset class…</option>
                                  {assetClasses.map((c) => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                  ))}
                                </select>
                                <input
                                  type="date" className="ent-fc" style={{ width: "100%", marginTop: 6 }}
                                  min={billDate}
                                  value={line.inUseDate ?? ""}
                                  onChange={(e) => updateLine(i, { inUseDate: e.target.value })}
                                />
                                {/* Shown, never chosen. Life belongs to the
                                    asset class and method to the company —
                                    both under Configuration > Depreciation. */}
                                <div style={{ fontSize: 11.5, color: "var(--color-muted)", marginTop: 6 }}>
                                  {assetClassById.get(String(line.assetClassId))?.defaultUsefulLifeMonths ?? "—"} months
                                  {" · "}' '                                checked={!!line.capitalise}
                                disabled={!!line.prepaid}
                                onChange={(e) => updateLine(i, e.target.checked
                                  ? { capitalise: true, assetClassId: itemById.get(line.itemId)!.defaultAssetClass!.id, inUseDate: line.inUseDate || billDate }
                                  : { capitalise: false, assetClassId: undefined, assetName: undefined, inUseDate: undefined })}
                              />
                              Capitalise this line
                            </label>
                            {/* No class picker: the class comes from the item,
                                set once in the Item master. The life and
                                method come from Configuration > Depreciation.
                                The only thing genuinely particular to this
                                purchase is when the asset was put to use. */}
                            <div style={{ fontSize: 11.5, color: "var(--color-muted)", marginTop: 3 }}>
                              {itemById.get(line.itemId)!.defaultAssetClass!.name}
                            </div>
                            {line.capitalise && (
                              <>
                                <input
                                  type="date" className="ent-fc" style={{ width: "100%", marginTop: 6 }}
                                  min={billDate}
                                  title="Put to use"
                                  value={line.inUseDate ?? ""}
                                  onChange={(e) => updateLine(i, { inUseDate: e.target.value })}
                                />
                                <div style={{ fontSize: 11.5, color: "var(--color-muted)", marginTop: 6 }}>
                                  {assetClassById.get(String(line.assetClassId))?.defaultUsefulLifeMonths ?? "—"} months
                                  {" · "}'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '                          </>
                        ) : (
                          <span style={{ fontSize: 11.5, color: "var(--color-muted)" }}>
                            {line.itemId ? "Stock item — not capitalisable" : "—"}
                          </span>
                        )}
                      </td>' '                          </>
                        ) : (
                          <span style={{ fontSize: 11.5, color: "var(--color-muted)" }}>
                            {!line.itemId
                              ? "\u2014"
                              : isServiceLine(line)
                                ? "Set a capital asset class on this item to capitalise it"
                                : "Stock item \u2014 not capitalisable"}
                          </span>
                        )}
                      </td>'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green