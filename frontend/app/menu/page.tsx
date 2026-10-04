"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AppShell, { useNavGroups } from "@/components/layout/AppShell";
import GroupIcon from "@/components/layout/GroupIcon";

// Card launcher used when the "menu cards" preference is on (AppShell's header
// toggle). Reads the already role/permission/module-filtered groups from
// AppShell via useNavGroups(), so it shows exactly what the sidebar would.
// /menu            → one card per group (+ Dashboard)
// /menu?group=<id> → one card per page in that group
function Cards() {
  const groups = useNavGroups();
  const params = useSearchParams();
  const router = useRouter();
  const groupId = params.get("group");
  const group = groupId ? groups.find((g) => g.id === groupId) : undefined;

  if (group) {
    return (
      <>
        <div className="sa-cards-hdr">
          <h1>{group.label}</h1>
          <Link href="/menu" className="sa-cards-back">← All modules</Link>
        </div>
        <div className="sa-cards">
          {group.items.map((item) => (
            <Link key={item.id} href={item.path} className="sa-card-tile">
              <div className="sa-card-ic"><span className="sa-dot" style={{ background: item.dot }} /></div>
              <div className="sa-card-t">{item.label}</div>
            </Link>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="sa-cards-hdr">
        <h1>Menu</h1>
      </div>
      <div className="sa-cards">
        <Link href="/dashboard" className="sa-card-tile">
          <div className="sa-card-ic">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 11l9-8 9 8v10a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1V11z" />
            </svg>
          </div>
          <div className="sa-card-t">Dashboard</div>
        </Link>
        {groups.map((g) => (
          <button key={g.id} className="sa-card-tile" onClick={() => router.push(`/menu?group=${g.id}`)}>
            <div className="sa-card-ic"><GroupIcon id={g.id} fallback={g.icon} size={24} /></div>
            <div className="sa-card-t">{g.label}</div>
            <div className="sa-card-s">{g.items.length} {g.items.length === 1 ? "page" : "pages"}</div>
          </button>
        ))}
      </div>
    </>
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
