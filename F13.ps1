$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Class-level method: types, API, screen...' -ForegroundColor Cyan

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

Edit-FileText 'frontend/lib/types.ts' '// change in estimate is disclosable.
export interface DepreciationMethodChange {
  id: string;
  fromMethod: string;
  toMethod: string;
  // "YYYY-MM" — the first month the new method applies to.' '// change in estimate is disclosable.
export interface DepreciationMethodChange {
  id: string;
  // null means the change applies company-wide; a class means it applies to
  // that class alone, which then keeps its method when the company changes.
  assetClass: { id: string; name: string } | null;
  fromMethod: string;
  toMethod: string;
  // "YYYY-MM" — the first month the new method applies to.'

Edit-FileText 'frontend/lib/types.ts' '  lifePolicyNote: string | null;
  residualPct: number;
  assetAccount: { accountCode: string; accountName: string };
}

export type DepreciationFrequency = "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL";' '  lifePolicyNote: string | null;
  residualPct: number;
  assetAccount: { accountCode: string; accountName: string };
  // What this class depreciates on today — its own method where it has one,
  // otherwise the company''s.
  method: string;
  differsFromCompany: boolean;
}

export type DepreciationFrequency = "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL";'

Edit-FileText 'frontend/lib/api.ts' '
// effectiveMonth is "YYYY-MM". The reason is required: it is what the
// disclosure of the change in estimate gets written from.
export function changeDepreciationMethod(body: { toMethod: string; effectiveMonth: string; reason: string }) {
  return request<{ data: { id: string } }>("/depreciation-policy/change", {
    method: "POST",
    body: JSON.stringify(body),' '
// effectiveMonth is "YYYY-MM". The reason is required: it is what the
// disclosure of the change in estimate gets written from.
export function changeDepreciationMethod(body: {
  toMethod: string; effectiveMonth: string; reason: string;
  // Omit for a company-wide change; pass a class id to scope it to that
  // class, which then keeps its method when the company changes.
  assetClassId?: string;
}) {
  return request<{ data: { id: string } }>("/depreciation-policy/change", {
    method: "POST",
    body: JSON.stringify(body),'

Edit-FileText 'frontend/app/settings/depreciation/page.tsx' '//
// The division of labour is the thing to hold on to. Schedule II prescribes
// useful LIVES, per class of asset — so the life sits on the class. It says
// nothing about METHOD, which is therefore the company''s own policy, one for
// the whole entity. Frequency and the capitalisation threshold are pure
// policy with no statutory dimension at all.
//
// Nothing here is retrospective. Every asset copies its life, residual,' '//
// The division of labour is the thing to hold on to. Schedule II prescribes
// useful LIVES, per class of asset — so the life sits on the class. It says
// nothing about METHOD, which is therefore the company''s own choice: usually
// one method for the whole entity, but a company may set a class''s method
// separately — plant on WDV, buildings on SLM — provided the policy note
// discloses which. Frequency and the capitalisation threshold are pure
// policy with no statutory dimension at all.
//
// Nothing here is retrospective. Every asset copies its life, residual,'

Edit-FileText 'frontend/app/settings/depreciation/page.tsx' '
  const [showMethodForm, setShowMethodForm] = useState(false);
  const [toMethod, setToMethod] = useState("WDV");
  const [effectiveMonth, setEffectiveMonth] = useState("");
  const [reason, setReason] = useState("");
' '
  const [showMethodForm, setShowMethodForm] = useState(false);
  const [toMethod, setToMethod] = useState("WDV");
  // "" is company-wide. Most companies use one method throughout, but a
  // company may depreciate plant on WDV and buildings on SLM provided the
  // policy note discloses which.
  const [methodScope, setMethodScope] = useState("");
  const [effectiveMonth, setEffectiveMonth] = useState("");
  const [reason, setReason] = useState("");
'

Edit-FileText 'frontend/app/settings/depreciation/page.tsx' '                </p>
                <div className="ent-form-grid">
                  <div className="ent-fg">
                    <span className="ent-fl">Change to</span>
                    <select className="ent-fc" value={toMethod} onChange={(e) => setToMethod(e.target.value)}>
                      <option value="SLM">Straight line</option>' '                </p>
                <div className="ent-form-grid">
                  <div className="ent-fg">
                    <span className="ent-fl">Applies to</span>
                    <select className="ent-fc" value={methodScope} onChange={(e) => setMethodScope(e.target.value)}>
                      <option value="">The whole company</option>
                      {policy.classes.map((c) => (
                        <option key={c.id} value={c.id}>{c.name} only</option>
                      ))}
                    </select>
                    <span style={muted}>
                      {methodScope
                        ? "This class keeps its own method afterwards, even when the company''s changes."
                        : "Every class that has not been given a method of its own."}
                    </span>
                  </div>
                  <div className="ent-fg">
                    <span className="ent-fl">Change to</span>
                    <select className="ent-fc" value={toMethod} onChange={(e) => setToMethod(e.target.value)}>
                      <option value="SLM">Straight line</option>'

Edit-FileText 'frontend/app/settings/depreciation/page.tsx' '                  <button
                    type="button" className="ent-btn-add" disabled={saving || !reason.trim()}
                    onClick={async () => {
                      const ok = await run(() => changeDepreciationMethod({ toMethod, effectiveMonth, reason }));
                      if (ok) { setShowMethodForm(false); setReason(""); }
                    }}
                  >
                    {saving ? "Recording…" : "Record the change"}' '                  <button
                    type="button" className="ent-btn-add" disabled={saving || !reason.trim()}
                    onClick={async () => {
                      const ok = await run(() => changeDepreciationMethod({
                        toMethod, effectiveMonth, reason,
                        assetClassId: methodScope || undefined,
                      }));
                      if (ok) { setShowMethodForm(false); setReason(""); setMethodScope(""); }
                    }}
                  >
                    {saving ? "Recording…" : "Record the change"}'

Edit-FileText 'frontend/app/settings/depreciation/page.tsx' '                    <th style={{ textAlign: "right", width: 110 }}>Schedule II</th>
                    <th style={{ textAlign: "right", width: 110 }}>Adopted</th>
                    <th style={{ textAlign: "right", width: 90 }}>Residual</th>
                    <th>Justification</th>
                    <th style={{ width: 70 }} />
                  </tr>' '                    <th style={{ textAlign: "right", width: 110 }}>Schedule II</th>
                    <th style={{ textAlign: "right", width: 110 }}>Adopted</th>
                    <th style={{ textAlign: "right", width: 90 }}>Residual</th>
                    <th style={{ width: 130 }}>Method</th>
                    <th>Justification</th>
                    <th style={{ width: 70 }} />
                  </tr>'

Edit-FileText 'frontend/app/settings/depreciation/page.tsx' '                        {c.usefulLifeMonths} mo
                      </td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.residualPct}%</td>
                      <td style={{ fontSize: 12, color: "var(--color-muted)" }}>{c.lifePolicyNote ?? "—"}</td>
                      <td style={{ textAlign: "right" }}>
                        <button type="button" className="ent-ia ent-ia-edit" onClick={() => openClass(c)}>Edit</button>' '                        {c.usefulLifeMonths} mo
                      </td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.residualPct}%</td>
                      <td style={{ fontSize: 12 }}>
                        {METHOD_LABEL[c.method] ?? c.method}
                        {c.differsFromCompany && (
                          <div style={{ color: "#6d28d9", fontSize: 11.5 }}>its own, not the company&rsquo;s</div>
                        )}
                      </td>
                      <td style={{ fontSize: 12, color: "var(--color-muted)" }}>{c.lifePolicyNote ?? "—"}</td>
                      <td style={{ textAlign: "right" }}>
                        <button type="button" className="ent-ia ent-ia-edit" onClick={() => openClass(c)}>Edit</button>'

Edit-FileText 'frontend/app/settings/depreciation/page.tsx' '              <thead>
                <tr>
                  <th style={{ width: 170 }}>Effective from</th>
                  <th style={{ width: 220 }}>Change</th>
                  <th>Reason</th>
                  <th style={{ width: 110 }} />' '              <thead>
                <tr>
                  <th style={{ width: 170 }}>Effective from</th>
                  <th style={{ width: 180 }}>Applies to</th>
                  <th style={{ width: 220 }}>Change</th>
                  <th>Reason</th>
                  <th style={{ width: 110 }} />'

Edit-FileText 'frontend/app/settings/depreciation/page.tsx' '              </thead>
              <tbody>
                {policy.changes.length === 0 && (
                  <tr><td colSpan={4} className="ent-empty">
                    The method has never changed. Everything has depreciated on{" "}
                    {(METHOD_LABEL[policy.currentMethod] ?? policy.currentMethod).toLowerCase()} since the beginning.
                  </td></tr>' '              </thead>
              <tbody>
                {policy.changes.length === 0 && (
                  <tr><td colSpan={5} className="ent-empty">
                    The method has never changed. Everything has depreciated on{" "}
                    {(METHOD_LABEL[policy.currentMethod] ?? policy.currentMethod).toLowerCase()} since the beginning.
                  </td></tr>'

Edit-FileText 'frontend/app/settings/depreciation/page.tsx' '                      <td style={{ fontWeight: 500 }}>
                        {monthLabel(c.effectiveMonth)}
                        {pending && <div><span className="badge badge-yellow">Not yet in effect</span></div>}
                      </td>
                      <td style={{ color: "var(--color-muted)" }}>
                        {METHOD_LABEL[c.fromMethod] ?? c.fromMethod} → {METHOD_LABEL[c.toMethod] ?? c.toMethod}' '                      <td style={{ fontWeight: 500 }}>
                        {monthLabel(c.effectiveMonth)}
                        {pending && <div><span className="badge badge-yellow">Not yet in effect</span></div>}
                      </td>
                      <td style={{ fontSize: 12.5 }}>
                        {c.assetClass ? c.assetClass.name : <span style={{ color: "var(--color-muted)" }}>The whole company</span>}
                      </td>
                      <td style={{ color: "var(--color-muted)" }}>
                        {METHOD_LABEL[c.fromMethod] ?? c.fromMethod} → {METHOD_LABEL[c.toMethod] ?? c.toMethod}'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green