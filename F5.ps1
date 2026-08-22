$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Depreciation config: types, API, navigation, bill line...' -ForegroundColor Cyan

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

Edit-FileText 'frontend/lib/types.ts' '  // "YYYY-MM-DD" — when the asset was put to use, which is what Schedule II
  // depreciates from. Never earlier than the bill date.
  inUseDate?: string;
  // Schedule II allows a justified departure from the class''s default life.
  usefulLifeMonths?: number;
  // NOTE: no method here. The depreciation method is a company policy, not a
  // per-purchase choice — see DepreciationPolicy below. The useful life is
  // the opposite: Schedule II is about the life of a particular asset.' '  // "YYYY-MM-DD" — when the asset was put to use, which is what Schedule II
  // depreciates from. Never earlier than the bill date.
  inUseDate?: string;
  // NOTE: no useful life here either. A company adopting a life shorter than
  // Schedule II is making one policy decision, not one per purchase, so it
  // lives on the asset class under Configuration > Depreciation — with its
  // justification, which every asset copies at capitalisation.
  // NOTE: no method here. The depreciation method is a company policy, not a
  // per-purchase choice — see DepreciationPolicy below. The useful life is
  // the opposite: Schedule II is about the life of a particular asset.'

Edit-FileText 'frontend/lib/types.ts' '  name: string;
}

export interface DepreciationPolicy {
  currentMethod: string;
  // "YYYY-MM", or null when nothing has ever been depreciated. A change can
  // never take effect on or before this month.
  lastPostedChargeMonth: string | null;
  earliestEffectiveMonth: string;
  changes: DepreciationMethodChange[];
}

// One row of GET /asset-classes — the defaults an asset is created from.' '  name: string;
}

// One asset class as Configuration > Depreciation shows it. usefulLifeMonths
// is what this company has adopted; scheduleIiLifeMonths is what the
// Companies Act prescribes. When they differ, lifePolicyNote is the Part A
// paragraph 3(i) justification and is required.
export interface DepreciationClassConfig {
  id: string;
  name: string;
  isActive: boolean;
  scheduleIiLifeMonths: number;
  usefulLifeMonths: number;
  lifePolicyNote: string | null;
  residualPct: number;
  assetAccount: { accountCode: string; accountName: string };
}

export type DepreciationFrequency = "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL";

export interface DepreciationPolicy {
  currentMethod: string;
  frequency: string;
  // Below this a capitalised line is expensed instead. Zero means no
  // threshold.
  capitalisationThreshold: number;
  // "YYYY-MM", or null when nothing has ever been depreciated. A change can
  // never take effect on or before this month.
  lastPostedChargeMonth: string | null;
  earliestEffectiveMonth: string;
  changes: DepreciationMethodChange[];
  classes: DepreciationClassConfig[];
}

// One row of GET /asset-classes — the defaults an asset is created from.'

Edit-FileText 'frontend/lib/api.ts' '  });
}

// Only works while the change is still in the future — once a month has been
// depreciated under it, it cannot be withdrawn.
export function withdrawDepreciationMethodChange(id: string) {' '  });
}

