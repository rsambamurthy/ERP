"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AppShell, { useNavGroups } from "@/components/layout/AppShell";
import GroupIcon from "@/components/layout/GroupIcon";
import { getName } from "@/lib/auth";

// Card launcher used when the "menu cards" preference is on (AppShell's header
// toggle). Reads the already role/permission/module-filtered groups from
// AppShell via useNavGroups(), so it shows exactly what the sidebar would.
// /menu            → one card per group (+ Dashboard)
// /menu?group=<id> → one card per page in that group

// Accent per group so the grid isn't a wall of one colour.
const GROUP_COLORS: Record<string, string> = {
  config: "#64748b",
  sales: "#2563eb",
  purchase: "#d97706",
  inventory: "#059669",
  manufacturing: "#7c3aed",
  accounting: "#0891b2",
  statutory: "#dc2626",
};

const Arrow = () => (
  <svg className="sa-card-go" viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
    <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
  </svg>
);

function Cards() {
  const groups = useNavGroups();
  const params = useSearchParams();
  const router = useRouter();
  const groupId = params.get("group");
  const group = groupId ? groups.find((g) => g.id === groupId) : undefined;

  if (group) {
    const color = GROUP_COLORS[group.id];
    return (
      <div className="sa-cards-wrap">
        <div className="sa-cards-hdr">
          <Link href="/menu" className="sa-cards-crumb">← All modules</Link>
          <h1>{group.label}</h1>
          <p>{group.items.length} {group.items.length === 1 ? "page" : "pages"}</p>
        </div>
        <div className="sa-cards">
          {group.items.map((item) => (
            <Link
              key={item.id}
              href={item.path}
              className="sa-card-tile"
              style={{ ["--cc" as string]: item.dot || color }}
            >
              <div className="sa-card-ic"><span className="sa-dot" style={{ background: item.dot || color }} /></div>
              <div className="sa-card-t">{item.label}</div>
              <Arrow />
            </Link>
          ))}
        </div>
      </div>
    );
  }

  const name = getName();
  return (
    <div className="sa-cards-wrap">
      <div className="sa-cards-hdr">
        <h1>{name ? `Welcome, ${name.split(" ")[0]}` : "Menu"}</h1>
        <p>Choose a module to get started.</p>
      </div>
      <div className="sa-cards">
        <Link href="/dashboard" className="sa-card-tile" style={{ ["--cc" as string]: "#0f766e" }}>
          <div className="sa-card-ic">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 11l9-8 9 8v10a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1V11z" />
            </svg>
          </div>
          <div className="sa-card-t">Dashboard</div>
          <div className="sa-card-s">Overview and key figures</div>
          <Arrow />
        </Link>
        {groups.map((g) => (
          <button
            key={g.id}
            className="sa-card-tile"
            style={{ ["--cc" as string]: GROUP_COLORS[g.id] }}
            onClick={() => router.push(`/menu?group=${g.id}`)}
          >
            <div className="sa-card-ic"><GroupIcon id={g.id} fallback={g.icon} size={24} /></div>
            <div className="sa-card-t">{g.label}</div>
            <div className="sa-card-s">{g.items.length} {g.items.length === 1 ? "page" : "pages"}</div>
            <Arrow />
          </button>
        ))}
      </div>
    </div>
  );
}

export default function MenuPage() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <Cards />
      </Suspense>
    </AppShell>
  );
}
