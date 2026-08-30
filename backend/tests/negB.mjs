// negB - the costing engine. Run negA first, and `npx prisma generate`.
//
// consumeStock() gains allowNegative. When it is set - and ONLY a sales
// invoice ever sets it - the balance is allowed below zero and the whole
// quantity leaves at the stored weighted average, including the part the
// branch did not hold.
//
// That average is the only defensible cost available, and for the shortfall
// it is a forecast rather than a fact: when the real purchase lands at a
// different rate the COGS already posted is wrong and nothing goes back to
// correct it. The margin on a negative-stock sale is an estimate.
//
// FIFO REFUSES EVEN WITH THE FLAG SET. Weighted average always has an
// answer to 'at what cost did this leave'. FIFO's answer is a lot, and for
// the shortfall there is no lot - nothing was received to consume from.
// Inventing one means inventing a cost and a date and reconciling them
// against whatever actually arrives, which is a different feature.
//
// Two smaller things: itemStock.update becomes an upsert, because an
// override can sell an item the branch has no row for at all; and the
// return gains wentNegative, so the caller can tell 'was it allowed' from
// 'was it used'.
//
// Save this as backend/tests/negB.mjs and run it from backend/:
//   node tests/negB.mjs
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

edit("src/lib/costing.ts",
  L(
    "  movementType: \"SALE\" | \"ADJUSTMENT_OUT\" | \"PRODUCTION_OUT\" | \"TRANSFER_OUT\";",
    "  referenceType: string;",
    "  referenceId: string;",
    "  movementDate: Date;",
    "  narration?: string | null;"),
  L(
    "  movementType: \"SALE\" | \"ADJUSTMENT_OUT\" | \"PRODUCTION_OUT\" | \"TRANSFER_OUT\";",
    "  referenceType: string;",
    "  referenceId: string;",
    "  movementDate: Date;",
    "  narration?: string | null;",
    "  // Let the balance go negative rather than refusing. Set only by a Sales",
    "  // Invoice that explicitly asked for it, in an organisation that permits",
    "  // it. Every other caller - stock adjustments, transfers, production",
    "  // issues, delivery notes - leaves it unset and keeps the old refusal,",
    "  // because none of them is a promise to a customer that somebody has",
    "  // already made.",
    "  allowNegative?: boolean;"),
  "allowNegative?: boolean;"
);

edit("src/lib/costing.ts",
  L(
    "export async function consumeStock(tx: Tx, args: ConsumeArgs): Promise<{ unitCost: number; totalCost: number }> {",
    "  const { organizationId, branchId, itemId, quantity, costingMethod, movementType, referenceType, referenceId, movementDate, narration } = args;"),
  L(
    "// wentNegative says whether this call actually took the balance below",
    "// zero, which is not the same question as whether it was ALLOWED to. An",
    "// invoice can ask for the override and have enough stock after all, and",
    "// recording that as an override would put invoices on the exception",
    "// report that never were one.",
    "export async function consumeStock(tx: Tx, args: ConsumeArgs):",
    "  Promise<{ unitCost: number; totalCost: number; wentNegative: boolean }> {",
    "  const { organizationId, branchId, itemId, quantity, costingMethod, movementType, referenceType, referenceId, movementDate, narration, allowNegative } = args;"),
  "narration, allowNegative } = args;"
);

edit("src/lib/costing.ts",
  "    throw new InsufficientStockError(`Only ${onHand} in stock at this branch \u2014 cannot remove ${quantity}.`);",
  L(
    "    // THE OVERRIDE, and it is narrow on purpose. Two locks have to be open:",
    "    // the organisation must permit negative stock at all, and the document",
    "    // must ask for it \u2014 see routes/salesInvoices.ts. Neither alone is",
    "    // enough, so nobody arrives here by accident.",
    "    if (!allowNegative) {",
    "      throw new InsufficientStockError(`Only ${onHand} in stock at this branch \u2014 cannot remove ${quantity}.`);",
    "    }",
    "    // FIFO REFUSES EVEN WITH THE OVERRIDE ON, and this is not an oversight.",
    "    // Weighted average always has an answer to \"at what cost did this",
    "    // leave?\" \u2014 the stored average, which is a real number computed from",
    "    // real receipts. FIFO's answer is a LOT, and for the shortfall there is",
    "    // no lot: nothing was ever received to consume from. Inventing one",
    "    // means inventing a cost and a date, and then reconciling it against",
    "    // whatever actually arrives later. That is a different feature with its",
    "    // own failure modes, not a flag on this one.",
    "    //",
    "    // The refusal below is also why the \"lots don't cover\" check further",
    "    // down can go on treating that state as corruption rather than as",
    "    // something this path might legitimately produce.",
    "    if (costingMethod === \"FIFO\") {",
    "      throw new InsufficientStockError(",
    "        `Only ${onHand} in stock at this branch. Negative stock is allowed for this organisation, ` +",
    "        `but not under FIFO \u2014 there is no lot to take the shortfall of ${quantity - onHand} from. ` +",
    "        `Receive the stock first.`);",
    "    }"),
  "but not under FIFO"
);

edit("src/lib/costing.ts",
  "  } else {",
  L(
    "  } else {",
    "    // The whole quantity leaves at the stored average, INCLUDING any part of",
    "    // it the branch did not hold. That is the only defensible cost available",
    "    // - it is what every unit of this item has cost on average up to now -",
    "    // but it is a forecast rather than a fact for the shortfall, and when",
    "    // the real receipt lands at a different rate the COGS already posted on",
    "    // that invoice is wrong and nothing goes back to correct it. The margin",
    "    // on a negative-stock sale is an estimate. That is the price of the",
    "    // override and it is why the organisation has to switch it on."),
  "The whole quantity leaves at the stored average, INCLUDING any part of"
);

edit("src/lib/costing.ts",
  L(
    "  await tx.itemStock.update({",
    "    where: { itemId_branchId: { itemId, branchId } },",
    "    data: { quantityOnHand: onHand - quantity }, // averageCost unchanged on consumption"),
  L(
    "  // upsert, not update: an override can sell an item this branch has NO row",
    "  // for at all - never received one unit - and update would throw on the",
    "  // missing row rather than record the negative balance. averageCost stays",
    "  // where it was (0 for an item never held), because consumption never moves",
    "  // the average.",
    "  await tx.itemStock.upsert({",
    "    where: { itemId_branchId: { itemId, branchId } },",
    "    create: {",
    "      itemId, branchId,",
    "      quantityOnHand: onHand - quantity,",
    "      averageCost: Number(stock?.averageCost ?? 0),",
    "    },",
    "    update: { quantityOnHand: onHand - quantity }, // averageCost unchanged on consumption"),
  "// upsert, not update: an override can sell an item this branch has NO row"
);

edit("src/lib/costing.ts",
  "  return { unitCost, totalCost };",
  "  return { unitCost, totalCost, wentNegative: onHand < quantity };",
  "wentNegative: onHand < quantity };"
);

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["src/lib/costing.ts"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}