// Frequency and the capitalisation threshold. Neither is dated: a frequency
// change applies from the next unposted period, and the threshold only
// affects bills entered after it is set.
export function updateDepreciationConfig(body: { frequency?: string; capitalisationThreshold?: number }) {
  return request<{ data: unknown }>("/depreciation-policy", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// A class''s lives, residual and the justification for departing from the
// statute. Affects future assets only — every asset copies these at
// capitalisation.
export function updateDepreciationClass(id: string, body: {
  usefulLifeMonths?: number; scheduleIiLifeMonths?: number;
  lifePolicyNote?: string | null; residualPct?: number; isActive?: boolean;
}) {
  return request<{ data: { id: string } }>(`/depreciation-policy/classes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// Only works while the change is still in the future — once a month has been
// depreciated under it, it cannot be withdrawn.
export function withdrawDepreciationMethodChange(id: string) {'

Edit-FileText 'frontend/components/layout/navGroups.ts' '      { id: "business_partners", label: "Business Partners", path: "/accounting/business-partners", dot: "#0891b2", roles: ALL_ROLES },
      { id: "items", label: "Items", path: "/inventory/items", dot: "#0d9488", roles: ALL_ROLES },
      { id: "recurring_expenses", label: "Recurring Expenses", path: "/settings/recurring-expenses", dot: "#e11d48", roles: ["OWNER", "ADMIN", "ACCOUNTANT"], permission: "purchase.post" },
      { id: "branches", label: "Branches", path: "/settings/branches", dot: "#0284c7", roles: ["OWNER", "ADMIN"], permission: "branches.manage" },
      { id: "team", label: "Team", path: "/settings/team", dot: "#a855f7", roles: ["OWNER", "ADMIN"] },
      { id: "access_control", label: "Access Control", path: "/settings/access-control", dot: "#dc2626", roles: ["OWNER", "ADMIN"] },' '      { id: "business_partners", label: "Business Partners", path: "/accounting/business-partners", dot: "#0891b2", roles: ALL_ROLES },
      { id: "items", label: "Items", path: "/inventory/items", dot: "#0d9488", roles: ALL_ROLES },
      { id: "recurring_expenses", label: "Recurring Expenses", path: "/settings/recurring-expenses", dot: "#e11d48", roles: ["OWNER", "ADMIN", "ACCOUNTANT"], permission: "purchase.post" },
      { id: "depreciation", label: "Depreciation", path: "/settings/depreciation", dot: "#9333ea", roles: ["OWNER", "ADMIN"], permission: "company.manage" },
      { id: "branches", label: "Branches", path: "/settings/branches", dot: "#0284c7", roles: ["OWNER", "ADMIN"], permission: "branches.manage" },
      { id: "team", label: "Team", path: "/settings/team", dot: "#a855f7", roles: ["OWNER", "ADMIN"] },
      { id: "access_control", label: "Access Control", path: "/settings/access-control", dot: "#dc2626", roles: ["OWNER", "ADMIN"] },'

Edit-FileText 'frontend/components/layout/navGroups.ts' '      { id: "balance_sheet", label: "Balance Sheet", path: "/accounting/balance-sheet", dot: "#7c3aed", roles: ALL_ROLES },
      { id: "prepaid_schedules", label: "Prepaid Schedules", path: "/accounting/prepaid-schedules", dot: "#0d9488", roles: ALL_ROLES },
      { id: "amortization_due", label: "Amortization Due", path: "/accounting/amortization-due", dot: "#e11d48", roles: ["OWNER", "ADMIN", "ACCOUNTANT"], permission: "journal.post" },
      { id: "depreciation_policy", label: "Depreciation Policy", path: "/accounting/depreciation-policy", dot: "#9333ea", roles: ALL_ROLES },
    ],
  },
  {' '      { id: "balance_sheet", label: "Balance Sheet", path: "/accounting/balance-sheet", dot: "#7c3aed", roles: ALL_ROLES },
      { id: "prepaid_schedules", label: "Prepaid Schedules", path: "/accounting/prepaid-schedules", dot: "#0d9488", roles: ALL_ROLES },
      { id: "amortization_due", label: "Amortization Due", path: "/accounting/amortization-due", dot: "#e11d48", roles: ["OWNER", "ADMIN", "ACCOUNTANT"], permission: "journal.post" },
    ],
  },
  {'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '    return applicable ? applicable.toMethod : depPolicy.currentMethod;
  }

  function effectiveLife(l: DocumentLineInput, cls: AssetClassSummary): number {
    return Number(l.usefulLifeMonths || cls.defaultUsefulLifeMonths);
  }

  // Part A paragraph 3(i). The comparison is against what Schedule II
  // prescribes, never against the class''s own default — a class is editable
  // and the statute is not, so checking against the class would let someone
  // move the yardstick and then measure against it.
  //
  // The 2014 amendment made both directions equal in law. They are not equal
  // in risk: a longer life understates depreciation and overstates profit,
  // which is the direction an auditor probes. Hence two different warnings
  // rather than one.
  function lifeDeviation(l: DocumentLineInput): { text: string; severe: boolean } | null {
    const cls = assetClassById.get(String(l.assetClassId ?? ""));
    if (!cls) return null;
    const life = effectiveLife(l, cls);
    if (life === cls.scheduleIiLifeMonths) return null;
    return life > cls.scheduleIiLifeMonths
      ? {
          text: `Longer than the ${cls.scheduleIiLifeMonths} months Schedule II prescribes. This lowers the yearly charge and raises reported profit — it needs technical advice behind it, and will be disclosed.`,
          severe: true,
        }
      : {
          text: `Shorter than the ${cls.scheduleIiLifeMonths} months Schedule II prescribes. Permitted, and must still be disclosed with justification.`,
          severe: false,
        };
  }

  function capitalHint(l: DocumentLineInput): string {
    const cls = assetClassById.get(String(l.assetClassId ?? ""));' '    return applicable ? applicable.toMethod : depPolicy.currentMethod;
  }

  // No life or method control on the line any more. Both are policy — the
  // life per asset class, the method per company — set under Configuration >
  // Depreciation. What the line shows is the consequence of that policy for
  // this purchase, which is the part someone entering a bill needs to see.

  function capitalHint(l: DocumentLineInput): string {
    const cls = assetClassById.get(String(l.assetClassId ?? ""));'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '    if (!cls) return "Pick an asset class.";
    if (!(amount > 0)) return "Enter a quantity and rate.";
    if (!l.inUseDate) return "Set the date it was put to use.";
    const life = effectiveLife(l, cls);
    const residual = round2(amount * cls.defaultResidualPct / 100);
    const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const start = new Date(`${l.inUseDate}T00:00:00.000Z`);' '    if (!cls) return "Pick an asset class.";
    if (!(amount > 0)) return "Enter a quantity and rate.";
    if (!l.inUseDate) return "Set the date it was put to use.";
    const life = cls.defaultUsefulLifeMonths;
    const residual = round2(amount * cls.defaultResidualPct / 100);
    const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const start = new Date(`${l.inUseDate}T00:00:00.000Z`);'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '    // is that it cannot be missed by forgetting.
    const capital = canCapitalise && item?.itemKind === "SERVICE" && item?.defaultAssetClass
      ? { capitalise: true, assetClassId: item.defaultAssetClass.id, inUseDate: billDate }
      : { capitalise: false, assetClassId: undefined, assetName: undefined, inUseDate: undefined, usefulLifeMonths: undefined, usefulLifeNote: undefined };
    updateLine(i, {
      itemId,
      // Item master rates are always INR — only useful as a default when' '    // is that it cannot be missed by forgetting.
    const capital = canCapitalise && item?.itemKind === "SERVICE" && item?.defaultAssetClass
      ? { capitalise: true, assetClassId: item.defaultAssetClass.id, inUseDate: billDate }
      : { capitalise: false, assetClassId: undefined, assetName: undefined, inUseDate: undefined };
    updateLine(i, {
      itemId,
      // Item master rates are always INR — only useful as a default when'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '          // rejected by the server.
          .map((l) => (canCapitalise && l.capitalise && isServiceLine(l)
            ? l
            : { ...l, capitalise: undefined, assetClassId: undefined, assetName: undefined, inUseDate: undefined, usefulLifeMonths: undefined, usefulLifeNote: undefined })),
        currency, exchangeRate: isForeign ? Number(exchangeRate) : undefined,
        billOfEntryNumber: isForeign ? newBoeNumber || undefined : undefined,
        billOfEntryDate: isForeign ? newBoeDate || undefined : undefined,' '          // rejected by the server.
          .map((l) => (canCapitalise && l.capitalise && isServiceLine(l)
            ? l
            : { ...l, capitalise: undefined, assetClassId: undefined, assetName: undefined, inUseDate: undefined })),
        currency, exchangeRate: isForeign ? Number(exchangeRate) : undefined,
        billOfEntryNumber: isForeign ? newBoeNumber || undefined : undefined,
        billOfEntryDate: isForeign ? newBoeDate || undefined : undefined,'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '                                disabled={!!line.prepaid}
                                onChange={(e) => updateLine(i, e.target.checked
                                  ? { capitalise: true, assetClassId: line.assetClassId || "", inUseDate: line.inUseDate || billDate }
                                  : { capitalise: false, assetClassId: undefined, assetName: undefined, inUseDate: undefined, usefulLifeMonths: undefined, usefulLifeNote: undefined })}
                              />
                              Capitalise this line
                            </label>' '                                disabled={!!line.prepaid}
                                onChange={(e) => updateLine(i, e.target.checked
                                  ? { capitalise: true, assetClassId: line.assetClassId || "", inUseDate: line.inUseDate || billDate }
                                  : { capitalise: false, assetClassId: undefined, assetName: undefined, inUseDate: undefined })}
                              />
                              Capitalise this line
                            </label>'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '                                  value={line.inUseDate ?? ""}
                                  onChange={(e) => updateLine(i, { inUseDate: e.target.value })}
                                />
                                <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                                  <input
                                    type="number" min={1} max={1200} step={1} className="ent-fc" style={{ width: 70 }}
                                    title="Useful life in months"
                                    placeholder="months"
                                    value={line.usefulLifeMonths ?? assetClassById.get(String(line.assetClassId))?.defaultUsefulLifeMonths ?? ""}
                                    onChange={(e) => updateLine(i, { usefulLifeMonths: Number(e.target.value) })}
                                  />
                                  {/* Shown, not chosen. The method is the
                                      company''s policy — one method for the
                                      whole entity, disclosed once. */}
                                  <span style={{ fontSize: 11.5, color: "var(--color-muted)" }}>
                                    months · {methodForMonth(String(line.inUseDate).slice(0, 7)) === "WDV" ? "written-down value" : "straight line"}
                                  </span>
                                </div>
                                {lifeDeviation(line) && (
                                  <>
                                    <div style={{
                                      fontSize: 11.5, marginTop: 6, padding: "5px 7px", borderRadius: 4,
                                      background: lifeDeviation(line)!.severe ? "#fef3c7" : "#f1f5f9",
                                      color: lifeDeviation(line)!.severe ? "#92400e" : "#475569",
                                    }}>
                                      {lifeDeviation(line)!.text}
                                    </div>
                                    <textarea
                                      className="ent-fc" style={{ width: "100%", marginTop: 6, height: 46, padding: 6 }}
                                      placeholder="Justification, supported by technical advice — required"
                                      maxLength={500}
                                      value={line.usefulLifeNote ?? ""}
                                      onChange={(e) => updateLine(i, { usefulLifeNote: e.target.value })}
                                    />
                                  </>
                                )}
                                {/* Depreciation runs from the date the asset was
                                    put to use, not the date it was bought —
                                    Schedule II charges "on a pro rata basis from' '                                  value={line.inUseDate ?? ""}
                                  onChange={(e) => updateLine(i, { inUseDate: e.target.value })}
                                />
                                {/* Shown, never chosen. Life belongs to the
                                    asset class and method to the company —
                                    both under Configuration > Depreciation. */}
                                <div style={{ fontSize: 11.5, color: "var(--color-muted)", marginTop: 6 }}>
                                  {assetClassById.get(String(line.assetClassId))?.defaultUsefulLifeMonths ?? "—"} months
                                  {" · "}
                                  {methodForMonth(String(line.inUseDate).slice(0, 7)) === "WDV" ? "written-down value" : "straight line"}
                                </div>
                                {/* Depreciation runs from the date the asset was
                                    put to use, not the date it was bought —
                                    Schedule II charges "on a pro rata basis from'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green