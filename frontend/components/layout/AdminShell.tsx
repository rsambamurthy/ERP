"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearSession, isLoggedIn, isPlatformAdmin } from "@/lib/auth";

// Separate shell from AppShell — a platform admin isn't a member of any
// organization, so there's no accordion of org modules, just the two things
// a superuser needs: the org list and the audit trail.
export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isLoggedIn() || !isPlatformAdmin()) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) return null;

  const handleLogout = () => {
    clearSession();
    router.push("/login");
  };

  const links = [
    { href: "/admin", label: "Organizations" },
    { href: "/admin/subscriptions", label: "Subscriptions" },
    { href: "/admin/audit-log", label: "Audit Trail" },
  ];

  return (
    <div className="sa-shell">
      <header className="sa-header">
        <Link href="/admin" className="sa-logo">
          <span className="sa-logo-box">S</span>
          SmartERP Admin
        </Link>
        <div style={{ flex: 1 }} />
        <button className="sa-hbtn" onClick={handleLogout} title="Logout">
          <svg viewBox="0 0 20 20" fill="currentColor" width="17" height="17">
            <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
          </svg>
        </button>
        <div className="sa-user-chip">
          <div className="sa-avatar">SU</div>
        </div>
      </header>

      <div className="sa-body">
        <aside className="sa-sidebar">
          <div className="sa-sb-head">Platform Admin</div>
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={`sa-sb-single${pathname === l.href ? " active" : ""}`}>
              {l.label}
            </Link>
          ))}
        </aside>
        <main className="sa-main">{children}</main>
      </div>
    </div>
  );
}
