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
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">
          Workspace provisioned for:{" "}
          {domains.length ? domains.join(", ") : "no domains selected"}
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        {domains.flatMap((d) => WIDGETS[d] ?? []).map((w) => (
          <div key={w.title} className="rounded-lg border border-gray-200 bg-white p-5">
            <h3 className="font-medium text-gray-900">{w.title}</h3>
            <p className="mt-1 text-sm text-gray-500">{w.blurb}</p>
          </div>
        ))}
        {domains.length === 0 && (
          <p className="text-sm text-gray-500">
            No domain data to show — start from the registration wizard.
          </p>
        )}
      </section>
    </main>
  );
}
