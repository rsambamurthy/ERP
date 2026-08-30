// SmartERP - Charge Master.
//
// Script 6 of 12: frontend/lib/api.ts and the sidebar.
//
// SCREEN TOUCHED: Configuration > Charge Master appears in the menu,
// under Chart of Accounts. OWNER/ADMIN, gated on coa.manage.
//
// Save this as backend/tests/cmF.mjs and run it from backend/:
//   node tests/cmF.mjs
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

edit("../frontend/lib/api.ts",
  L(
    "",
    "// \u2500\u2500 Company Master \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"),
  L(
    "",
    "// \u2500\u2500 Charge Master \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "//",
    "// The labels an invoice may put on freight, packing and insurance, each",
    "// bound to the income account it credits. Chosen, never typed - see",
    "// migration_055 for what free text did to reporting.",
    "",
    "export interface ChargeType {",
    "  id: string;",
    "  label: string;",
    "  accountId: string;",
    "  isActive: boolean;",
    "  sortOrder: number;",
    "  account: { id: string; accountCode: string; accountName: string; accountType: string };",
    "}",
    "",
    "// Active only by default, which is what the invoice picker wants;",
    "// includeInactive is for the master screen, which has to show a retired",
    "// type in order to bring it back.",
    "export function getChargeTypes(includeInactive = false) {",
    "  return request<{ data: ChargeType[] }>(",
    "    `/charge-types${includeInactive ? \"?includeInactive=true\" : \"\"}`",
    "  );",
    "}",
    "",
    "export function createChargeType(body: { label: string; accountId: string; sortOrder?: number }) {",
    "  return request<{ data: ChargeType }>(\"/charge-types\", { method: \"POST\", body: JSON.stringify(body) });",
    "}",
    "",
    "export function updateChargeType(id: string, body: { label?: string; accountId?: string; sortOrder?: number }) {",
    "  return request<{ data: ChargeType }>(`/charge-types/${id}`, { method: \"PATCH\", body: JSON.stringify(body) });",
    "}",
    "",
    "// There is no delete. A charge type that has been used is referenced by",
    "// documents; retiring it takes it out of the picker and leaves every",
    "// invoice it ever appeared on exactly as it was.",
    "export function toggleChargeType(id: string) {",
    "  return request<{ data: ChargeType }>(`/charge-types/${id}/toggle`, { method: \"PATCH\" });",
    "}",
    "",
    "// \u2500\u2500 Company Master \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"),
  "export function updateChargeType(id: string, body: { label?: string; accountId?: string; sortOrder?: number }) {");

edit("../frontend/lib/api.ts",
  L(
    "  negativeStockReason?: string;",
    "  // Freight, packing, insurance. Document-level, each with its own INCOME",
    "  // account, prorated across the lines server-side so the tax follows the",
    "  // goods' rate - a charge deliberately has no rate of its own.",
    "  charges?: { label: string; accountId: string; amount: number }[];",
    "}) {"),
  L(
    "  negativeStockReason?: string;",
    "  // Freight, packing, insurance. Only the type and the amount: the label",
    "  // and the income account come from the Charge Master server-side, so one",
    "  // organisation's \"Delivery charges\" is the same three words and the same",
    "  // head on every invoice it ever raises. Prorated across the lines so the",
    "  // tax follows the goods' rate - a charge has no rate of its own.",
    "  charges?: { chargeTypeId: string; amount: number }[];",
    "}) {"),
  "// and the income account come from the Charge Master server-side, so one");

edit("../frontend/components/layout/navGroups.ts",
  L(
    "      { id: \"chart_of_accounts\", label: \"Chart of Accounts\", path: \"/accounting/chart-of-accounts\", dot: \"#2563eb\", roles: ALL_ROLES },",
    "      { id: \"business_partners\", label: \"Business Partners\", path: \"/accounting/business-partners\", dot: \"#0891b2\", roles: ALL_ROLES },"),
  L(
    "      { id: \"chart_of_accounts\", label: \"Chart of Accounts\", path: \"/accounting/chart-of-accounts\", dot: \"#2563eb\", roles: ALL_ROLES },",
    "      // Beside Chart of Accounts rather than under Sales, because the only",
    "      // thing a charge type decides is which income head a recovery lands",
    "      // in \u2014 and it is gated on coa.manage for the same reason.",
    "      // OWNER/ADMIN only, matching Currency Master: ACCOUNTANT deliberately",
    "      // holds none of the master-data permissions (coa.manage,",
    "      // items.manage, currency.manage), so listing it here would show a",
    "      // screen whose every button the API then refuses.",
    "      { id: \"charge_master\", label: \"Charge Master\", path: \"/settings/charge-master\", dot: \"#16a34a\", roles: [\"OWNER\", \"ADMIN\"], permission: \"coa.manage\" },",
    "      { id: \"business_partners\", label: \"Business Partners\", path: \"/accounting/business-partners\", dot: \"#0891b2\", roles: ALL_ROLES },"),
  "{ id: \"charge_master\", label: \"Charge Master\", path: \"/settings/charge-master\", dot: \"#16a34a\", roles: [\"OWNER\", \"ADMIN\"], permission: \"coa.manage\" },");

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["../frontend/lib/api.ts","../frontend/components/layout/navGroups.ts"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}