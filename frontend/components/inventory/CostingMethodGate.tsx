"use client";

import { useEffect, useState } from "react";
import { ApiError, getCostingMethod, setCostingMethod } from "@/lib/api";
import type { CostingMethod } from "@/lib/types";

// The one-time, permanent choice every Sales/Purchase/Inventory screen is
// gated behind. Shown once — after an org picks, this component just
// renders its children for every screen forever.
export default function CostingMethodGate({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [method, setMethod] = useState<CostingMethod | null>(null);
  const [choice, setChoice] = useState<CostingMethod>("WEIGHTED_AVG");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCostingMethod()
      .then((res) => setMethod(res.data.costingMethod))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load settings."))
      .finally(() => setLoading(false));
  }, []);

  async function handleConfirm() {
    setSaving(true);
    setError(null);
    try {
      await setCostingMethod(choice);
      setMethod(choice);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="ent-empty">Loading…</p>;
  if (method) return <>{children}</>;

  return (
    <div className="ent-section" style={{ padding: 20, maxWidth: 560 }}>
      <div className="ent-section-hdr"><span className="ent-section-title">Choose your stock costing method</span></div>
      <p style={{ fontSize: 13, color: "var(--color-muted)", margin: "10px 0 16px" }}>
        This applies to every item across the whole organization, and can&apos;t be changed once set —
        every stock record from here on is computed under this rule.
      </p>

      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 14, cursor: "pointer" }}>
        <input type="radio" name="costing" checked={choice === "WEIGHTED_AVG"} onChange={() => setChoice("WEIGHTED_AVG")} style={{ marginTop: 3 }} />
        <span>
          <strong>Weighted Average</strong> (recommended)
          <br />
          <span style={{ fontSize: 13, color: "var(--color-muted)" }}>One running average cost per item, recalculated on every purchase. Simple, and what most small trading businesses' accountants expect.</span>
        </span>
      </label>

      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 18, cursor: "pointer" }}>
        <input type="radio" name="costing" checked={choice === "FIFO"} onChange={() => setChoice("FIFO")} style={{ marginTop: 3 }} />
        <span>
          <strong>FIFO</strong> (First In, First Out)
          <br />
          <span style={{ fontSize: 13, color: "var(--color-muted)" }}>Each purchase is its own cost layer; a sale consumes the oldest layer first. More accurate when input prices move around, more to reconcile.</span>
        </span>
      </label>

      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>}
      <button className="ent-btn-save" disabled={saving} onClick={handleConfirm}>{saving ? "Saving…" : "Confirm and continue"}</button>
    </div>
  );
}
