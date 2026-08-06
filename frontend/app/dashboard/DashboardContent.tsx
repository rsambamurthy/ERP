"use client";

import { useSearchParams } from "next/navigation";
import type { DomainCode } from "@/lib/types";

const WIDGETS: Record<DomainCode, { title: string; blurb: string }[]> = {
  TRADING: [
    { title: "Inventory", blurb: "Stock on hand across branches." },
    { title: "Sales", blurb: "Open quotes, invoices, receivables." },
  ],
  MANUFACTURING: [
    { title: "Production", blurb: "Work orders and BOM consumption." },
    { title: "Work in progress", blurb: "Raw materials moving to finished goods." },
  ],
};

export default function DashboardContent() {
  const params = useSearchParams();
  const domains = (params.get("domains")?.split(",").filter(Boolean) ?? []) as DomainCode[];

  return (
    <div>
      <div className="ent-page-hdr">
        <h1>Dashboard</h1>
        <p>
          Workspace provisioned for:{" "}
          <strong>{domains.length ? domains.join(", ") : "no domains selected"}</strong>
        </p>
      </div>

      <div className="grid-2">
        {domains.flatMap((d) => WIDGETS[d] ?? []).map((w) => (
          <div key={w.title} className="card">
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)" }}>{w.title}</h3>
            <p style={{ marginTop: 4, fontSize: 13, color: "var(--color-muted)" }}>{w.blurb}</p>
          </div>
        ))}
        {domains.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--color-muted)" }}>
            No domain data to show — start from the registration wizard.
          </p>
        )}
      </div>
    </div>
  );
}
