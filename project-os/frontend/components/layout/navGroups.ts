import { OrgRole } from "../../lib/types";

export interface NavItem {
  id: string;
  label: string;
  path: string;
  roles: OrgRole[];
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

// Central nav data — same convention as SmartERP frontend's
// components/layout/navGroups.ts: to add a page, add a NavItem here,
// nothing else hardcodes the sidebar. SUPER_ADMIN is intentionally
// listed on every item (it bypasses every requireRole(...) check on the
// backend too, see project-os/backend/src/middleware/auth.ts).
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "overview",
    label: "Overview",
    items: [
      { id: "dashboard", label: "Dashboard", path: "/dashboard", roles: ["SUPER_ADMIN", "PROJECT_MANAGER", "ESTIMATOR", "PROCUREMENT", "WAREHOUSE", "SITE_ENGINEER"] },
      { id: "projects", label: "Projects", path: "/projects", roles: ["SUPER_ADMIN", "PROJECT_MANAGER", "ESTIMATOR", "PROCUREMENT", "WAREHOUSE", "SITE_ENGINEER"] },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    items: [
      // SUPER_ADMIN only — matches requireRole("SUPER_ADMIN") on
      // POST /integration/connection and /integration/sync server-side.
      { id: "integration", label: "Integration", path: "/settings/integration", roles: ["SUPER_ADMIN"] },
    ],
  },
];

export function isNavItemVisible(item: NavItem, role: OrgRole | null): boolean {
  if (!role) return false;
  return item.roles.includes(role);
}
