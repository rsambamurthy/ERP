"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { NAV_GROUPS } from "./navGroups";
import { clearSession, getName, getRole, isLoggedIn, isPlatformAdmin } from "@/lib/auth";
import { getMenuConfig } from "@/lib/api";
import type { MenuConfigMap } from "@/lib/types";

// Structure ported from SmartAppt Gold's authenticated app shell
// (frontend/src/components/organisms/Layout.tsx — WebLayout) — sa-shell /
// sa-header / sa-sidebar / sa-mg-* classes come straight from its
// src/index.css, just rebranded. That's the actual navy/blue "enterprise"
// design system SmartAppt uses post-login (distinct from the cream/
// terracotta public login/register pages, which already matched).
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [menuConfig, setMenuConfig] = useState<MenuConfigMap>({});

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/login");
      return;
    }
    if (isPlatformAdmin()) {
      router.replace("/admin");
      return;
    }
    setReady(true);
  }, [router]);

  // Which items this role actually sees, per navGroups.ts defaults with any
  // org-level override from the Access Control screen applied on top. Falls
  // back to the built-in defaults silently if the fetch fails, so a slow or
  // down /access-control endpoint never hides the whole sidebar.
  useEffect(() => {
    if (!ready) return;
    getMenuConfig().then((res) => setMenuConfig(res.data)).catch(() => {});
  }, [ready]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  if (!ready) return null;

  const toggleGroup = (id: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleLogout = () => {
    clearSession();
    router.push("/login");
  };

  const role = getRole();
  const isVisible = (itemId: string, defaultRoles: string[]) => {
    const override = role ? menuConfig[role]?.[itemId] : undefined;
    if (override !== undefined) return override;
    return role ? defaultRoles.includes(role) : false;
  };

  const allowedGroups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => isVisible(i.id, i.roles)),
  })).filter((g) => g.items.length > 0);

  const activeGroupId = allowedGroups.find((g) =>
    g.items.some((i) => pathname === i.path || pathname?.startsWith(i.path + "/"))
  )?.id;

  return (
    <div className="sa-shell">
      {/* ── Header ── */}
      <header className="sa-header">
        <button className="sa-hamburger" onClick={() => setSidebarOpen((o) => !o)} aria-label="Toggle menu">
          <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20">
            <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
          </svg>
        </button>

        <Link href="/dashboard" className="sa-logo">
          <span className="sa-logo-box">S</span>
          SmartERP
        </Link>

        <div style={{ flex: 1 }} />

        <button className="sa-hbtn" onClick={handleLogout} title="Logout">
          <svg viewBox="0 0 20 20" fill="currentColor" width="17" height="17">
            <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
          </svg>
        </button>

        <div className="sa-user-chip">
          <div className="sa-avatar">{(getName() ?? getRole() ?? "U").slice(0, 2).toUpperCase()}</div>
          <div>
            <div className="sa-user-name">{getName() ?? getRole()}</div>
            {getName() && <div className="sa-user-role">{getRole()}</div>}
          </div>
        </div>
      </header>

      <div className="sa-body">
        <div className={`sa-sidebar-overlay${sidebarOpen ? " open" : ""}`} onClick={() => setSidebarOpen(false)} />

        <aside className={`sa-sidebar${sidebarOpen ? " mobile-open" : ""}`}>
          <div className="sa-sb-head">Navigation</div>

          <Link href="/dashboard" className={`sa-sb-single${pathname === "/dashboard" ? " active" : ""}`}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
              <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
            </svg>
            Dashboard
          </Link>

          {allowedGroups.map((group) => (
            <div key={group.id} className="sa-mg">
              <button
                className={`sa-mg-h${openGroups.has(group.id) ? " open" : ""}${activeGroupId === group.id ? " active-group" : ""}`}
                onClick={() => toggleGroup(group.id)}
              >
                <div className="sa-mg-ic">{group.icon}</div>
                <span className="sa-mg-t">{group.label}</span>
                <svg className="sa-mg-cv" viewBox="0 0 20 20" fill="currentColor" width="12" height="12">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>

              {openGroups.has(group.id) && (
                <div className="sa-mi-list">
                  {group.items.map((item) => (
                    <Link
                      key={item.id}
                      href={item.path}
                      className={`sa-mi${pathname === item.path ? " active" : ""}`}
                    >
                      <span className="sa-dot" style={{ background: item.dot }} />
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </aside>

        <main className="sa-main">{children}</main>
      </div>
    </div>
  );
}
