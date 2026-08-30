// modA - the entitlement rule, and the guard that applies it.
//
// Creates src/lib/entitlements.ts and adds requireModule() to
// src/middleware/auth.ts. Nothing is gated yet - modB mounts the guard.
//
// THE RULE, and it is the whole design: ABSENCE IS NOT DENIAL. A row that
// says CANCELLED, or one that has expired, is a decision somebody made and
// it denies. NO ROW AT ALL is not a decision - it is an organisation
// provisioned before those rows were written - and reading it as
// 'unsubscribed' would lock a working tenant out of screens it has used for
// months. So the answer is phrased as a DENY list rather than an allow list:
// an allow list would come back empty for such an organisation, and a
// sidebar filtering on it would hide everything.
//
// 402 rather than 403 in the guard, deliberately. 403 tells a user they are
// not allowed, which they cannot act on and which is not even true - their
// role permits it. 402 says the ORGANISATION's entitlement is the problem.
//
// Save this as backend/tests/modA.mjs and run it from backend/:
//   node tests/modA.mjs
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
function create(file, text, done) {
  if (fs.existsSync(at(file)) && read(file).includes(done)) { already++; return; }
  save(file, text);
  applied++;
}

create("src/lib/entitlements.ts", L(
    "import { prisma } from \"../db\";",
    "",
    "// WHICH MODULES AN ORGANISATION HAS HAD WITHDRAWN.",
    "//",
    "// `org_modules` has existed since provisioning was written, and until now",
    "// nothing read it outside the platform admin console. Cancelling a",
    "// subscription set a row to CANCELLED and changed nothing else: the menu",
    "// still offered the screens and the API still served them. This module is",
    "// the missing half - one place that answers \"may this organisation use",
    "// INVENTORY\", used by the sidebar to decide what to offer and by",
    "// requireModule() to decide what to serve.",
    "//",
    "// ABSENCE IS NOT DENIAL, and that is the whole design.",
    "//",
    "// A row that says CANCELLED, or one whose expires_on has passed, is a",
    "// decision somebody made, and it denies. NO ROW AT ALL is not a decision -",
    "// it is an organisation that predates the provisioning code that writes",
    "// these rows, and reading that as \"unsubscribed\" would lock a working",
    "// tenant out of screens it has used for months. The admin console's",
    "// UNSUBSCRIBED filter does read no-rows that way, which is right for a",
    "// sales dashboard and wrong for an access check.",
    "//",
    "// SO THE ANSWER IS PHRASED AS A DENY LIST, not an allow list, and that is",
    "// deliberate rather than stylistic. An allow list of active grants would",
    "// come back EMPTY for an unprovisioned organisation, and a sidebar",
    "// filtering on it would hide every gated group - the exact lockout this",
    "// rule exists to prevent, reintroduced by the shape of the data. A deny",
    "// list cannot fail that way: nothing withdrawn means nothing hidden.",
    "//",
    "// Once every organisation is known to be provisioned this can be tightened",
    "// to deny-by-default. That will be a deliberate migration with a list of",
    "// affected tenants attached, not a silent consequence of this change.",
    "",
    "export type ModuleCode = \"ACCOUNTING\" | \"SALES\" | \"PURCHASE\" | \"INVENTORY\" | \"BOM\";",
    "",
    "// True when the organisation may use the module: an ACTIVE unexpired grant,",
    "// or no grant recorded at all. False only where a grant exists and has been",
    "// withdrawn or has lapsed.",
    "export async function holdsModule(organizationId: string, code: ModuleCode): Promise<boolean> {",
    "  const row = await prisma.orgModule.findFirst({",
    "    where: { organizationId, module: { code } },",
    "    select: { status: true, expiresOn: true },",
    "  });",
    "  if (!row) return true;",
    "  if (row.status !== \"ACTIVE\") return false;",
    "  if (row.expiresOn && row.expiresOn < new Date()) return false;",
    "  return true;",
    "}",
    "",
    "// The codes this organisation may NOT use, for the login response. The",
    "// sidebar hides a nav group when its module appears here and shows it",
    "// otherwise, so an organisation with no rows gets [] and sees everything -",
    "// which is the same answer holdsModule() gives, reached the same way.",
    "//",
    "// One query rather than five holdsModule() calls: this runs on every login.",
    "export async function deniedModuleCodes(organizationId: string): Promise<string[]> {",
    "  const now = new Date();",
    "  const rows = await prisma.orgModule.findMany({",
    "    where: { organizationId },",
    "    select: { status: true, expiresOn: true, module: { select: { code: true } } },",
    "  });",
    "  return rows",
    "    .filter((r) => r.status !== \"ACTIVE\" || (r.expiresOn !== null && r.expiresOn < now))",
    "    .map((r) => r.module.code)",
    "    .sort();",
    "}"
),
  "export async function holdsModule(");

