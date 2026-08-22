"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import {
  ApiError, changeDepreciationMethod, getDepreciationPolicy,
  updateDepreciationClass, updateDepreciationConfig, withdrawDepreciationMethodChange,
} from "@/lib/api";
import type { DepreciationClassConfig, DepreciationPolicy } from "@/lib/types";

// Configuration > Depreciation. How this company depreciates, in one place.
//
// The division of labour is the thing to hold on to. Schedule II prescribes
// useful LIVES, per class of asset — so the life sits on the class. It says
// nothing about METHOD, which is therefore the company's own choice: usually
// one method for the whole entity, but a company may set a class's method
// separately — plant on WDV, buildings on SLM — provided the policy note
// discloses which. Frequency and the capitalisation threshold are pure
// policy with no statutory dimension at all.
//
// Nothing here is retrospective. Every asset copies its life, residual,
// method and accounts at capitalisation, so editing a class changes what
// future assets do and can never re-rate one already half depreciated. A
// method change applies from a stated month forward.

const METHOD_LABEL: Record<string, string> = {
  SLM: "Straight line",
  WDV: "Written-down value",
};

const FREQUENCY_LABEL: Record<string, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  HALF_YEARLY: "Half-yearly",
  ANNUAL: "Annual",
};

function monthLabel(ym: string): string {
  const d = new Date(`${ym}-01T00:00:00Z`);
  return isNaN(d.getTime())
    ? ym
    : d.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function DepreciationConfigPage() {
  const [policy, setPolicy] = useState<DepreciationPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [frequency, setFrequency] = useState("MONTHLY");
  const [threshold, setThreshold] = useState("0");

  const [showMethodForm, setShowMethodForm] = useState(false);
  const [toMethod, setToMethod] = useState("WDV");
  // "" is company-wide. Most companies use one method throughout, but a
  // company may depreciate plant on WDV and buildings on SLM provided the
  // policy note discloses which.
  const [methodScope, setMethodScope] = useState("");
  const [effectiveMonth, setEffectiveMonth] = useState("");
  const [reason, setReason] = useState("");

  const [editingClass, setEditingClass] = useState<DepreciationClassConfig | null>(null);
  const [classLife, setClassLife] = useState("");
  const [classStatutory, setClassStatutory] = useState("");
  const [classResidual, setClassResidual] = useState("");
  const [classNote, setClassNote] = useState("");
  const [classMethod, setClassMethod] = useState("SLM");
  const [classMethodMonth, setClassMethodMonth] = useState("");
  const [classMethodReason, setClassMethodReason] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await getDepreciationPolicy();
      setPolicy(res.data);
      setFrequency(res.data.frequency);
      setThreshold(String(res.data.capitalisationThreshold));
      setToMethod(res.data.currentMethod === "SLM" ? "WDV" : "SLM");
      setEffectiveMonth(res.data.earliestEffectiveMonth);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the depreciation configuration.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const thisMonth = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const muted = { color: "var(--color-muted)", fontSize: 12 } as const;

  async function run(fn: () => Promise<unknown>) {
    setSaving(true);
    setError(null);
    try {
      await fn();
      await load();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't work.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function openClass(c: DepreciationClassConfig) {
    setEditingClass(c);
    setClassLife(String(c.usefulLifeMonths));
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
        <h1>Depreciation</h1>
        <p>
          How this company depreciates. Useful lives come from Schedule II and sit on each asset
          class; the method, frequency and threshold are your own policy. Nothing here changes an
          asset already capitalised.
        </p>
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {loading && <p style={muted}>Loading…</p>}

      {policy && (
        <>
          <div className="ent-section" style={{ marginBottom: 16 }}>
            <div className="ent-section-hdr" style={{ borderRadius: "6px 6px 0 0" }}>
              <span className="ent-section-title">Policy</span>
              {!showMethodForm && (
                <button type="button" className="ent-btn-add" onClick={() => setShowMethodForm(true)}>
                  Change method
                </button>
              )}
            </div>
            <div className="ent-form-grid" style={{ padding: 14 }}>
              <div className="ent-fg">
                <span className="ent-fl">Method in force</span>
                <div style={{ fontSize: 18 }}>{METHOD_LABEL[policy.currentMethod] ?? policy.currentMethod}</div>
                <span style={muted}>
                  Schedule II prescribes lives, not methods — this is the company&rsquo;s own policy, and it
                  is disclosed in the accounting policies.
                </span>
              </div>

              <div className="ent-fg">
                <span className="ent-fl">Depreciated up to</span>
                <div style={{ fontSize: 18 }}>
                  {policy.lastPostedChargeMonth ? monthLabel(policy.lastPostedChargeMonth) : "—"}
                </div>
                <span style={muted}>
                  {policy.lastPostedChargeMonth
                    ? "A method change cannot reach back past this. Charges already posted are never restated."
                    : "Nothing has been depreciated yet."}
                </span>
              </div>

              <div className="ent-fg">
                <span className="ent-fl">Frequency</span>
                <select
                  className="ent-fc"
                  value={frequency}
                  onChange={(e) => { setFrequency(e.target.value); run(() => updateDepreciationConfig({ frequency: e.target.value })); }}
                  disabled={saving}
                >
                  {Object.entries(FREQUENCY_LABEL).map(([v, label]) => (
                    <option key={v} value={v}>{label}</option>
                  ))}
                </select>
                <span style={muted}>
                  The charge for a year is the same whichever this is. What changes is how many
                  journal entries there are, and when the cost shows up in an interim P&amp;L.
                  Periods run from 1 April.
                </span>
              </div>

              <div className="ent-fg">
                <span className="ent-fl">Capitalisation threshold</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="number" min={0} step="0.01" className="ent-fc" style={{ flex: 1 }}
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                  />
                  <button
                    type="button" className="ent-btn-cancel" disabled={saving}
                    onClick={() => run(() => updateDepreciationConfig({ capitalisationThreshold: Number(threshold) }))}
                  >
                    Save
                  </button>
                </div>
                <span style={muted}>
                  A capitalised line below {money(Number(threshold) || 0)} is expensed instead. Zero means no
                  threshold. Nobody wants a fixed asset carrying a forty-rupee monthly charge.
                </span>
              </div>
            </div>

            {showMethodForm && (
              <div style={{ padding: "0 14px 14px", borderTop: "1px solid var(--color-border)" }}>
                <p style={{ ...muted, lineHeight: 1.5, marginTop: 12 }}>
                  A change of method is a change in accounting <strong>estimate</strong>, not of policy —
                  it applies from the month you choose onward and nothing already posted is restated.
                  It has to be disclosed, and the reason below is what that disclosure gets written from.
                </p>
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
                        ? "This class keeps its own method afterwards, even when the company's changes."
                        : "Every class that has not been given a method of its own."}
                    </span>
                  </div>
                  <div className="ent-fg">
                    <span className="ent-fl">Change to</span>
                    <select className="ent-fc" value={toMethod} onChange={(e) => setToMethod(e.target.value)}>
                      <option value="SLM">Straight line</option>
                      <option value="WDV">Written-down value</option>
                    </select>
                  </div>
                  <div className="ent-fg">
                    <span className="ent-fl">Effective from</span>
                    <input
                      type="month" className="ent-fc"
                      min={policy.earliestEffectiveMonth}
                      value={effectiveMonth}
                      onChange={(e) => setEffectiveMonth(e.target.value)}
                    />
                    <span style={muted}>{policy.earliestEffectiveMonth} at the earliest</span>
                  </div>
                </div>
                <div className="ent-fg" style={{ marginTop: 10 }}>
                  <span className="ent-fl">Reason</span>
                  <textarea
                    className="ent-fc" style={{ height: 62, padding: 8, width: "100%" }}
                    maxLength={500}
                    placeholder="What changed in the expected pattern of consumption, and what supports it"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button
                    type="button" className="ent-btn-add" disabled={saving || !reason.trim()}
                    onClick={async () => {
                      const ok = await run(() => changeDepreciationMethod({
                        toMethod, effectiveMonth, reason,
                        assetClassId: methodScope || undefined,
                      }));
                      if (ok) { setShowMethodForm(false); setReason(""); setMethodScope(""); }
                    }}
                  >
                    {saving ? "Recording…" : "Record the change"}
                  </button>
                  <button type="button" className="ent-btn-cancel" onClick={() => { setShowMethodForm(false); setError(null); }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="ent-section" style={{ marginBottom: 16 }}>
            <div className="ent-section-hdr" style={{ borderRadius: "6px 6px 0 0" }}>
              <span className="ent-section-title">Asset classes</span>
            </div>
            <div style={{ padding: "10px 14px 0" }}>
              <p style={{ ...muted, marginTop: 0, lineHeight: 1.5 }}>
                Schedule II is the column on the left; what this company has adopted is the one beside
                it. A shorter life is permitted — Part A paragraph 3(i) — but the difference has to be
                disclosed and justified with technical advice, so a justification is required whenever
                the two differ.
              </p>
            </div>
            <div className="ent-page-table" style={{ border: "none" }}>
              <table>
                <thead>
                  <tr>
                    <th>Class</th>
                    <th>Account</th>
                    <th style={{ textAlign: "right", width: 110 }}>Schedule II</th>
                    <th style={{ textAlign: "right", width: 110 }}>Adopted</th>
                    <th style={{ textAlign: "right", width: 90 }}>Residual</th>
                    <th style={{ width: 130 }}>Method</th>
                    <th>Justification</th>
                    <th style={{ width: 70 }} />
                  </tr>
                </thead>
                <tbody>
                  {policy.classes.map((c) => (
                    <tr key={c.id} style={c.isActive ? undefined : { opacity: 0.55 }}>
                      <td style={{ fontWeight: 500 }}>{c.name}</td>
                      <td style={{ color: "var(--color-muted)" }}>
                        {c.assetAccount.accountCode} — {c.assetAccount.accountName}
                      </td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--color-muted)" }}>
                        {c.scheduleIiLifeMonths} mo
                      </td>
                      <td style={{
                        textAlign: "right", fontVariantNumeric: "tabular-nums",
                        fontWeight: c.usefulLifeMonths === c.scheduleIiLifeMonths ? 400 : 600,
                        color: c.usefulLifeMonths === c.scheduleIiLifeMonths ? undefined : "#b45309",
                      }}>
                        {c.usefulLifeMonths} mo
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
                      <td style={{ fontSize: 12, color: "var(--color-muted)" }}>{c.lifePolicyNote ?? "—"}</td>
                      <td style={{ textAlign: "right" }}>
                        <button type="button" className="ent-ia ent-ia-edit" onClick={() => openClass(c)}>Edit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
                        placeholder="What supports this life — a technical assessment, a manufacturer's estimate, a board policy"
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

          <div className="ent-section" style={{ marginBottom: 16 }}>
            <div className="ent-section-hdr" style={{ borderRadius: "6px 6px 0 0" }}>
              <span className="ent-section-title">How the rate is worked out</span>
            </div>
            <div style={{ padding: 14, fontSize: 13, lineHeight: 1.65 }}>
              <div style={{ marginBottom: 10 }}>
                <strong>Straight line</strong>
                <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5, marginTop: 3 }}>
                  rate = (1 − residual%) ÷ useful life
                </div>
                <div style={muted}>
                  Applied to the original cost, so every period&rsquo;s charge is the same and the balance
                  reaches the residual exactly at the end of the life.
                </div>
              </div>
              <div>
                <strong>Written-down value</strong>
                <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5, marginTop: 3 }}>
                  rate = 1 − residual%<sup>(1 ÷ useful life)</sup>
                </div>
                <div style={muted}>
                  Applied to the opening carrying amount, so the charge declines. Schedule II publishes
                  no WDV rates — the rate is derived from the life and the residual, which is why a WDV
                  asset must carry a residual above zero.
                </div>
              </div>
            </div>
          </div>

          <div className="ent-page-table">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 170 }}>Effective from</th>
                  <th style={{ width: 180 }}>Applies to</th>
                  <th style={{ width: 220 }}>Change</th>
                  <th>Reason</th>
                  <th style={{ width: 110 }} />
                </tr>
              </thead>
              <tbody>
                {policy.changes.length === 0 && (
                  <tr><td colSpan={5} className="ent-empty">
                    The method has never changed. Everything has depreciated on{" "}
                    {(METHOD_LABEL[policy.currentMethod] ?? policy.currentMethod).toLowerCase()} since the beginning.
                  </td></tr>
                )}
                {policy.changes.map((c) => {
                  const pending = c.effectiveMonth > thisMonth;
                  return (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 500 }}>
                        {monthLabel(c.effectiveMonth)}
                        {pending && <div><span className="badge badge-yellow">Not yet in effect</span></div>}
                      </td>
                      <td style={{ fontSize: 12.5 }}>
                        {c.assetClass ? c.assetClass.name : <span style={{ color: "var(--color-muted)" }}>The whole company</span>}
                      </td>
                      <td style={{ color: "var(--color-muted)" }}>
                        {METHOD_LABEL[c.fromMethod] ?? c.fromMethod} → {METHOD_LABEL[c.toMethod] ?? c.toMethod}
                      </td>
                      <td style={{ fontSize: 12.5 }}>{c.reason}</td>
                      <td style={{ textAlign: "right" }}>
                        {pending && (
                          <button type="button" className="ent-ia ent-ia-del" onClick={() => run(() => withdrawDepreciationMethodChange(c.id))}>
                            Withdraw
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AppShell>
  );
}
