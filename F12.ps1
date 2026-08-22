$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Capital asset row under the bill line...' -ForegroundColor Cyan

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

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/AppShell";' '"use client";

import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/AppShell";'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '              {/* The Prepaid column is hidden on a foreign-currency or
                  PO-linked bill: the server rejects prepaid on both, so
                  offering it would only produce a rejected post. */}
              <thead><tr><th style={{ width: "22%" }}>Item</th><th>Qty</th><th>Rate{isForeign ? ` (${currency})` : ""}</th>{isForeign && <th>Rate (₹)</th>}<th>Tax %</th>{isForeign && <th>Duty %</th>}{canPrepay && <th style={{ width: "20%" }}>Prepaid</th>}{canCapitalise && <th style={{ width: "24%" }}>Capital asset</th>}<th /></tr></thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i}>
                    <td>
                      <ItemPicker
                        items={items.filter((it) => it.isActive)}' '              {/* The Prepaid column is hidden on a foreign-currency or
                  PO-linked bill: the server rejects prepaid on both, so
                  offering it would only produce a rejected post. */}
              <thead><tr><th style={{ width: "22%" }}>Item</th><th>Qty</th><th>Rate{isForeign ? ` (${currency})` : ""}</th>{isForeign && <th>Rate (₹)</th>}<th>Tax %</th>{isForeign && <th>Duty %</th>}{canPrepay && <th style={{ width: "26%" }}>Prepaid</th>}<th /></tr></thead>
              <tbody>
                {lines.map((line, i) => (
                  <Fragment key={i}>
                  <tr>
                    <td>
                      <ItemPicker
                        items={items.filter((it) => it.isActive)}'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '                        )}
                      </td>
                    )}
                    {canCapitalise && (
                      <td>
                        {isServiceLine(line) && itemById.get(line.itemId)?.defaultAssetClass ? (
                          <>
                            <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
                              <input
                                type="checkbox"
                                checked={!!line.capitalise}' '                        )}
                      </td>
                    )}
                    <td><button type="button" className="ent-ia ent-ia-del" disabled={lines.length <= 1} onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>✕</button></td>
                  </tr>
                  {/* The capital-asset controls get a row of their own rather
                      than a column: a tickbox, a date and a sentence of
                      consequence do not fit in a table cell, and squeezing
                      them into one made the whole grid narrower for every
                      line, capitalised or not. */}
                  {canCapitalise && isServiceLine(line) && (
                    <tr>
                      <td colSpan={5 + (canPrepay ? 1 : 0)} style={{ background: "#fafcff", paddingTop: 4, paddingBottom: 8 }}>
                        {itemById.get(line.itemId)?.defaultAssetClass ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 12.5 }}>
                            <label style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                              <input
                                type="checkbox"
                                checked={!!line.capitalise}'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '                                  ? { capitalise: true, assetClassId: itemById.get(line.itemId)!.defaultAssetClass!.id, inUseDate: line.inUseDate || billDate }
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
                                  {" · "}
                                  {methodForMonth(String(line.inUseDate).slice(0, 7)) === "WDV" ? "written-down value" : "straight line"}
                                </div>
                                {/* Depreciation runs from the date the asset was
                                    put to use, not the date it was bought —
                                    Schedule II charges "on a pro rata basis from
                                    the date of such addition". */}
                                <div style={{ fontSize: 11.5, color: "var(--color-muted)", marginTop: 4 }}>
                                  {capitalHint(line)}
                                </div>
                              </>
                            )}
                          </>
                        ) : (
                          <span style={{ fontSize: 11.5, color: "var(--color-muted)" }}>
                            {!line.itemId
                              ? "\u2014"
                              : isServiceLine(line)
                                ? "Set a capital asset class on this item to capitalise it"
                                : "Stock item \u2014 not capitalisable"}
                          </span>
                        )}
                      </td>
                    )}
                    <td><button type="button" className="ent-ia ent-ia-del" disabled={lines.length <= 1} onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>' '                                  ? { capitalise: true, assetClassId: itemById.get(line.itemId)!.defaultAssetClass!.id, inUseDate: line.inUseDate || billDate }
                                  : { capitalise: false, assetClassId: undefined, assetName: undefined, inUseDate: undefined })}
                              />
                              Capitalise
                            </label>
                            <span style={{ color: "var(--color-muted)", whiteSpace: "nowrap" }}>
                              {itemById.get(line.itemId)!.defaultAssetClass!.name}
                            </span>
                            {line.capitalise && (
                              <>
                                <label style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--color-muted)", whiteSpace: "nowrap" }}>
                                  Put to use
                                  <input
                                    type="date" className="ent-fc" style={{ width: 150 }}
                                    min={billDate}
                                    value={line.inUseDate ?? ""}
                                    onChange={(e) => updateLine(i, { inUseDate: e.target.value })}
                                  />
                                </label>
                                <span style={{ color: "var(--color-muted)", whiteSpace: "nowrap" }}>
                                  {assetClassById.get(String(line.assetClassId))?.defaultUsefulLifeMonths ?? "—"} months
                                  {" · "}
                                  {methodForMonth(String(line.inUseDate).slice(0, 7)) === "WDV" ? "written-down value" : "straight line"}
                                </span>
                                {/* The consequence, before it is committed. */}
                                <span style={{ color: "var(--color-muted)" }}>{capitalHint(line)}</span>
                              </>
                            )}
                          </div>
                        ) : (
                          <span style={{ fontSize: 11.5, color: "var(--color-muted)" }}>
                            Set a capital asset class on this item to capitalise it.
                          </span>
                        )}
                      </td>
                      <td style={{ background: "#fafcff" }} />
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green