edit("src/middleware/auth.ts",
  "import { Permission, builtInPermissions } from \"../lib/permissions\";",
  L(
    "import { Permission, builtInPermissions } from \"../lib/permissions\";",
    "import { ModuleCode, holdsModule } from \"../lib/entitlements\";"),
  "import { ModuleCode, holdsModule } from \"../lib/entitlements\";"
);

edit("src/middleware/auth.ts",
  L(
    "  if (org?.orgUsers[0]?.status === \"SUSPENDED\") {",
    "    return res.status(403).json({ message: \"Your access has been suspended. Contact your organization admin.\" });",
    "  }",
    "  next();",
    "}"),
  L(
    "  if (org?.orgUsers[0]?.status === \"SUSPENDED\") {",
    "    return res.status(403).json({ message: \"Your access has been suspended. Contact your organization admin.\" });",
    "  }",
    "  next();",
    "}",
    "",
    "// The module entitlement guard. requireActiveSubscription() above asks",
    "// whether the ORGANISATION and the USER are active; this asks whether the",
    "// organisation still holds the module the route belongs to.",
    "//",
    "// Until this existed, cancelling a subscription in the platform admin",
    "// console wrote CANCELLED to org_modules and nothing consulted it - the",
    "// screens stayed in the menu and the endpoints kept serving. The console",
    "// reported a state the API did not honour.",
    "//",
    "// 402 rather than 403 on purpose. 403 says \"you are not allowed to do",
    "// this\", which a user cannot act on; 402 Payment Required says the",
    "// organisation's entitlement is the problem, which is a thing somebody can",
    "// go and fix. Same status requireActiveSubscription() already uses for a",
    "// suspended subscription, for the same reason.",
    "//",
    "// WHAT THIS DELIBERATELY DOES NOT GATE: /items, /purchase-bills,",
    "// /sales-invoices, /journal and the reports. An organisation that gives up",
    "// Inventory is giving up stock movement, not its books - it keeps buying,",
    "// selling, and filing, and it keeps the Items master because SERVICE items",
    "// live there too and are the one master a business without stock needs",
    "// most. Gate that and \"we cancelled Inventory\" becomes \"the app stopped",
    "// working\", which is not what anybody agreed to.",
    "export function requireModule(code: ModuleCode) {",
    "  return async function (req: Request, res: Response, next: NextFunction) {",
    "    if (req.user?.isPlatformAdmin) return next();",
    "    const organizationId = req.user?.organizationId;",
    "    if (!organizationId) return next();",
    "    if (await holdsModule(organizationId, code)) return next();",
    "    return res.status(402).json({",
    "      message: `This organization's ${MODULE_LABEL[code]} subscription is not active. Contact support.`,",
    "    });",
    "  };",
    "}",
    "",
    "const MODULE_LABEL: Record<ModuleCode, string> = {",
    "  ACCOUNTING: \"Accounting\",",
    "  SALES: \"Sales\",",
    "  PURCHASE: \"Purchase\",",
    "  INVENTORY: \"Inventory\",",
    "  BOM: \"Bill of Materials\",",
    "};"),
  "export function requireModule(code: ModuleCode) {"
);

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["src/lib/entitlements.ts","src/middleware/auth.ts"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}