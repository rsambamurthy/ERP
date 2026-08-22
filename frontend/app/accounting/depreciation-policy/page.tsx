"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import {
  ApiError, changeDepreciationMethod, getDepreciationPolicy, withdrawDepreciationMethodChange,
} from "@/lib/api";
import type { DepreciationPolicy } from "@/lib/types";

// The company's depreciation method, and the record of every time it moved.
//
// One method for the whole entity. Schedule II prescribes useful LIVES, not
// methods — Part A never names one and Part C's Notes ask only that the
// method used be disclosed — so the method is the company's own choice,
// declared once. The useful life is the opposite and belongs to the
// individual asset, which is why it is set on the Purchase Bill line and not
// here.
//
// Changing the method is permitted and prospective: under AS 10 (revised)
// and Ind AS 16 it is a change in accounting ESTIMATE, so charges already
// posted stand and are never restated. This screen exists to make that
// change deliberate, dated, and written down.

const METHOD_LABEL: Record<string, string> = {
  SLM: "Straight line",
  WDV: "Written-down value",
};

function monthLabel(ym: string): string {
  const d = new Date(`${ym}-01T00:00:00Z`);
  return isNaN(d.getTime())
    ? ym
    : d.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

export default function DepreciationPolicyPage() {
  const [policy, setPolicy] = useState<DepreciationPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [toMethod, setToMethod] = useState("WDV");
  const [effectiveMonth, setEffectiveMonth] = useState("");
  const [reason, setReason] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await getDepreciationPolicy();
      setPolicy(res.data);
      setToMethod(res.data.currentMethod === "SLM" ? "WDV" : "SLM");
      setEffectiveMonth(res.data.earliestEffectiveMonth);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the depreciation policy.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // A change dated after this month has not started applying yet, so it can
  // still be withdrawn. One that has is history.
  const thisMonth = useMemo(() => new Date().toISOString().slice(0, 7), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await changeDepreciationMethod({ toMethod, effectiveMonth, reason });
      setShowForm(false);
      setReason("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record the change.");
    } finally {
      setSaving(false);
    }
  }

  async function withdraw(id: string) {
    setError(null);
    try {
      await withdrawDepreciationMethodChange(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not withdraw the change.");
    }
  }

  const muted = { color: "var(--color-muted)", fontSize: 12 } as const;

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Depreciation Policy</h1>
        <p>
          The method this company depreciates on. One method for the whole entity, disclosed in
          the accounting policies. Useful lives are set per asset, on the Purchase Bill line.
        </p>
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {loading && <p style={muted}>Loading…</p>}

      {policy && (
        <>
          <div className="ent-section" style={{ marginBottom: 16 }}>
            <div className="ent-section-hdr" style={{ borderRadius: "6px 6px 0 0" }}>
              <span className="ent-section-title">In force</span>
              {!showForm && (
                <button type="button" className="ent-btn-add" onClick={() => setShowForm(true)}>
                  Change method
                </button>
              )}
            </div>
            <div className="ent-form-grid" style={{ padding: 14 }}>
              <div className="ent-fg">
                <span className="ent-fl">Method</span>
                <div style={{ fontSize: 18 }}>{METHOD_LABEL[policy.currentMethod] ?? policy.currentMethod}</div>
                <span style={muted}>
                  {policy.currentMethod === "WDV"
                    ? "The rate is derived from each asset's life and residual, so the charge declines year on year."
                    : "The depreciable amount is spread evenly over each asset's useful life."}
                </span>
              </div>
              <div className="ent-fg">
                <span className="ent-fl">Depreciated up to</span>
                <div style={{ fontSize: 18 }}>
                  {policy.lastPostedChargeMonth ? monthLabel(policy.lastPostedChargeMonth) : "—"}
                </div>
                <span style={muted}>
                  {policy.lastPostedChargeMonth
                    ? "A change of method cannot reach back past this. Charges already posted are never restated."
                    : "Nothing has been depreciated yet."}
                </span>
              </div>
            </div>
          </div>

          {showForm && (
            <form onSubmit={submit} className="ent-section" style={{ marginBottom: 16 }}>
              <div className="ent-section-hdr" style={{ borderRadius: "6px 6px 0 0" }}>
                <span className="ent-section-title">Change the method</span>
              </div>
              <div style={{ padding: 14 }}>
                <p style={{ ...muted, marginTop: 0, marginBottom: 14, lineHeight: 1.5 }}>
                  A change of depreciation method is a change in accounting <strong>estimate</strong>, not
                  a change in policy — so it applies from the month you choose onward and nothing
                  already posted is restated. It has to be disclosed, and the reason below is what
                  that disclosure gets written from.
                </p>
                <div className="ent-form-grid">
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
                      required
                    />
                    <span style={muted}>
                      {policy.earliestEffectiveMonth} at the earliest
                      {policy.lastPostedChargeMonth ? " — the month after the last posted charge" : ""}
                    </span>
                  </div>
                </div>
                <div className="ent-fg" style={{ marginTop: 10 }}>
                  <span className="ent-fl">Reason</span>
                  <textarea
                    className="ent-fc" style={{ height: 70, padding: 8, width: "100%" }}
                    maxLength={500}
                    placeholder="What changed in the expected pattern of consumption, and what supports it — a board resolution, a technical assessment"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                  />
                  <span style={muted}>{reason.trim().length}/500 · required</span>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button type="submit" className="ent-btn-add" disabled={saving || !reason.trim()}>
                    {saving ? "Recording…" : "Record the change"}
                  </button>
                  <button type="button" className="ent-btn-cancel" onClick={() => { setShowForm(false); setError(null); }}>
                    Cancel
                  </button>
                </div>
              </div>
            </form>
          )}

          <div className="ent-page-table">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 170 }}>Effective from</th>
                  <th style={{ width: 220 }}>Change</th>
                  <th>Reason</th>
                  <th style={{ width: 110 }} />
                </tr>
              </thead>
              <tbody>
                {policy.changes.length === 0 && (
                  <tr><td colSpan={4} className="ent-empty">
                    The method has never changed. Every asset has been depreciated on{" "}
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
                      <td style={{ color: "var(--color-muted)" }}>
                        {METHOD_LABEL[c.fromMethod] ?? c.fromMethod} → {METHOD_LABEL[c.toMethod] ?? c.toMethod}
                      </td>
                      <td style={{ fontSize: 12.5 }}>{c.reason}</td>
                      <td style={{ textAlign: "right" }}>
                        {pending && (
                          <button type="button" className="ent-ia ent-ia-del" onClick={() => withdraw(c.id)}>
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

          <p style={{ ...muted, marginTop: 12, lineHeight: 1.5 }}>
            Why a change needs no recalculation: every charge is worked out from the asset&rsquo;s opening
            carrying amount, the months of life still remaining, and its residual value. Straight line
            spreads what is left evenly; written-down value applies a rate derived from the same three
            figures. Both land exactly on the residual at the end of the life, from wherever they start —
            so switching is simply the other formula from the effective month onward.
          </p>
        </>
      )}
    </AppShell>
  );
}
