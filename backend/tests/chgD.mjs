// SmartERP - freight, packing and insurance on a sales invoice.
//
// Script 4 of 7: frontend/lib/discountGst.ts and frontend/lib/api.ts.
//
// The same arithmetic as chgC. The two copies must stay identical or the
// totals strip on the invoice screen will disagree with the document the
// server actually posts.
//
// Save this as backend/tests/chgD.mjs and run it from backend/:
//   node tests/chgD.mjs
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

edit("../frontend/lib/discountGst.ts",
  "  interState: boolean",
  L(
    "  interState: boolean,",
    "  // Total of the document-level charges - freight, packing, insurance.",
    "  // See the note above the proration below.",
    "  chargesTotal = 0"),
  "// Total of the document-level charges - freight, packing, insurance.");

edit("../frontend/lib/discountGst.ts",
  L(
    "",
    "  let assignedShare = 0;"),
  L(
    "",
    "  // Base for the CHARGE proration: what each line is worth after both",
    "  // discounts. Computed here rather than inside the loop because the",
    "  // denominator has to be the whole invoice, not the part seen so far.",
    "  const netOfBothDiscounts = step1.map((l, idx) => {",
    "    const d = invoiceDiscountAmount === 0 ? 0",
    "      : subtotalAfterLineDiscount > 0",
    "        ? round2((invoiceDiscountAmount * l.netOfLineDiscount) / subtotalAfterLineDiscount)",
    "        : 0;",
    "    return round2(l.netOfLineDiscount - d);",
    "  });",
    "  const netTotal = round2(netOfBothDiscounts.reduce((s, v) => s + v, 0));",
    "  const charges = round2(Math.max(0, chargesTotal));",
    "",
    "  let assignedShare = 0;"),
  "const netTotal = round2(netOfBothDiscounts.reduce((s, v) => s + v, 0));");

edit("../frontend/lib/discountGst.ts",
  "  let assignedShare = 0;",
  L(
    "  let assignedShare = 0;",
    "  let assignedCharge = 0;"),
  "let assignedCharge = 0;");

edit("../frontend/lib/discountGst.ts",
  "  return step1.map((l, idx) => {",
  L(
    "  return step1.map((l, idx) => {",
    "    const last = idx === step1.length - 1;"),
  "const last = idx === step1.length - 1;");

edit("../frontend/lib/discountGst.ts",
  "    if (idx === step1.length - 1) {",
  "    if (last) {",
  "    if (last) {");

edit("../frontend/lib/discountGst.ts",
  "    const taxableValue = round2(l.netOfLineDiscount - share);",
  L(
    "    let chargeShare: number;",
    "    if (last) {",
    "      chargeShare = round2(charges - assignedCharge);",
    "    } else {",
    "      chargeShare = netTotal > 0 ? round2((charges * netOfBothDiscounts[idx]) / netTotal) : 0;",
    "      assignedCharge = round2(assignedCharge + chargeShare);",
    "    }",
    "    const taxableValue = round2(l.netOfLineDiscount - share + chargeShare);"),
  "chargeShare = netTotal > 0 ? round2((charges * netOfBothDiscounts[idx]) / netTotal) : 0;");

edit("../frontend/lib/discountGst.ts",
  "      invoiceDiscountShare: share,",
  L(
    "      invoiceDiscountShare: share,",
    "      chargeShare,"),
  "chargeShare,");

edit("../frontend/lib/api.ts",
  "  negativeStockReason?: string;",
  L(
    "  negativeStockReason?: string;",
    "  // Freight, packing, insurance. Document-level, each with its own INCOME",
    "  // account, prorated across the lines server-side so the tax follows the",
    "  // goods' rate - a charge deliberately has no rate of its own.",
    "  charges?: { label: string; accountId: string; amount: number }[];"),
  "// Freight, packing, insurance. Document-level, each with its own INCOME");

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["../frontend/lib/discountGst.ts","../frontend/lib/api.ts"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}