// modC - the Items master, which needs finer treatment than a mount.
// Run modA and modB first.
//
// /items is NOT gated as a whole, and that is the point. It looks like an
// Inventory screen and is not: a SERVICE item holds no stock, debits an
// expense head, and is the one master a business without inventory needs
// MOST - it is how they record what they buy. Gate the router and
// 'we cancelled Inventory' becomes 'the app stopped working'.
//
// So the gates go on the parts that really are stock: the costing method,
// the BOM endpoints, bulk upload (every row it creates is a STOCK item),
// and creating a STOCK item.
//
// AND ONE FIX THAT THIS CHANGE MAKES NECESSARY. POST /items refused EVERY
// item, service included, until the organisation had set a stock costing
// method - and setting one is now an Inventory operation. Left alone, an
// organisation without Inventory could set no method, so could create no
// item, so could raise no purchase bill: its books shut by an entitlement
// about stock. The costing-method check now binds STOCK items only.
//
// Save this as backend/tests/modC.mjs and run it from backend/:
//   node tests/modC.mjs
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

edit("src/routes/items.ts",
  "import { authenticate, requirePermission, requireActiveSubscription, resolveOrgId } from \"../middleware/auth\";",
  "import { authenticate, requirePermission, requireActiveSubscription, requireModule, resolveOrgId } from \"../middleware/auth\";",
  "requireActiveSubscription, requireModule, resolveOrgId"
);

edit("src/routes/items.ts",
  "import { buildTemplateWorkbook, loadUploadedWorksheet, cellText } from \"../lib/xlsxTemplate\";",
  L(
    "import { buildTemplateWorkbook, loadUploadedWorksheet, cellText } from \"../lib/xlsxTemplate\";",
    "import { holdsModule } from \"../lib/entitlements\";"),
  "import { holdsModule } from \"../lib/entitlements\";"
);

edit("src/routes/items.ts",
  "router.post(\"/costing-method\", canManageItems, async (req, res) => {",
  L(
    "// Weighted Average vs FIFO decides how STOCK is valued, so setting it is an",
    "// Inventory operation. Reading it above stays open: the gate screen asks",
    "// before it offers, and an organisation without Inventory should be told",
    "// \"not set\" rather than shown an error.",
    "router.post(\"/costing-method\", canManageItems, requireModule(\"INVENTORY\"), async (req, res) => {"),
  "router.post(\"/costing-method\", canManageItems, requireModule(\"INVENTORY\")"
);

edit("src/routes/items.ts",
  "router.get(\"/:id/bom\", async (req, res) => {",
  L(
    "// A BOM belongs to the Bill of Materials module, not to Items. The Items",
    "// master itself is deliberately ungated - a SERVICE item is the one master",
    "// an organisation without stock needs most, and it lives here.",
    "router.get(\"/:id/bom\", requireModule(\"BOM\"), async (req, res) => {"),
  "router.get(\"/:id/bom\", requireModule(\"BOM\")"
);

edit("src/routes/items.ts",
  "router.put(\"/:id/bom\", canManageItems, async (req, res) => {",
  "router.put(\"/:id/bom\", canManageItems, requireModule(\"BOM\"), async (req, res) => {",
  "router.put(\"/:id/bom\", canManageItems, requireModule(\"BOM\")"
);

edit("src/routes/items.ts",
  L(
    "  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true } });",
    "  if (!org?.costingMethod) {",
    "    return res.status(422).json({ message: \"Set the organization's stock costing method before adding items.\" });"),
  L(
    "  // Declared out here because the opening-stock block far below needs it.",
    "  // Null for a SERVICE item, and that block cannot run for one: qty is",
    "  // forced to 0 a few lines down for SERVICE, and the block is guarded on",
    "  // qty > 0. So the non-null assertion at its only use site is carried by",
    "  // this comment rather than by hope.",
    "  let costingMethod: string | null = null;",
    "",
    "  // BOTH CHECKS BELOW ARE STOCK-ONLY, and that is the fix rather than an",
    "  // optimisation. A SERVICE item holds no stock: it has no cost layers for a",
    "  // costing method to govern and nothing for the Inventory module to move.",
    "  // It debits an expense head and that is the whole of it.",
    "  //",
    "  // Requiring a costing method for EVERY item meant an organisation with no",
    "  // inventory could not create the one kind of item it actually needs, and",
    "  // gating POST /costing-method on INVENTORY - as this change does - would",
    "  // have made that permanent: no method may be set, so no item may be",
    "  // created, so no purchase bill may be raised. The books would have been",
    "  // shut by an entitlement about stock.",
    "  if (kind === \"STOCK\") {",
    "    if (!(await holdsModule(organizationId, \"INVENTORY\"))) {",
    "      return res.status(402).json({",
    "        message: \"This organization's Inventory subscription is not active \u2014 only service items can be added.\",",
    "      });",
    "    }",
    "    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true } });",
    "    if (!org?.costingMethod) {",
    "      return res.status(422).json({ message: \"Set the organization's stock costing method before adding items.\" });",
    "    }",
    "    costingMethod = org.costingMethod;"),
  "let costingMethod: string | null = null;"
);

edit("src/routes/items.ts",
  "        quantity: qty, unitCost: cost, costingMethod: org.costingMethod!,",
  "        quantity: qty, unitCost: cost, costingMethod: costingMethod!,",
  "unitCost: cost, costingMethod: costingMethod!,"
);

edit("src/routes/items.ts",
  "router.get(\"/bulk-upload/template\", canManageItems, async (req, res) => {",
  L(
    "// The whole bulk-upload feature resolves item CONTROL accounts, so every",
    "// row it creates is a STOCK item. Gated at the template rather than only at",
    "// apply: being refused before you fill a spreadsheet in is kinder than",
    "// being refused after.",
    "router.get(\"/bulk-upload/template\", canManageItems, requireModule(\"INVENTORY\"), async (req, res) => {"),
  "router.get(\"/bulk-upload/template\", canManageItems, requireModule(\"INVENTORY\")"
);

edit("src/routes/items.ts",
  "router.post(\"/bulk-upload/preview\", canManageItems, upload.single(\"file\"), async (req, res) => {",
  "router.post(\"/bulk-upload/preview\", canManageItems, requireModule(\"INVENTORY\"), upload.single(\"file\"), async (req, res) => {",
  "router.post(\"/bulk-upload/preview\", canManageItems, requireModule(\"INVENTORY\")"
);

edit("src/routes/items.ts",
  "router.post(\"/bulk-upload/apply\", canManageItems, async (req, res) => {",
  "router.post(\"/bulk-upload/apply\", canManageItems, requireModule(\"INVENTORY\"), async (req, res) => {",
  "router.post(\"/bulk-upload/apply\", canManageItems, requireModule(\"INVENTORY\")"
);

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["src/routes/items.ts"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}