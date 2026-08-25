// FixH, part 1 of 3 - the purchase-return defect itself.
//
//   node backend/tests/applyFixH.mjs
//
// A capitalised bill line could not be returned AT ALL. Every line went
// through returnStockToVendor, and a capitalisable item is a SERVICE item
// with no stock, so it died on "Only 0 in stock at this branch". The journal
// it would have written was wrong too - it credited the item's
// stockAccountId, which for a SERVICE item is its EXPENSE head.
//
// The treatment is RESCISSION, not disposal. The purchase is undone: the cost
// comes out of the asset account it went into, the depreciation charged
// against it comes back out, and no gain is booked. A gain equal to the
// depreciation already taken, on goods that were simply rejected, would be a
// fiction in the P&L. The reversal is a CURRENT-period entry - this module
// never restates a charge already made, and April may well be closed.
import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8").replace(/\r\n/g, "\n");
const write = (f, t) => fs.writeFileSync(path.join(root, f), t);

let applied = 0, already = 0;
function edit(file, from, to, done) {
  const f = "backend/" + file;
  const t = read(f);
  if (t.includes(done)) { already++; write(f, t); return; }
  const n = t.split(from).length - 1;
  if (n === 0) throw new Error(`anchor not found in ${file}: ${from.slice(0, 70)}`);
  if (n > 1) throw new Error(`anchor is not unique in ${file}: ${from.slice(0, 70)}`);
  write(f, t.replace(from, to));
  applied++;
}

const L = (...lines) => lines.join("\n");

