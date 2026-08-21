$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Method, life and justification on the line...' -ForegroundColor Cyan

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

Edit-FileText 'frontend/lib/types.ts' '  inUseDate?: string;
  // Schedule II allows a justified departure from the class''s default life.
  usefulLifeMonths?: number;
}

// One row of GET /asset-classes — the defaults an asset is created from.' '  inUseDate?: string;
  // Schedule II allows a justified departure from the class''s default life.
  usefulLifeMonths?: number;
  // "SLM" or "WDV". Schedule II prescribes lives, not methods. Omitted means
  // the class''s default. WDV needs a residual above zero.
  method?: string;
  // Part A paragraph 3(i): a life differing from the PRESCRIBED one — longer
  // or shorter — must be disclosed and justified with technical advice.
  usefulLifeNote?: string;
}

// One row of GET /asset-classes — the defaults an asset is created from.'

Edit-FileText 'frontend/lib/types.ts' '  name: string;
  isActive: boolean;
  defaultUsefulLifeMonths: number;
  defaultMethod: string;
  defaultResidualPct: number;
  assetAccount: { id: string; accountCode: string; accountName: string };' '  name: string;
  isActive: boolean;
  defaultUsefulLifeMonths: number;
  // What Schedule II prescribes, as against what this org''s class says. A
  // deviation is measured against this one, never the editable default.
  scheduleIiLifeMonths: number;
  defaultMethod: string;
  defaultResidualPct: number;
  assetAccount: { id: string; accountCode: string; accountName: string };'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '  // the same job prepaidHint does. Mirrors the server: residual is a
  // percentage of cost, and the depreciable base is spread evenly over the
  // life in months.
  function capitalHint(l: DocumentLineInput): string {
    const cls = assetClassById.get(String(l.assetClassId ?? ""));
    const amount = round2(Number(l.quantity) * Number(l.rate));
    if (!cls) return "Pick an asset class.";
    if (!(amount > 0)) return "Enter a quantity and rate.";
    if (!l.inUseDate) return "Set the date it was put to use.";
    const life = Number(l.usefulLifeMonths || cls.defaultUsefulLifeMonths);
    const residual = round2(amount * cls.defaultResidualPct / 100);
    const base = round2(amount - residual);
    const perMonth = base / life;
    const start = new Date(`${l.inUseDate}T00:00:00.000Z`);
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + life - 1, 1));
    const endLabel = isNaN(end.getTime())
      ? ""
      : end.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
    const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${fmt(base)} over ${life} months · ${fmt(perMonth)} / month${endLabel ? ` · ends ${endLabel}` : ""}`;
  }

  // What the schedule will actually do, spelled out before it is committed.' '  // the same job prepaidHint does. Mirrors the server: residual is a
  // percentage of cost, and the depreciable base is spread evenly over the
  // life in months.
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
    const cls = assetClassById.get(String(l.assetClassId ?? ""));
    const amount = round2(Number(l.quantity) * Number(l.rate));
    if (!cls) return "Pick an asset class.";
    if (!(amount > 0)) return "Enter a quantity and rate.";
    if (!l.inUseDate) return "Set the date it was put to use.";
    const life = effectiveLife(l, cls);
    const residual = round2(amount * cls.defaultResidualPct / 100);
    const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const start = new Date(`${l.inUseDate}T00:00:00.000Z`);
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + life - 1, 1));
    const endLabel = isNaN(end.getTime())
      ? ""
      : end.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });

    if (String(l.method || cls.defaultMethod).toUpperCase() === "WDV") {
      // The rate is derived from the life and residual rather than
      // prescribed: after `life` months at this rate the balance is exactly
      // the residual, which is the same place straight line lands.
      if (!(residual > 0)) return "Written-down value needs a residual above zero — this class has none.";
      const rate = 1 - Math.pow(residual / amount, 1 / life);
      return `${fmt(amount * rate)} in the first month, declining · ${fmt(residual)} left after ${life} months${endLabel ? ` · ends ${endLabel}` : ""}`;
    }
    const base = round2(amount - residual);
    return `${fmt(base)} over ${life} months · ${fmt(base / life)} / month${endLabel ? ` · ends ${endLabel}` : ""}`;
  }

  // What the schedule will actually do, spelled out before it is committed.'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '          // rejected by the server.
          .map((l) => (canCapitalise && l.capitalise && isServiceLine(l)
            ? l
            : { ...l, capitalise: undefined, assetClassId: undefined, assetName: undefined, inUseDate: undefined, usefulLifeMonths: undefined })),
        currency, exchangeRate: isForeign ? Number(exchangeRate) : undefined,
        billOfEntryNumber: isForeign ? newBoeNumber || undefined : undefined,
        billOfEntryDate: isForeign ? newBoeDate || undefined : undefined,' '          // rejected by the server.
          .map((l) => (canCapitalise && l.capitalise && isServiceLine(l)
            ? l
            : { ...l, capitalise: undefined, assetClassId: undefined, assetName: undefined, inUseDate: undefined, usefulLifeMonths: undefined, method: undefined, usefulLifeNote: undefined })),
        currency, exchangeRate: isForeign ? Number(exchangeRate) : undefined,
        billOfEntryNumber: isForeign ? newBoeNumber || undefined : undefined,
        billOfEntryDate: isForeign ? newBoeDate || undefined : undefined,'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '                                disabled={!!line.prepaid}
                                onChange={(e) => updateLine(i, e.target.checked
                                  ? { capitalise: true, assetClassId: line.assetClassId || "", inUseDate: line.inUseDate || billDate }
                                  : { capitalise: false, assetClassId: undefined, assetName: undefined, inUseDate: undefined, usefulLifeMonths: undefined })}
                              />
                              Capitalise this line
                            </label>' '                                disabled={!!line.prepaid}
                                onChange={(e) => updateLine(i, e.target.checked
                                  ? { capitalise: true, assetClassId: line.assetClassId || "", inUseDate: line.inUseDate || billDate }
                                  : { capitalise: false, assetClassId: undefined, assetName: undefined, inUseDate: undefined, usefulLifeMonths: undefined, method: undefined, usefulLifeNote: undefined })}
                              />
                              Capitalise this line
                            </label>'

Edit-FileText 'frontend/app/purchase/bills/page.tsx' '                                  value={line.inUseDate ?? ""}
                                  onChange={(e) => updateLine(i, { inUseDate: e.target.value })}
                                />
                                {/* Depreciation runs from the date the asset was
                                    put to use, not the date it was bought —
                                    Schedule II charges "on a pro rata basis from' '                                  value={line.inUseDate ?? ""}
                                  onChange={(e) => updateLine(i, { inUseDate: e.target.value })}
                                />
                                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                                  <select
                                    className="ent-fc" style={{ flex: "1 1 90px" }}
                                    value={line.method ?? assetClassById.get(String(line.assetClassId))?.defaultMethod ?? "SLM"}
                                    onChange={(e) => updateLine(i, { method: e.target.value })}
                                  >
                                    <option value="SLM">Straight line</option>
                                    <option value="WDV">Written-down value</option>
                                  </select>
                                  <input
                                    type="number" min={1} max={1200} step={1} className="ent-fc" style={{ width: 70 }}
                                    title="Useful life in months"
                                    placeholder="months"
                                    value={line.usefulLifeMonths ?? assetClassById.get(String(line.assetClassId))?.defaultUsefulLifeMonths ?? ""}
                                    onChange={(e) => updateLine(i, { usefulLifeMonths: Number(e.target.value) })}
                                  />
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
                                    Schedule II charges "on a pro rata basis from'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green