// negC - the two locks, and the switch that opens the first one.
// Run negA and negB first.
//
// salesInvoices.ts reads the organisation's setting and the request's own
// allowNegativeStock flag. BOTH have to be true. An organisation with the
// setting on still refuses every ordinary invoice that runs short, because
// the setting grants the POSSIBILITY and never the behaviour - otherwise
// turning it on would silently change what every existing document does,
// which is the opposite of a deliberate decision.
//
// A reason is mandatory, and is stored only where the override was actually
// USED. An invoice that asked for it and had enough stock anyway records
// nothing - otherwise a cautious operator who ticks the box every time
// fills the exception report with documents that never sold short.
//
// companyMaster.ts exposes the setting beside the costing method and the
// approval thresholds. It follows this endpoint's omit-clears convention,
// and that convention earns its keep here: forgetting to send the field
// turns the override OFF, which is the safe direction to fail in.
//
// After this: `npx tsc --noEmit`.
//
// Save this as backend/tests/negC.mjs and run it from backend/:
//   node tests/negC.mjs
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
function editAll(file, from, to, expect, done) {
  const t = read(file);
  if (t.includes(done)) { already++; save(file, t); return; }
  const n = t.split(from).length - 1;
  if (n !== expect) throw new Error(file + ": expected " + expect + " copies, found " + n);
  save(file, t.split(from).join(to));
  applied++;
}

edit("src/routes/salesInvoices.ts",
  L(
    "  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { costingMethod: true } });",
    "  if (!org?.costingMethod) return res.status(422).json({ message: \"Set the organization's stock costing method first.\" });",
    ""),
  L(
    "  const org = await prisma.organization.findUnique({",
    "    where: { id: organizationId },",
    "    select: { costingMethod: true, allowNegativeStock: true },",
    "  });",
    "  if (!org?.costingMethod) return res.status(422).json({ message: \"Set the organization's stock costing method first.\" });",
    "",
    "  // THE NEGATIVE-STOCK OVERRIDE. Two locks, and both have to be open.",
    "  //",
    "  // The organisation has to permit it at all (migration_053, off by",
    "  // default), and THIS invoice has to ask for it. An organisation with the",
    "  // setting on still refuses every ordinary invoice that runs short,",
    "  // because the setting grants the possibility rather than the behaviour -",
    "  // otherwise turning it on would silently change what every existing",
    "  // document does, which is the opposite of a deliberate decision.",
    "  //",
    "  // The reason is mandatory and is stored on the invoice. \"Why did this go",
    "  // negative\" is the question somebody asks three months later, and a",
    "  // boolean cannot answer it. Refusing without one here rather than",
    "  // defaulting to \"override\" keeps the answer worth reading.",
    "  const wantsOverride = req.body?.allowNegativeStock === true;",
    "  const negativeStockReason = String(req.body?.negativeStockReason ?? \"\").trim();",
    "  if (wantsOverride && !org.allowNegativeStock) {",
    "    return res.status(403).json({",
    "      message: \"This organization does not allow invoicing stock it does not hold. \" +",
    "        \"An administrator can enable it under Company Master.\",",
    "    });",
    "  }",
    "  if (wantsOverride && !negativeStockReason) {",
    "    return res.status(400).json({ message: \"negativeStockReason is required when overriding the stock check.\" });",
    "  }",
    "  if (negativeStockReason.length > 200) {",
    "    return res.status(400).json({ message: \"negativeStockReason must be 200 characters or fewer.\" });",
    "  }",
    "  const allowNegative = wantsOverride && org.allowNegativeStock;",
    ""),
  "const allowNegative = wantsOverride && org.allowNegativeStock;"
);

edit("src/routes/salesInvoices.ts",
  "      const computed = [];",
  L(
    "      const computed = [];",
    "      let anyLineWentNegative = false;"),
  "let anyLineWentNegative = false;"
);

edit("src/routes/salesInvoices.ts",
  "          ({ unitCost, totalCost } = await consumeStock(tx, {",
  L(
    "          let wentNegative = false;",
    "          ({ unitCost, totalCost, wentNegative } = await consumeStock(tx, {"),
  "({ unitCost, totalCost, wentNegative } = await consumeStock(tx, {"
);

edit("src/routes/salesInvoices.ts",
  "          }));",
  L(
    "            allowNegative,",
    "          }));",
    "          if (wentNegative) anyLineWentNegative = true;"),
  "if (wentNegative) anyLineWentNegative = true;"
);

edit("src/routes/salesInvoices.ts",
  "          invoiceNumber, invoiceDate: new Date(invoiceDate), narration: narration ?? \"\",",
  L(
    "          invoiceNumber, invoiceDate: new Date(invoiceDate), narration: narration ?? \"\",",
    "          // Only where the override was actually used. An invoice that asked",
    "          // for it and had enough stock anyway records nothing, because",
    "          // nothing was overridden - the column is a list of the invoices",
    "          // that really did sell what was not there.",
    "          negativeStockReason: anyLineWentNegative ? negativeStockReason : null,"),
  "negativeStockReason: anyLineWentNegative ? negativeStockReason : null,"
);

// The same select appears twice - the GET and the PATCH response - and
// both must carry the new field or the screen shows a setting it cannot
// read back. Counted rather than anchored one at a time: if a third
// copy ever appears, this fails instead of silently updating two.
editAll("src/routes/companyMaster.ts",
  "      priceVarianceTolerancePct: true, soApprovalThreshold: true,",
  "      priceVarianceTolerancePct: true, soApprovalThreshold: true, allowNegativeStock: true,",
  2, "soApprovalThreshold: true, allowNegativeStock: true,");

edit("src/routes/companyMaster.ts",
  "    poApprovalThreshold, priceVarianceTolerancePct, soApprovalThreshold,",
  L(
    "    poApprovalThreshold, priceVarianceTolerancePct, soApprovalThreshold,",
    "    allowNegativeStock,"),
  "    allowNegativeStock,\n  } = req.body"
);

edit("src/routes/companyMaster.ts",
  "      soApprovalThreshold: soApprovalThreshold != null ? Number(soApprovalThreshold) : null,",
  L(
    "      soApprovalThreshold: soApprovalThreshold != null ? Number(soApprovalThreshold) : null,",
    "      // May a Sales Invoice sell stock the branch does not hold? See",
    "      // migration_053. Follows this endpoint's omit-clears convention, and",
    "      // that convention is doing real work here: forgetting to send the",
    "      // field turns the override OFF, which is the safe direction to fail",
    "      // in. Only an explicit true enables it.",
    "      //",
    "      // Enabling it grants the POSSIBILITY, never the behaviour - every",
    "      // invoice still has to ask for the override by name and give a",
    "      // reason, so turning this on changes nothing about what any existing",
    "      // document does.",
    "      allowNegativeStock: allowNegativeStock === true,"),
  "allowNegativeStock: allowNegativeStock === true,"
);

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["src/routes/salesInvoices.ts","src/routes/companyMaster.ts"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}