const EDITS = [
["src/routes/purchaseReturns.ts",
 L(
  "const IGST_INPUT_CODE = \"1104\";",
  "",
  "const router = Router();",
  "router.use(authenticate, requireActiveSubscription);"),
 L(
  "const IGST_INPUT_CODE = \"1104\";",
  "",
  "function round2(n: number): number {",
  "  return Math.round((n + Number.EPSILON) * 100) / 100;",
  "}",
  "",
  "const router = Router();",
  "router.use(authenticate, requireActiveSubscription);"),
 "return Math.round((n + Number.EPSILON) * 100) / 100;"],
["src/routes/purchaseReturns.ts",
 L(
  "  const itemById = new Map(items.map((i) => [i.id, i]));",
  "",
  "  const [tradePayables, cgstInput, sgstInput, igstInput] = await Promise.all([",
  "    prisma.account.findFirst({ where: { organizationId, accountCode: TRADE_PAYABLES_CODE } }),"),
 L(
  "  const itemById = new Map(items.map((i) => [i.id, i]));",
  "",
  "  // CAPITALISED LINES. A line that was capitalised created a fixed asset, and",
  "  // sending it back is a RESCISSION of the purchase, not a sale of the asset:",
  "  // the depreciation charged against it was charged in error and comes back",
  "  // out, and nothing is credited to a gain. Booking a gain equal to the",
  "  // depreciation already taken, on goods that were simply rejected, would put",
  "  // a fiction in the P&L.",
  "  //",
  "  // It also must not go anywhere near the stock ledger. A capitalisable item",
  "  // is a SERVICE item with no stock at all, which is why every return of one",
  "  // used to die inside returnStockToVendor with \"Only 0 in stock at this",
  "  // branch\" - the asset was unreturnable through the system entirely.",
  "  const assets = await prisma.fixedAsset.findMany({",
  "    where: {",
  "      purchaseBillLineId: { in: lineIds },",
  "      organizationId,",
  "      deletedAt: null,",
  "      status: { in: [\"ACTIVE\", \"FULLY_DEPRECIATED\"] },",
  "    },",
  "    select: {",
  "      id: true, assetCode: true, name: true, purchaseBillLineId: true,",
  "      businessPartnerId: true, assetAccountId: true,",
  "      accumDepAccountId: true, depExpenseAccountId: true,",
  "      grossCost: true,",
  "      runs: { select: { amount: true } },",
  "    },",
  "  });",
  "  const assetByLine = new Map(assets.map((a) => [a.purchaseBillLineId!, a]));",
  "",
  "  for (const l of computed) {",
  "    const asset = assetByLine.get(l.purchaseBillLineId);",
  "    if (!asset) continue;",
  "    // One asset is created per capitalised LINE, whatever its quantity, so",
  "    // there is no such thing as returning half of it.",
  "    const original = originalById.get(l.purchaseBillLineId)!;",
  "    if (Number(l.quantity) !== Number(original.quantity)) {",
  "      return res.status(400).json({",
  "        message: `${asset.assetCode} ${asset.name} was capitalised as one asset, so the whole line has to come back - return ${Number(original.quantity)}, or nothing.`,",
  "      });",
  "    }",
  "  }",
  "",
  "  const [tradePayables, cgstInput, sgstInput, igstInput] = await Promise.all([",
  "    prisma.account.findFirst({ where: { organizationId, accountCode: TRADE_PAYABLES_CODE } }),"),
 "message: `${asset.assetCode} ${asset.name} was capitalised as one asset, so the whole line has to come back - return ${Number(original.quantity)}, or nothing.`,"],
["src/routes/purchaseReturns.ts",
 L(
  "    const created = await prisma.$transaction(async (tx) => {",
  "      for (const l of computed) {",
  "        await returnStockToVendor(tx, {",
  "          organizationId, branchId: resolvedBranchId!, itemId: l.itemId,"),
 L(
  "    const created = await prisma.$transaction(async (tx) => {",
  "      for (const l of computed) {",
  "        // See the note above: an asset line has no stock behind it.",
  "        if (assetByLine.has(l.purchaseBillLineId)) continue;",
  "        await returnStockToVendor(tx, {",
  "          organizationId, branchId: resolvedBranchId!, itemId: l.itemId,"),
 "// See the note above: an asset line has no stock behind it."],
["src/routes/purchaseReturns.ts",
 L(
  "        data: [",
  "          { journalEntryId: journalEntry.id, accountId: tradePayables.id, businessPartnerId: bill.businessPartnerId, debit: grandTotal, credit: 0, narration: `Debited to ${bill.businessPartner.name}` },",
  "          ...computed.map((l) => ({",
  "            journalEntryId: journalEntry.id,",
  "            accountId: itemById.get(l.itemId)!.stockAccountId,",
  "            businessPartnerId: itemById.get(l.itemId)!.businessPartnerId,",
  "            debit: 0, credit: l.lineSubtotal,",
  "            narration: `${itemById.get(l.itemId)!.sku} x ${l.quantity}`,",
  "          })),",
  "          ...(cgstTotal > 0 ? [{ journalEntryId: journalEntry.id, accountId: cgstInput!.id, businessPartnerId: null, debit: 0, credit: cgstTotal, narration: \"CGST Input reversed\" }] : []),",
  "          ...(sgstTotal > 0 ? [{ journalEntryId: journalEntry.id, accountId: sgstInput!.id, businessPartnerId: null, debit: 0, credit: sgstTotal, narration: \"SGST Input reversed\" }] : []),"),
 L(
  "        data: [",
  "          { journalEntryId: journalEntry.id, accountId: tradePayables.id, businessPartnerId: bill.businessPartnerId, debit: grandTotal, credit: 0, narration: `Debited to ${bill.businessPartner.name}` },",
  "          ...computed.map((l) => {",
  "            const asset = assetByLine.get(l.purchaseBillLineId);",
  "            // The cost comes out of the asset account it went into, tagged to",
  "            // the asset's own card - not out of the item's stock account,",
  "            // which for a SERVICE item is its EXPENSE head and had nothing to",
  "            // do with this purchase.",
  "            if (asset) {",
  "              return {",
  "                journalEntryId: journalEntry.id,",
  "                accountId: asset.assetAccountId,",
  "                businessPartnerId: asset.businessPartnerId,",
  "                debit: 0, credit: l.lineSubtotal,",
  "                narration: `${asset.assetCode} ${asset.name} returned to vendor`,",
  "              };",
  "            }",
  "            return {",
  "              journalEntryId: journalEntry.id,",
  "              accountId: itemById.get(l.itemId)!.stockAccountId,",
  "              businessPartnerId: itemById.get(l.itemId)!.businessPartnerId,",
  "              debit: 0, credit: l.lineSubtotal,",
  "              narration: `${itemById.get(l.itemId)!.sku} x ${l.quantity}`,",
  "            };",
  "          }),",
  "          // Reversing the depreciation. Dr accumulated depreciation, Cr the",
  "          // expense - a balanced pair, so the entry still ties to Trade",
  "          // Payables without it. It is a CURRENT-period reversal, not a",
  "          // rewrite of the months it was charged in: this module never",
  "          // restates a charge already made, and April may well be closed.",
  "          ...assets.flatMap((a) => {",
  "            const charged = round2(a.runs.reduce((t, r) => t + Number(r.amount), 0));",
  "            if (!(charged > 0)) return [];",
  "            return [",
  "              { journalEntryId: journalEntry.id, accountId: a.accumDepAccountId,",
  "                businessPartnerId: a.businessPartnerId, debit: charged, credit: 0,",
  "                narration: `${a.assetCode} accumulated depreciation reversed on return` },",
  "              { journalEntryId: journalEntry.id, accountId: a.depExpenseAccountId,",
  "                businessPartnerId: null, debit: 0, credit: charged,",
  "                narration: `${a.assetCode} depreciation reversed on return` },",
  "            ];",
  "          }),",
  "          ...(cgstTotal > 0 ? [{ journalEntryId: journalEntry.id, accountId: cgstInput!.id, businessPartnerId: null, debit: 0, credit: cgstTotal, narration: \"CGST Input reversed\" }] : []),",
  "          ...(sgstTotal > 0 ? [{ journalEntryId: journalEntry.id, accountId: sgstInput!.id, businessPartnerId: null, debit: 0, credit: sgstTotal, narration: \"SGST Input reversed\" }] : []),"),
 "narration: `${a.assetCode} accumulated depreciation reversed on return` },"],
["src/routes/purchaseReturns.ts",
 L(
  "      });",
  "",
  "      return createdReturn;",
  "    });"),
 L(
  "      });",
  "",
  "      // RETURNED, not DISPOSED. An auditor reading the disposals schedule",
  "      // should not find a disposal that never happened. See migration_049.",
  "      if (assets.length > 0) {",
  "        await tx.fixedAsset.updateMany({",
  "          where: { id: { in: assets.map((a) => a.id) } },",
  "          data: {",
  "            status: \"RETURNED\",",
  "            // The date it left. disposalProceeds stays NULL on purpose: there",
  "            // were no proceeds, there was no sale.",
  "            disposalDate: new Date(returnDate),",
  "            disposalJournalEntryId: journalEntry.id,",
  "          },",
  "        });",
  "      }",
  "",
  "      return createdReturn;",
  "    });"),
 "// should not find a disposal that never happened. See migration_049."],
];

for (const [f, a, b, m] of EDITS) edit(f, a, b, m);

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["backend/src/routes/purchaseReturns.ts"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, f))).digest("hex");
  console.log(`  ${path.basename(f).padEnd(30)} ${h.toUpperCase()}`);
}
console.log("\nNext: applyFixI.mjs.");