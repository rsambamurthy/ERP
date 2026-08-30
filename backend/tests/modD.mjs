// modD - the sidebar. Six frontend files. Run modB first (it is what puts
// deniedModules in the login response).
//
// This is the half the owner of a cancelled organisation actually SEES.
// The login response now carries the modules that org has had withdrawn,
// lib/auth.ts stores it beside the permissions snapshot it already keeps,
// and AppShell drops any nav group whose module is on that list.
//
// Two groups are tagged: Inventory (INVENTORY) and Manufacturing (BOM).
// Everything else - Configuration, Sales, Purchase, Accounting, Statutory
// Reports - has no module and is never hidden. Those are the books.
//
// HIDING IS A COURTESY, NOT A CONTROL. requireModule() on the routes is
// what refuses; this only stops offering. Which is also why a corrupt
// stored value falls back to showing everything rather than nothing - the
// worst case must be a menu entry that returns a clear 402, never somebody
// locked out of their own accounts by a bad JSON parse.
//
// A SNAPSHOT, like permissions: cancelling a module reaches an already-open
// session at next login. The API refuses from the moment it is cancelled.
//
// Save this as backend/tests/modD.mjs and run it from backend/:
//   node tests/modD.mjs
// Safe to run twice - a second run says 'already there' and changes nothing.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const at = (f) => path.join(here, "..", f);
const read = (f) => fs.readFileSync(at(f), "utf8").replace(/\r\n/g, "\n");
const L = (...ls) => ls.join("\n");
const save = (f, t) => fs.writeFileSync(at(f), t.replace(/\n*$/, "\n"));

let applied = 0, already = 0;
function edit(file, from, to, done) {
  const t = read(file);
  if (t.includes(done)) { already++; save(file, t); return; }
  const n = t.split(from).length - 1;
  if (n === 0) throw new Error("anchor not found in " + file + ": " + from.slice(0, 70));
  if (n > 1) throw new Error("anchor is not unique in " + file + ": " + from.slice(0, 70));
  save(file, t.replace(from, to));
  applied++;
}

edit("../frontend/lib/auth.ts",
  "const CUSTOM_ROLE_ID_KEY = \"smarterp_custom_role_id\";",
  L(
    "const CUSTOM_ROLE_ID_KEY = \"smarterp_custom_role_id\";",
    "// Modules this org has had WITHDRAWN, from the login response. A DENY",
    "// list, never an allow list - see backend/src/lib/entitlements.ts. An org",
    "// with no org_modules rows at all (one provisioned before those rows were",
    "// written) yields [], which hides nothing, which is the point.",
    "const DENIED_MODULES_KEY = \"smarterp_denied_modules\";"),
  "const DENIED_MODULES_KEY ="
);

edit("../frontend/lib/auth.ts",
  "  customRoleId?: string | null",
  L(
    "  customRoleId?: string | null,",
    "  deniedModules?: string[]"),
  "deniedModules?: string[]"
);

edit("../frontend/lib/auth.ts",
  L(
    "  else localStorage.removeItem(CUSTOM_ROLE_ID_KEY);",
    "}",
    ""),
  L(
    "  else localStorage.removeItem(CUSTOM_ROLE_ID_KEY);",
    "  localStorage.setItem(DENIED_MODULES_KEY, JSON.stringify(deniedModules ?? []));",
    "}",
    "",
    "// Which modules the sidebar must stop offering. Defaults to [] on anything",
    "// unreadable - a corrupt value should show too much, not lock somebody out",
    "// of their own books. The API refuses what it must regardless.",
    "export function getDeniedModules(): string[] {",
    "  if (typeof window === \"undefined\") return [];",
    "  try {",
    "    const raw = localStorage.getItem(DENIED_MODULES_KEY);",
    "    const parsed = raw ? JSON.parse(raw) : [];",
    "    return Array.isArray(parsed) ? parsed.filter((m) => typeof m === \"string\") : [];",
    "  } catch {",
    "    return [];",
    "  }",
    "}",
    ""),
  "export function getDeniedModules(): string[] {"
);

edit("../frontend/lib/api.ts",
  "    isPlatformAdmin: boolean; name: string | null; permissions?: Permission[]; customRoleId?: string | null;",
  L(
    "    isPlatformAdmin: boolean; name: string | null; permissions?: Permission[]; customRoleId?: string | null;",
    "    // Modules withdrawn from this org - a deny list. See lib/auth.ts.",
    "    deniedModules?: string[];"),
  "// Modules withdrawn from this org - a deny list."
);

edit("../frontend/lib/api.ts",
  L(
    "export interface MpinLoginResponse {",
    "  token: string; organizationId: string | null; role: string | null;",
    "  isPlatformAdmin: boolean; name: string | null; permissions?: Permission[]; customRoleId?: string | null;",
    "}"),
  L(
    "export interface MpinLoginResponse {",
    "  token: string; organizationId: string | null; role: string | null;",
    "  isPlatformAdmin: boolean; name: string | null; permissions?: Permission[]; customRoleId?: string | null;",
    "  deniedModules?: string[];",
    "}"),
  "deniedModules?: string[];\n}"
);

