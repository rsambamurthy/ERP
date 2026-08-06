"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Logo from "@/components/ui/Logo";
import { NAV_GROUPS } from "./navGroups";
import { clearSession, isLoggedIn } from "@/lib/auth";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) {
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

  return (
    <div className="flex min-h-screen">
      {/* ── Sidebar ── */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-cream-200 bg-white sm:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <Logo size={32} />
          <div className="text-lg font-bold">
            <span className="text-navy-800">Smart</span>
            <span className="text-terracotta-500">ERP</span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-6">
          <Link
            href="/dashboard"
            className={`mb-4 block rounded-lg px-3 py-2 text-sm font-medium ${
              pathname === "/dashboard"
                ? "bg-terracotta-50 text-terracotta-700"
                : "text-navy-800 hover:bg-cream-50"
            }`}
          >
            Dashboard
          </Link>

          {NAV_GROUPS.map((group) => (
            <div key={group.id} className="mb-5">
              <div className="mb-1 flex items-center gap-2 px-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                <span>{group.icon}</span>
                {group.label}
              </div>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const active = pathname === item.path;
                  return (
                    <Link
                      key={item.id}
                      href={item.path}
                      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                        active
                          ? "bg-terracotta-50 font-medium text-terracotta-700"
                          : "text-gray-600 hover:bg-cream-50"
                      }`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: item.dot }} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* ── Main ── */}
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-cream-200 bg-white px-6 py-3">
          <div className="sm:hidden text-lg font-bold">
            <span className="text-navy-800">Smart</span>
            <span className="text-terracotta-500">ERP</span>
          </div>
          <div className="flex-1" />
          <button
            onClick={handleLogout}
            className="rounded-lg border border-cream-200 px-3 py-1.5 text-sm font-medium text-navy-800 hover:bg-cream-50"
          >
            Logout
          </button>
        </header>
        <main className="flex-1 bg-[#f3ece0] p-6">{children}</main>
      </div>
    </div>
  );
}
