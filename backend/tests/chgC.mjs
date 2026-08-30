// SmartERP - freight, packing and insurance on a sales invoice.
//
// Script 3 of 7: backend/src/lib/discountGst.ts - the proration itself.
//
// This is the file that makes the tax right. A charge is spread across the
// goods lines by post-discount value and lands INSIDE each line's taxable
// value before GST is computed, so it is taxed at the goods' rate.
//
// Save this as backend/tests/chgC.mjs and run it from backend/:
//   node tests/chgC.mjs
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

edit("src/lib/discountGst.ts",
  "  invoiceDiscountShare: number;",
  L(
    "  invoiceDiscountShare: number;",
    "  // This line's share of the document-level charges. ADDS to the taxable",
    "  // value, where the two discounts above subtract from it.",
    "  chargeShare: number;"),
  "// This line's share of the document-level charges. ADDS to the taxable");

edit("src/lib/discountGst.ts",
  "// charged).",
  L(
    "// charged).",
    "//",
    "// CHARGES ARE PRORATED THE SAME WAY, WITH THE OPPOSITE SIGN, and that is",
    "// the whole reason freight on this invoice gets taxed correctly.",
    "//",
    "// Section 15(2)(c) puts incidental expenses - packing, and anything the",
    "// supplier does in respect of the supply at or before delivery - inside the",
    "// VALUE of the supply, and section 8(a) taxes a composite supply at the",
    "// rate of the PRINCIPAL supply. So delivery charged on an invoice for pumps",
    "// at 18% is taxed at 18%, under the pumps' HSN, not at 5% under SAC 9965.",
    "//",
    "// Prorating the charge into each line's taxable value before GST is",
    "// computed makes that true by construction. There is no way to give a",
    "// charge a rate of its own here, because it never has one to give - it",
    "// simply increases the value of the goods it accompanies, which is what the",
    "// Act says it does. Add it as a line with its own rate instead and every",
    "// invoice carrying freight understates output tax.",
    "//",
    "// Prorated by post-discount value, so a charge follows the money rather",
    "// than the line count: a 900.00 line carries nine times the freight of a",
    "// 100.00 one. Last line eats the rounding, exactly as the discount does."),
  "// supplier does in respect of the supply at or before delivery - inside the");

edit("src/lib/discountGst.ts",
  "  interState: boolean",
  L(
    "  interState: boolean,",
    "  // Total of the document-level charges - freight, packing, insurance.",
    "  // See the note above the proration below.",
    "  chargesTotal = 0"),
  "// Total of the document-level charges - freight, packing, insurance.");

edit("src/lib/discountGst.ts",
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

edit("src/lib/discountGst.ts",
  "  let assignedShare = 0;",
  L(
    "  let assignedShare = 0;",
    "  let assignedCharge = 0;"),
  "let assignedCharge = 0;");

edit("src/lib/discountGst.ts",
  "  return step1.map((l, idx) => {",
  L(
    "  return step1.map((l, idx) => {",
    "    const last = idx === step1.length - 1;"),
  "const last = idx === step1.length - 1;");

edit("src/lib/discountGst.ts",
  "    if (idx === step1.length - 1) {",
  "    if (last) {",
  "    if (last) {");

edit("src/lib/discountGst.ts",
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

edit("src/lib/discountGst.ts",
  "      invoiceDiscountShare: share,",
  L(
    "      invoiceDiscountShare: share,",
    "      chargeShare,"),
  "chargeShare,");

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["src/lib/discountGst.ts"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}