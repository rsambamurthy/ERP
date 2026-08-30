// modB - mount the guard, and tell the sidebar. Run modA first.
//
// Four routers gain requireModule at the mount, so a route added to any of
// those files tomorrow is covered the day it is written:
//
//   /inventory /stock-adjustments /stock-transfers   INVENTORY
//   /production-orders                               BOM
//
// Production is BOM rather than Inventory because it consumes a bill of
// materials; an organisation can hold one module without the other.
//
// NOT GATED, and this is the important half: /items, /purchase-bills,
// /sales-invoices, /journal and the reports. Giving up Inventory means
// giving up stock MOVEMENT, not the books. modC handles /items, which needs
// finer treatment than a mount because SERVICE items live there too.
//
// The login response also gains deniedModules, which is what lets the
// sidebar stop offering screens the organisation no longer holds.
//
// Save this as backend/tests/modB.mjs and run it from backend/:
//   node tests/modB.mjs
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

edit("src/routes/auth.ts",
  "import { builtInPermissions, Permission } from \"../lib/permissions\";",
  L(
    "import { builtInPermissions, Permission } from \"../lib/permissions\";",
    "import { deniedModuleCodes } from \"../lib/entitlements\";"),
  "import { deniedModuleCodes } from \"../lib/entitlements\";"
);

edit("src/routes/auth.ts",
  L(
    "  const permissions = await resolvePermissions(orgUser.role, orgUser.customRoleId);",
    "",
    "  return {",
    "    token, organizationId: orgUser.organizationId, role: orgUser.role, isPlatformAdmin: false, name: user.name,",
    "    permissions, customRoleId: orgUser.customRoleId,"),
  L(
    "  const permissions = await resolvePermissions(orgUser.role, orgUser.customRoleId);",
    "  // Modules this organisation has had WITHDRAWN \u2014 a deny list, never an",
    "  // allow list. See lib/entitlements.ts for why round that way. The sidebar",
    "  // uses it to stop offering screens the organisation no longer subscribes",
    "  // to; requireModule() is what actually refuses them, exactly as",
    "  // `permissions` above is a snapshot for the sidebar and requirePermission()",
    "  // is the enforcement.",
    "  //",
    "  // A SNAPSHOT, like permissions: cancelling a module while somebody is",
    "  // logged in does not change their menu until they next log in. The API",
    "  // refuses them from the moment it is cancelled, so the worst case is a",
    "  // menu item that returns a clear 402 rather than a screen they should not",
    "  // have reached.",
    "  const deniedModules = await deniedModuleCodes(orgUser.organizationId);",
    "",
    "  return {",
    "    token, organizationId: orgUser.organizationId, role: orgUser.role, isPlatformAdmin: false, name: user.name,",
    "    permissions, customRoleId: orgUser.customRoleId, deniedModules,"),
  "const deniedModules = await deniedModuleCodes(orgUser.organizationId);"
);

edit("src/routes/inventory.ts",
  "import { authenticate, requireActiveSubscription, resolveOrgId } from \"../middleware/auth\";",
  "import { authenticate, requireActiveSubscription, requireModule, resolveOrgId } from \"../middleware/auth\";",
  "requireActiveSubscription, requireModule, resolveOrgId"
);

edit("src/routes/inventory.ts",
  "router.use(authenticate, requireActiveSubscription);",
  L(
    "// Stock movement, valuation and the stock ledger are the Inventory",
    "// module itself. An organisation that has given it up keeps its books,",
    "// its bills and its invoices - it just stops moving stock.",
    "router.use(authenticate, requireActiveSubscription, requireModule(\"INVENTORY\"));"),
  "requireModule(\"INVENTORY\"));"
);

edit("src/routes/stockAdjustments.ts",
  "import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from \"../middleware/auth\";",
  "import { authenticate, requirePermission, requireActiveSubscription, requireModule, resolveOrgId } from \"../middleware/auth\";",
  "requireActiveSubscription, requireModule, resolveOrgId"
);

edit("src/routes/stockAdjustments.ts",
  "router.use(authenticate, requireActiveSubscription);",
  L(
    "// Stock movement, valuation and the stock ledger are the Inventory",
    "// module itself. An organisation that has given it up keeps its books,",
    "// its bills and its invoices - it just stops moving stock.",
    "router.use(authenticate, requireActiveSubscription, requireModule(\"INVENTORY\"));"),
  "requireModule(\"INVENTORY\"));"
);

edit("src/routes/stockTransfers.ts",
  "import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from \"../middleware/auth\";",
  "import { authenticate, requirePermission, requireActiveSubscription, requireModule, resolveOrgId } from \"../middleware/auth\";",
  "requireActiveSubscription, requireModule, resolveOrgId"
);

edit("src/routes/stockTransfers.ts",
  "router.use(authenticate, requireActiveSubscription);",
  L(
    "// Stock movement, valuation and the stock ledger are the Inventory",
    "// module itself. An organisation that has given it up keeps its books,",
    "// its bills and its invoices - it just stops moving stock.",
    "router.use(authenticate, requireActiveSubscription, requireModule(\"INVENTORY\"));"),
  "requireModule(\"INVENTORY\"));"
);

edit("src/routes/productionOrders.ts",
  "import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from \"../middleware/auth\";",
  "import { authenticate, requirePermission, requireActiveSubscription, requireModule, resolveOrgId } from \"../middleware/auth\";",
  "requireActiveSubscription, requireModule, resolveOrgId"
);

edit("src/routes/productionOrders.ts",
  "router.use(authenticate, requireActiveSubscription);",
  L(
    "// Production consumes a BOM, so it belongs to that module rather than to",
    "// Inventory. An organisation can hold one without the other.",
    "router.use(authenticate, requireActiveSubscription, requireModule(\"BOM\"));"),
  "requireModule(\"BOM\"));"
);

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["src/routes/auth.ts","src/routes/inventory.ts","src/routes/stockAdjustments.ts","src/routes/stockTransfers.ts","src/routes/productionOrders.ts"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}