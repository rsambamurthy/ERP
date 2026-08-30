// SmartERP - Charge Master.
//
// Script 5 of 12: backend/src/routes/salesInvoices.ts.
//
// An invoice now sends a chargeTypeId and an amount. The label and the
// income account come from the master and are still snapshotted onto the
// document, so renaming a charge type cannot restate an old invoice.
//
// Save this as backend/tests/cmE.mjs and run it from backend/:
//   node tests/cmE.mjs
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

edit("src/routes/salesInvoices.ts",
  L(
    "const TRADE_RECEIVABLES_CODE = \"1005\";",
    "const SALES_REVENUE_CODE = \"5001\";",
    "const DISCOUNT_ALLOWED_CODE = \"4003\";"),
  L(
    "const TRADE_RECEIVABLES_CODE = \"1005\";",
    "// Exported because routes/chargeTypes.ts refuses a charge type that credits",
    "// it, and that refusal has to be the same account as the one the invoice",
    "// refuses. Two copies of \"5001\" is exactly the drift the Charge Master was",
    "// built to stop, so there is one.",
    "export const SALES_REVENUE_CODE = \"5001\";",
    "const DISCOUNT_ALLOWED_CODE = \"4003\";"),
  "// Exported because routes/chargeTypes.ts refuses a charge type that credits");

edit("src/routes/salesInvoices.ts",
  L(
    "  //",
    "  // The account must be an INCOME head and must not be Sales Revenue itself.",
    "  // Separating them is the entire point - recovered freight set against",
    "  // freight paid tells you whether delivery is costing you money, and",
    "  // crediting 5001 would bury that.",
    "  type ChargeInput = { label?: string; accountId?: string; amount?: number };",
    "  const chargeInputs: ChargeInput[] = Array.isArray(charges) ? charges : [];"),
  L(
    "  //",
    "  // THE LABEL AND THE ACCOUNT COME FROM THE CHARGE MASTER, NOT FROM THE",
    "  // REQUEST. All an invoice sends is a chargeTypeId and an amount. That is",
    "  // what makes \"Delivery charges\" the same three words on every document",
    "  // and 5002 the same head every time - see migration_055 for why the free",
    "  // text this replaced could not be left alone.",
    "  //",
    "  // The row is still written with its OWN copy of label and accountId,",
    "  // snapshotted here, so renaming a charge type next year does not restate",
    "  // an invoice issued today. chargeTypeId is stored alongside so a report",
    "  // can group by type across such a rename.",
    "  type ChargeInput = { chargeTypeId?: string; amount?: number };",
    "  const chargeInputs: ChargeInput[] = Array.isArray(charges) ? charges : [];"),
  "// REQUEST. All an invoice sends is a chargeTypeId and an amount. That is");

edit("src/routes/salesInvoices.ts",
  L(
    "  }",
    "  const chargeAccountIds = [...new Set(chargeInputs.map((c) => String(c.accountId ?? \"\")))];",
    "  const chargeAccounts = chargeAccountIds.length",
    "    ? await prisma.account.findMany({",
    "        where: { id: { in: chargeAccountIds }, organizationId, deletedAt: null, accountType: \"INCOME\", isGroup: false },",
    "      })",
    "    : [];",
    "  const chargeAccountById = new Map(chargeAccounts.map((a) => [a.id, a]));",
    "  for (const c of chargeInputs) {",
    "    const amount = Number(c.amount ?? 0);",
    "    if (!c.label || !String(c.label).trim()) {",
    "      return res.status(400).json({ message: \"Every charge needs a label.\" });",
    "    }",
    "    if (!(amount > 0)) {",
    "      return res.status(400).json({ message: `Charge \"${c.label}\" must be a positive amount.` });",
    "    }",
    "    const account = chargeAccountById.get(String(c.accountId ?? \"\"));",
    "    if (!account) {",
    "      return res.status(400).json({",
    "        message: `Charge \"${c.label}\" must post to one of this organization's income accounts.`,",
    "      });",
    "    }",
    "    if (account.accountCode === SALES_REVENUE_CODE) {",
    "      return res.status(400).json({",
    "        message: `Charge \"${c.label}\" cannot post to Sales Revenue \\u2014 use a separate head such as ` +",
    "          `Freight & Delivery Recovered, so recovered charges can be read against what they cost.`,"),
  L(
    "  }",
    "  const chargeTypeIds = [...new Set(chargeInputs.map((c) => String(c.chargeTypeId ?? \"\")))];",
    "  const chargeTypes = chargeTypeIds.length",
    "    ? await prisma.chargeType.findMany({",
    "        where: { id: { in: chargeTypeIds }, organizationId, isActive: true },",
    "        include: { account: { select: { id: true, accountCode: true, accountType: true, isGroup: true } } },",
    "      })",
    "    : [];",
    "  const chargeTypeById = new Map(chargeTypes.map((t) => [t.id, t]));",
    "  for (const c of chargeInputs) {",
    "    const type = chargeTypeById.get(String(c.chargeTypeId ?? \"\"));",
    "    if (!type) {",
    "      return res.status(400).json({",
    "        message: \"Every charge must name an active charge type from the Charge Master.\",",
    "      });",
    "    }",
    "    if (!(Number(c.amount ?? 0) > 0)) {",
    "      return res.status(400).json({ message: `Charge \"${type.label}\" must be a positive amount.` });",
    "    }",
    "    // The master refuses these at creation, so reaching them here means the",
    "    // account was changed underneath a type that already existed. Checked",
    "    // again rather than trusted, because the cost of being wrong is a",
    "    // recovery buried in Sales Revenue where no report can find it again.",
    "    if (type.account.accountType !== \"INCOME\" || type.account.isGroup) {",
    "      return res.status(400).json({",
    "        message: `Charge \"${type.label}\" points at an account that is no longer a postable income head.`,",
    "      });",
    "    }",
    "    if (type.account.accountCode === SALES_REVENUE_CODE) {",
    "      return res.status(400).json({",
    "        message: `Charge \"${type.label}\" cannot post to Sales Revenue \\u2014 use a separate head such as ` +",
    "          `Freight & Delivery Recovered, so recovered charges can be read against what they cost.`,"),
  "include: { account: { select: { id: true, accountCode: true, accountType: true, isGroup: true } } },");

edit("src/routes/salesInvoices.ts",
  L(
    "  }",
    "  const chargeRows = chargeInputs.map((c, i) => ({",
    "    label: String(c.label).trim().slice(0, 60),",
    "    accountId: String(c.accountId),",
    "    amount: round2(Number(c.amount)),",
    "    sortOrder: i,",
    "  }));",
    "  const chargesTotal = round2(chargeRows.reduce((s, c) => s + c.amount, 0));"),
  L(
    "  }",
    "  const chargeRows = chargeInputs.map((c, i) => {",
    "    const type = chargeTypeById.get(String(c.chargeTypeId))!;",
    "    return {",
    "      chargeTypeId: type.id,",
    "      label: type.label,",
    "      accountId: type.accountId,",
    "      amount: round2(Number(c.amount)),",
    "      sortOrder: i,",
    "    };",
    "  });",
    "  const chargesTotal = round2(chargeRows.reduce((s, c) => s + c.amount, 0));"),
  "const type = chargeTypeById.get(String(c.chargeTypeId))!;");

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["src/routes/salesInvoices.ts"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}