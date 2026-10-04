"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useNavGroups } from "@/components/layout/AppShell";
import GroupIcon from "@/components/layout/GroupIcon";
import { getName } from "@/lib/auth";
import {
  getBalanceSheet,
  getCashBook,
  getPnL,
  getPurchaseBills,
  getPurchaseOrders,
  getSalesInvoices,
  getSalesOrders,
  getValuation,
} from "@/lib/api";
import type { PurchaseBill, SalesInvoice } from "@/lib/types";

// Every block loads independently with allSettled. A role that isn't allowed
// to see a report (403) or an org without a module (402) simply doesn't get
// that block, instead of the whole dashboard erroring out.

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

const iso = (d: Date) => d.toISOString().slice(0, 10);

interface Data {
  sales?: number;
  purchases?: number;
  netProfit?: number;
  cash?: number;
  stock?: number;
  assets?: number;
  liabilities?: number;
  poPending?: number;
  soPending?: number;
  billsPending?: number;
  recentSales?: SalesInvoice[];
  recentBills?: PurchaseBill[];
}

export default function DashboardContent() {
  const groups = useNavGroups();
  const [data, setData] = useState<Data>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const now = new Date();
    const from = iso(new Date(now.getFullYear(), now.getMonth(), 1));
    const to = iso(now);
    const inMonth = (d: string) => d.slice(0, 10) >= from && d.slice(0, 10) <= to;

    Promise.allSettled([
      getSalesInvoices(), // 0
      getPurchaseBills(), // 1
      getPnL({ from, to }), // 2
      getCashBook(), // 3
      getValuation(), // 4
      getBalanceSheet({ asOf: to }), // 5
      getPurchaseOrders({ status: "PENDING_APPROVAL" }), // 6
      getSalesOrders({ status: "PENDING_APPROVAL" }), // 7
    ]).then(([si, pb, pnl, cb, val, bs, po, so]) => {
      if (!alive) return;
      const d: Data = {};
      if (si.status === "fulfilled") {
        const rows = si.value.data;
        d.sales = rows.filter((r) => inMonth(r.invoiceDate)).reduce((s, r) => s + Number(r.grandTotal), 0);
        d.recentSales = [...rows].sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate)).slice(0, 5);
      }
      if (pb.status === "fulfilled") {
        const rows = pb.value.data;
        d.purchases = rows
          .filter((r) => r.status === "POSTED" && inMonth(r.billDate))
          .reduce((s, r) => s + Number(r.grandTotal), 0);
        d.billsPending = rows.filter((r) => r.status === "PENDING_APPROVAL").length;
        d.recentBills = [...rows].sort((a, b) => b.billDate.localeCompare(a.billDate)).slice(0, 5);
      }
      if (pnl.status === "fulfilled") d.netProfit = pnl.value.data.netProfit;
      if (cb.status === "fulfilled") {
        const rows = cb.value.data.rows;
        d.cash = rows.length ? rows[rows.length - 1].balance : cb.value.data.openingBalance;
      }
      if (val.status === "fulfilled") d.stock = val.value.data.totalValue;
      if (bs.status === "fulfilled") {
        d.assets = bs.value.data.totalAssets;
        d.liabilities = bs.value.data.totalLiabilities;
      }
      if (po.status === "fulfilled") d.poPending = po.value.data.length;
      if (so.status === "fulfilled") d.soPending = so.value.data.length;
      setData(d);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const name = getName();
  const monthLabel = new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  type Metric = { label: string; value: number | undefined; hint: string; tone?: "profit" };
  const allMetrics: Metric[] = [
    { label: "Sales", value: data.sales, hint: monthLabel },
    { label: "Purchases", value: data.purchases, hint: monthLabel },
    { label: "Net profit", value: data.netProfit, hint: monthLabel, tone: "profit" },
    { label: "Cash and bank", value: data.cash, hint: "Current balance" },
    { label: "Stock value", value: data.stock, hint: "At cost" },
    { label: "Net worth", value: data.assets !== undefined && data.liabilities !== undefined ? data.assets - data.liabilities : undefined, hint: "Assets minus liabilities" },
  ];
  const metrics = allMetrics.filter((m) => m.value !== undefined);

  const attention = [
    { label: "Purchase orders awaiting approval", n: data.poPending, href: "/purchase/orders" },
    { label: "Sales orders awaiting approval", n: data.soPending, href: "/sales/orders" },
    { label: "Purchase bills awaiting approval", n: data.billsPending, href: "/purchase/bills" },
  ].filter((a) => a.n !== undefined && a.n > 0);

  return (
    <div className="dash">
      <div className="ent-page-hdr">
        <h1>{name ? `Welcome back, ${name.split(" ")[0]}` : "Dashboard"}</h1>
        <p>Here&apos;s where things stand for {monthLabel}.</p>
      </div>

      {metrics.length > 0 && (
        <div className="dash-metrics">
          {metrics.map((m) => (
            <div key={m.label} className="dash-metric">
              <div className="dash-metric-l">{m.label}</div>
              <div
                className="dash-metric-v"
                style={m.tone === "profit" ? { color: (m.value as number) >= 0 ? "#15803d" : "#b91c1c" } : undefined}
              >
                {inr(m.value as number)}
              </div>
              <div className="dash-metric-h">{m.hint}</div>
            </div>
          ))}
        </div>
      )}

      {loading && metrics.length === 0 && <p className="dash-empty">Loading your numbers…</p>}

      {attention.length > 0 && (
        <section className="dash-sec">
          <h2>Needs your attention</h2>
          <div className="dash-attn">
            {attention.map((a) => (
              <Link key={a.href} href={a.href} className="dash-attn-row">
                <span className="dash-attn-n">{a.n}</span>
                <span>{a.label}</span>
                <span className="dash-attn-go">Review →</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="dash-cols">
        {data.recentSales && (
          <section className="dash-sec">
            <div className="dash-sec-h">
              <h2>Recent sales invoices</h2>
              <Link href="/sales/invoices">View all</Link>
            </div>
            {data.recentSales.length === 0 ? (
              <p className="dash-empty">No invoices yet.</p>
            ) : (
              <ul className="dash-list">
                {data.recentSales.map((r) => (
                  <li key={r.id}>
                    <div>
                      <div className="dash-li-t">{r.businessPartner.name}</div>
                      <div className="dash-li-s">{r.invoiceNumber} · {fmtDate(r.invoiceDate)}</div>
                    </div>
                    <div className="dash-li-a">{inr(Number(r.grandTotal))}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {data.recentBills && (
          <section className="dash-sec">
            <div className="dash-sec-h">
              <h2>Recent purchase bills</h2>
              <Link href="/purchase/bills">View all</Link>
            </div>
            {data.recentBills.length === 0 ? (
              <p className="dash-empty">No bills yet.</p>
            ) : (
              <ul className="dash-list">
                {data.recentBills.map((r) => (
                  <li key={r.id}>
                    <div>
                      <div className="dash-li-t">{r.businessPartner.name}</div>
                      <div className="dash-li-s">{r.billNumber} · {fmtDate(r.billDate)}</div>
                    </div>
                    <div className="dash-li-a">{inr(Number(r.grandTotal))}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      {groups.length > 0 && (
        <section className="dash-sec">
          <h2>Jump to</h2>
          <div className="dash-jump">
            {groups.map((g) => (
              <Link key={g.id} href={g.items[0].path} className="dash-jump-i">
                <span className="dash-jump-ic"><GroupIcon id={g.id} fallback={g.icon} size={16} /></span>
                {g.label}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
