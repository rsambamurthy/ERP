"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { clearSession, getName, getRole, isLoggedIn } from "../../lib/auth";
import { ORG_ROLE_LABELS } from "../../lib/types";
import { NAV_GROUPS, isNavItemVisible } from "./navGroups";

// Client-side auth guard + header/sidebar shell — same pattern as
// SmartERP frontend's components/layout/AppShell.tsx: no middleware.ts,
// just a useEffect redirect on every protected page, wrapped like
// `export default function ProjectsPage() { return <AppShell><Inner /></AppShell>; }`.
// Renders nothing until the auth check has run, to avoid a flash of
// protected content before the redirect fires.
export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) return null;

  const role = getRole();
  const name = getName();

  function handleLogout() {
    clearSession();
    router.replace("/login");
  }

  return (
    <div className="pos-shell">
      <header className="pos-header">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-900">Project OS</span>
          <span className="text-xs text-slate-400">R1 Pilot</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-right leading-tight">
            <div className="text-slate-800">{name ?? "—"}</div>
            <div className="text-xs text-slate-400">{role ? ORG_ROLE_LABELS[role] : ""}</div>
          </div>
          <button className="pos-btn-secondary" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      <nav className="pos-sidebar">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => isNavItemVisible(item, role));
          if (items.length === 0) return null;
          return (
            <div key={group.id}>
              <div className="pos-nav-group-label">{group.label}</div>
              {items.map((item) => {
                const active = pathname === item.path || pathname?.startsWith(`${item.path}/`);
                return (
                  <Link
                    key={item.id}
                    href={item.path}
                    className={`pos-nav-item ${active ? "pos-nav-item-active" : ""}`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <main className="pos-main">
        <div className="pos-main-inner">{children}</div>
      </main>
    </div>
  );
}