edit("../frontend/lib/api.ts",
  "    permissions: Permission[]; customRoleId: string | null;",
  "    permissions: Permission[]; customRoleId: string | null; deniedModules?: string[];",
  "customRoleId: string | null; deniedModules?: string[];"
);

edit("../frontend/components/layout/navGroups.ts",
  "  items: NavItem[];",
  L(
    "  items: NavItem[];",
    "  /**",
    "   * The subscription module this whole group belongs to. Undefined means",
    "   * the group is part of the product rather than a module anybody can be",
    "   * without - Accounting, Configuration and the statutory reports are the",
    "   * books themselves, and an organisation that gives up Inventory still",
    "   * keeps them.",
    "   *",
    "   * Matched against the DENY list from login, never an allow list: a group",
    "   * disappears only when its module was explicitly withdrawn. See",
    "   * backend/src/lib/entitlements.ts for why round that way.",
    "   *",
    "   * Hiding is a courtesy, not a control. requireModule() on the matching",
    "   * routes is what actually refuses, exactly as requirePermission() is the",
    "   * authority behind `roles` and `permission` above.",
    "   */",
    "  module?: \"ACCOUNTING\" | \"SALES\" | \"PURCHASE\" | \"INVENTORY\" | \"BOM\";"),
  "module?: \"ACCOUNTING\" | \"SALES\" | \"PURCHASE\" | \"INVENTORY\" | \"BOM\";"
);

edit("../frontend/components/layout/navGroups.ts",
  "    icon: \"I\",",
  L(
    "    icon: \"I\",",
    "    module: \"INVENTORY\","),
  "    module: \"INVENTORY\","
);

edit("../frontend/components/layout/navGroups.ts",
  "    icon: \"M\",",
  L(
    "    icon: \"M\",",
    "    module: \"BOM\","),
  "    module: \"BOM\","
);

edit("../frontend/components/layout/AppShell.tsx",
  "import { canUseChatbot, clearSession, getCustomRoleId, getName, getPermissions, getRole, isLoggedIn, isPlatformAdmin } from \"@/lib/auth\";",
  "import { canUseChatbot, clearSession, getCustomRoleId, getDeniedModules, getName, getPermissions, getRole, isLoggedIn, isPlatformAdmin } from \"@/lib/auth\";",
  "getCustomRoleId, getDeniedModules, getName"
);

edit("../frontend/components/layout/AppShell.tsx",
  L(
    "  const allowedGroups = NAV_GROUPS.map((g) => ({",
    "    ...g,",
    "    items: g.items.filter((i) => isVisible(i)),",
    "  })).filter((g) => g.items.length > 0);"),
  L(
    "  // A group whose module has been WITHDRAWN is not offered at all, before",
    "  // roles and permissions are considered - those answer \"may this person\",",
    "  // this answers \"does this organisation have it\". Absence of a module in",
    "  // the deny list means keep showing it, so an org with no org_modules rows",
    "  // sees exactly what it saw before this existed.",
    "  //",
    "  // Read once per render from the login snapshot, so cancelling a",
    "  // subscription reaches an already-open session only at next login. The",
    "  // API refuses immediately either way, so the gap shows a menu entry that",
    "  // returns a clear 402 rather than a screen nobody should reach.",
    "  const denied = getDeniedModules();",
    "  const allowedGroups = NAV_GROUPS.filter((g) => !g.module || !denied.includes(g.module))",
    "    .map((g) => ({",
    "      ...g,",
    "      items: g.items.filter((i) => isVisible(i)),",
    "    })).filter((g) => g.items.length > 0);"),
  "const denied = getDeniedModules();"
);

edit("../frontend/app/login/page.tsx",
  "    setSession(res.token, res.organizationId, res.role, res.isPlatformAdmin, res.name, res.permissions, res.customRoleId);",
  "    setSession(res.token, res.organizationId, res.role, res.isPlatformAdmin, res.name, res.permissions, res.customRoleId, res.deniedModules);",
  "res.customRoleId, res.deniedModules);"
);

edit("../frontend/app/accept-invite/page.tsx",
  "      setSession(res.token, res.organizationId, res.role, false, res.name, res.permissions, res.customRoleId);",
  "      setSession(res.token, res.organizationId, res.role, false, res.name, res.permissions, res.customRoleId, res.deniedModules);",
  "res.customRoleId, res.deniedModules);"
);

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["../frontend/lib/auth.ts","../frontend/lib/api.ts","../frontend/components/layout/navGroups.ts","../frontend/components/layout/AppShell.tsx","../frontend/app/login/page.tsx","../frontend/app/accept-invite/page.tsx"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}