$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
Write-Host 'Asset class editor: a modal, with the method in it...' -ForegroundColor Cyan

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

Edit-FileText 'frontend/app/settings/depreciation/page.tsx' '  const [classLife, setClassLife] = useState("");
  const [classStatutory, setClassStatutory] = useState("");
  const [classResidual, setClassResidual] = useState("");
  const [classNote, setClassNote] = useState("");

  async function load() {
    setLoading(true);
    try {
' '  const [classLife, setClassLife] = useState("");
  const [classStatutory, setClassStatutory] = useState("");
  const [classResidual, setClassResidual] = useState("");
  const [classNote, setClassNote] = useState("");
  const [classMethod, setClassMethod] = useState("SLM");
  const [classMethodMonth, setClassMethodMonth] = useState("");
  const [classMethodReason, setClassMethodReason] = useState("");

  async function load() {
    setLoading(true);
    try {
'

Edit-FileText 'frontend/app/settings/depreciation/page.tsx' '    setClassLife(String(c.usefulLifeMonths));
    setClassStatutory(String(c.scheduleIiLifeMonths));
    setClassResidual(String(c.residualPct));
    setClassNote(c.lifePolicyNote ?? "");
    setError(null);
  }

  const classDeviates = Number(classLife) !== Number(classStatutory);

  return (
    <AppShell>
      <div className="ent-page-hdr">
' '    setClassLife(String(c.usefulLifeMonths));
    setClassStatutory(String(c.scheduleIiLifeMonths));
    setClassResidual(String(c.residualPct));
    setClassNote(c.lifePolicyNote ?? "");
    setClassMethod(c.method);
    setClassMethodMonth(policy?.earliestEffectiveMonth ?? "");
    setClassMethodReason("");
    setError(null);
  }

  const classDeviates = Number(classLife) !== Number(classStatutory);
  // Only a real change asks for a date and a reason. Opening the editor and
  // saving without touching the method must not demand a disclosure for a
  // change that did not happen.
  const methodChanged = !!editingClass && classMethod !== editingClass.method;

  return (
    <AppShell>
      <div className="ent-page-hdr">
'

Edit-FileText 'frontend/app/settings/depreciation/page.tsx' '                        {c.usefulLifeMonths} mo
                      </td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.residualPct}%</td>
                      <td style={{ fontSize: 12 }}>
                        {METHOD_LABEL[c.method] ?? c.method}
                        {c.differsFromCompany && (
                          <div style={{ color: "#6d28d9", fontSize: 11.5 }}>its own, not the company&rsquo;s</div>
                        )}
                      </td>
' '                        {c.usefulLifeMonths} mo
                      </td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.residualPct}%</td>
                      <td style={{ fontSize: 12 }}>
                        {/* The code, not the sentence. In a table of twelve
                            classes "Written-down value" is a column of noise;
                            anyone reading this screen knows what WDV is. The
                            full wording stays where it is read once — the
                            policy header and the change history. */}
                        {c.method}
                        {c.differsFromCompany && (
                          <div style={{ color: "#6d28d9", fontSize: 11.5 }}>its own, not the company&rsquo;s</div>
                        )}
                      </td>
'

Edit-FileText 'frontend/app/settings/depreciation/page.tsx' '            </div>
          </div>

          {editingClass && (
            <div className="ent-section" style={{ marginBottom: 16 }}>
              <div className="ent-section-hdr" style={{ borderRadius: "6px 6px 0 0" }}>
                <span className="ent-section-title">{editingClass.name}</span>
              </div>
              <div style={{ padding: 14 }}>
                <div className="ent-form-grid">
                  <div className="ent-fg">
                    <span className="ent-fl">Schedule II life (months)</span>
                    <input type="number" min={1} max={1200} className="ent-fc" value={classStatutory} onChange={(e) => setClassStatutory(e.target.value)} />
                    <span style={muted}>Change this only when the Companies Act itself changes.</span>
                  </div>
                  <div className="ent-fg">
                    <span className="ent-fl">Adopted life (months)</span>
                    <input type="number" min={1} max={1200} className="ent-fc" value={classLife} onChange={(e) => setClassLife(e.target.value)} />
                    <span style={muted}>What this company actually depreciates over.</span>
                  </div>
                  <div className="ent-fg">
                    <span className="ent-fl">Residual %</span>
                    <input type="number" min={0} max={99.99} step="0.01" className="ent-fc" value={classResidual} onChange={(e) => setClassResidual(e.target.value)} />
                    <span style={muted}>
                      5% is the Schedule II ceiling, not a requirement. Affects future purchases only.
                    </span>
                  </div>
                </div>
                {classDeviates && (
                  <div className="ent-fg" style={{ marginTop: 10 }}>
                    <span className="ent-fl">Justification (required)</span>
                    <textarea
                      className="ent-fc" style={{ height: 62, padding: 8, width: "100%" }}
                      maxLength={500}
                      placeholder="What supports this life — a technical assessment, a manufacturer''s estimate, a board policy"
                      value={classNote}
                      onChange={(e) => setClassNote(e.target.value)}
                    />
                    <span style={{ ...muted, color: Number(classLife) > Number(classStatutory) ? "#b45309" : undefined }}>
                      {Number(classLife) > Number(classStatutory)
                        ? "Longer than Schedule II. This lowers the yearly charge and raises reported profit — expect it to be questioned."
                        : "Shorter than Schedule II. Permitted, and still disclosed."}
                    </span>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button
                    type="button" className="ent-btn-add"
                    disabled={saving || (classDeviates && !classNote.trim())}
                    onClick={async () => {
                      const ok = await run(() => updateDepreciationClass(editingClass.id, {
                        usefulLifeMonths: Number(classLife),
                        scheduleIiLifeMonths: Number(classStatutory),
                        residualPct: Number(classResidual),
                        lifePolicyNote: classNote.trim() || null,
                      }));
                      if (ok) setEditingClass(null);
                    }}
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button type="button" className="ent-btn-cancel" onClick={() => { setEditingClass(null); setError(null); }}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
' '            </div>
          </div>

          {editingClass && (
            <div
              onClick={() => { setEditingClass(null); setError(null); }}
              style={{
                position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)",
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: 20, zIndex: 60,
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: "var(--color-surface)", borderRadius: 8,
                  width: "min(720px, 100%)", maxHeight: "88vh", overflow: "auto",
                  boxShadow: "0 12px 40px rgba(15,23,42,0.25)",
                }}
              >
                <div className="ent-section-hdr" style={{ borderRadius: "8px 8px 0 0" }}>
                  <span className="ent-section-title">{editingClass.name}</span>
                  <button type="button" className="ent-btn-cancel" onClick={() => { setEditingClass(null); setError(null); }}>Close</button>
                </div>
                <div style={{ padding: 14 }}>
                  {error && <p style={{ color: "#dc2626", fontSize: 13, marginTop: 0 }}>{error}</p>}
                  <div className="ent-form-grid">
                    <div className="ent-fg">
                      <span className="ent-fl">Schedule II life (months)</span>
                      <input type="number" min={1} max={1200} className="ent-fc" value={classStatutory} onChange={(e) => setClassStatutory(e.target.value)} />
                      <span style={muted}>Change this only when the Companies Act itself changes.</span>
                    </div>
                    <div className="ent-fg">
                      <span className="ent-fl">Adopted life (months)</span>
                      <input type="number" min={1} max={1200} className="ent-fc" value={classLife} onChange={(e) => setClassLife(e.target.value)} />
                      <span style={muted}>What this company actually depreciates over.</span>
                    </div>
                    <div className="ent-fg">
                      <span className="ent-fl">Residual %</span>
                      <input type="number" min={0} max={99.99} step="0.01" className="ent-fc" value={classResidual} onChange={(e) => setClassResidual(e.target.value)} />
                      <span style={muted}>
                        5% is the Schedule II ceiling, not a requirement. Affects future purchases only.
                      </span>
                    </div>
                    <div className="ent-fg">
                      <span className="ent-fl">Method</span>
                      <select className="ent-fc" value={classMethod} onChange={(e) => setClassMethod(e.target.value)}>
                        <option value="SLM">SLM — straight line</option>
                        <option value="WDV">WDV — written-down value</option>
                      </select>
                      <span style={muted}>
                        {editingClass.differsFromCompany
                          ? "This class carries its own method."
                          : `Currently following the company (${policy.currentMethod}).`}
                      </span>
                    </div>
                  </div>

                  {classDeviates && (
                    <div className="ent-fg" style={{ marginTop: 10 }}>
                      <span className="ent-fl">Justification for the life (required)</span>
                      <textarea
                        className="ent-fc" style={{ height: 62, padding: 8, width: "100%" }}
                        maxLength={500}
                        placeholder="What supports this life — a technical assessment, a manufacturer''s estimate, a board policy"
                        value={classNote}
                        onChange={(e) => setClassNote(e.target.value)}
                      />
                      <span style={{ ...muted, color: Number(classLife) > Number(classStatutory) ? "#b45309" : undefined }}>
                        {Number(classLife) > Number(classStatutory)
                          ? "Longer than Schedule II. This lowers the yearly charge and raises reported profit — expect it to be questioned."
                          : "Shorter than Schedule II. Permitted, and still disclosed."}
                      </span>
                    </div>
                  )}

                  {/* A method change is dated and disclosed wherever it is made
                      — the same obligation as a company-wide one. So changing
                      it here asks for the same two things rather than quietly
                      recording a different kind of change. */}
                  {methodChanged && (
                    <div style={{ marginTop: 12, padding: 12, borderRadius: 6, background: "#f5f3ff" }}>
                      <p style={{ ...muted, marginTop: 0, lineHeight: 1.5 }}>
                        Changing {editingClass.name} from {editingClass.method} to {classMethod} is a change in
                        accounting <strong>estimate</strong> — it applies from the month you choose onward, to assets
                        already capitalised under this class as well as new ones, and nothing posted is restated.
                      </p>
                      <div className="ent-form-grid">
                        <div className="ent-fg">
                          <span className="ent-fl">Effective from</span>
                          <input
                            type="month" className="ent-fc"
                            min={policy.earliestEffectiveMonth}
                            value={classMethodMonth}
                            onChange={(e) => setClassMethodMonth(e.target.value)}
                          />
                          <span style={muted}>{policy.earliestEffectiveMonth} at the earliest</span>
                        </div>
                      </div>
                      <div className="ent-fg" style={{ marginTop: 10 }}>
                        <span className="ent-fl">Reason (required)</span>
                        <textarea
                          className="ent-fc" style={{ height: 56, padding: 8, width: "100%" }}
                          maxLength={500}
                          placeholder="What changed in the expected pattern of consumption, and what supports it"
                          value={classMethodReason}
                          onChange={(e) => setClassMethodReason(e.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                    <button
                      type="button" className="ent-btn-add"
                      disabled={saving
                        || (classDeviates && !classNote.trim())
                        || (methodChanged && !classMethodReason.trim())}
                      onClick={async () => {
                        const cls = editingClass;
                        const ok = await run(async () => {
                          await updateDepreciationClass(cls.id, {
                            usefulLifeMonths: Number(classLife),
                            scheduleIiLifeMonths: Number(classStatutory),
                            residualPct: Number(classResidual),
                            lifePolicyNote: classNote.trim() || null,
                          });
                          if (classMethod !== cls.method) {
                            await changeDepreciationMethod({
                              toMethod: classMethod,
                              effectiveMonth: classMethodMonth,
                              reason: classMethodReason,
                              assetClassId: cls.id,
                            });
                          }
                        });
                        if (ok) setEditingClass(null);
                      }}
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                    <button type="button" className="ent-btn-cancel" onClick={() => { setEditingClass(null); setError(null); }}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
'

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green