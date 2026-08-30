// SmartERP - freight, packing and insurance on a sales invoice.
//
// Script 5 of 7: backend/src/routes/salesInvoices.ts.
//
// A charge account must be an INCOME head of THIS organisation and must
// not be Sales Revenue. Each charge credits its own head at its FULL
// amount - the proration is a GST device deciding which line carries the
// tax, not a way of splitting the revenue.
//
// Save this as backend/tests/chgE.mjs and run it from backend/:
//   node tests/chgE.mjs
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
  "      businessPartner: true, lines: { include: { item: true } }, journalEntry: { include: { journalLines: true } },",
  L(
    "      businessPartner: true, lines: { include: { item: true } }, journalEntry: { include: { journalLines: true } },",
    "      charges: { include: { account: { select: { accountCode: true, accountName: true } } }, orderBy: { sortOrder: \"asc\" } },"),
  "charges: { include: { account: { select: { accountCode: true, accountName: true } } }, orderBy: { sortOrder: \"asc\" } },");

edit("src/routes/salesInvoices.ts",
  "      lines: { include: { item: { select: { sku: true, name: true, hsnCode: true, uom: true } } } },",
  L(
    "      lines: { include: { item: { select: { sku: true, name: true, hsnCode: true, uom: true } } } },",
    "      charges: { orderBy: { sortOrder: \"asc\" } },"),
  "charges: { orderBy: { sortOrder: \"asc\" } },");

edit("src/routes/salesInvoices.ts",
  L(
    "    })),",
    "  });"),
  L(
    "    })),",
    "    // Shown as their own lines under the goods, with a note that the tax",
    "    // is already in the figures above. A customer reading the invoice has",
    "    // to be able to see what the freight was; a customer reading a tax",
    "    // column beside it would reasonably expect that tax to be additional,",
    "    // and it is not - it is inside the goods lines, which is where the Act",
    "    // puts it.",
    "    charges: invoice.charges.map((c) => ({ label: c.label, amount: Number(c.amount) })),",
    "  });"),
  "charges: invoice.charges.map((c) => ({ label: c.label, amount: Number(c.amount) })),");

edit("src/routes/salesInvoices.ts",
  "    businessPartnerId, invoiceDate, branchId, narration, lines, discountType, discountValue,",
  "    businessPartnerId, invoiceDate, branchId, narration, lines, discountType, discountValue, charges,",
  "businessPartnerId, invoiceDate, branchId, narration, lines, discountType, discountValue, charges,");

edit("src/routes/salesInvoices.ts",
  "  const interState = isForeign ? true : isInterState(branch?.stateCode, customer.stateCode);",
  L(
    "  const interState = isForeign ? true : isInterState(branch?.stateCode, customer.stateCode);",
    "",
    "  // FREIGHT, PACKING, INSURANCE. Document-level amounts, each with its own",
    "  // income head, PRORATED across the lines below so that GST on them follows",
    "  // the goods.",
    "  //",
    "  // Section 15(2)(c) puts incidental expenses inside the value of the supply",
    "  // and section 8(a) taxes a composite supply at the rate of the principal",
    "  // one, so freight on an invoice for 18% goods is taxed at 18% under the",
    "  // goods' HSN - not at 5% under SAC 9965. Prorating makes that true by",
    "  // construction: a charge never has a rate of its own to get wrong.",
    "  //",
    "  // The account must be an INCOME head and must not be Sales Revenue itself.",
    "  // Separating them is the entire point - recovered freight set against",
    "  // freight paid tells you whether delivery is costing you money, and",
    "  // crediting 5001 would bury that.",
    "  type ChargeInput = { label?: string; accountId?: string; amount?: number };",
    "  const chargeInputs: ChargeInput[] = Array.isArray(charges) ? charges : [];",
    "  if (chargeInputs.length > 20) {",
    "    return res.status(400).json({ message: \"An invoice can carry at most 20 charges.\" });",
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
    "          `Freight & Delivery Recovered, so recovered charges can be read against what they cost.`,",
    "      });",
    "    }",
    "  }",
    "  const chargeRows = chargeInputs.map((c, i) => ({",
    "    label: String(c.label).trim().slice(0, 60),",
    "    accountId: String(c.accountId),",
    "    amount: round2(Number(c.amount)),",
    "    sortOrder: i,",
    "  }));",
    "  const chargesTotal = round2(chargeRows.reduce((s, c) => s + c.amount, 0));",
    ""),
  "where: { id: { in: chargeAccountIds }, organizationId, deletedAt: null, accountType: \"INCOME\", isGroup: false },");

edit("src/routes/salesInvoices.ts",
  L(
    "    interState",
    "  );"),
  L(
    "    interState,",
    "    chargesTotal",
    "  );"),
  "    interState,\u000a    chargesTotal\u000a  );");

edit("src/routes/salesInvoices.ts",
  "          { journalEntryId: journalEntry.id, accountId: salesRevenue.id, businessPartnerId: null, debit: 0, credit: subtotal, narration: `Sales revenue \u2014 ${invoiceNumber}` },",
  L(
    "          { journalEntryId: journalEntry.id, accountId: salesRevenue.id, businessPartnerId: null, debit: 0, credit: subtotal, narration: `Sales revenue \u2014 ${invoiceNumber}` },",
    "          // Each charge to its OWN head, at its full amount - not prorated.",
    "          // The proration is a GST device: it decides which line carries the",
    "          // tax. The revenue itself belongs where somebody put it, whole, or",
    "          // the P&L cannot answer \"what did we recover on freight\".",
    "          ...chargeRows.map((c) => ({",
    "            journalEntryId: journalEntry.id, accountId: c.accountId, businessPartnerId: null,",
    "            debit: 0, credit: c.amount, narration: `${c.label} \u2014 ${invoiceNumber}`,",
    "          })),"),
  "journalEntryId: journalEntry.id, accountId: c.accountId, businessPartnerId: null,");

edit("src/routes/salesInvoices.ts",
  "          salesOrderId: linkedSo?.id ?? null,",
  L(
    "          salesOrderId: linkedSo?.id ?? null,",
    "          // The charges themselves. Their TAX is not stored here: it is",
    "          // already in the lines, because that is where the proration put",
    "          // it. Storing it twice would be two figures free to disagree.",
    "          charges: chargeRows.length ? { create: chargeRows } : undefined,"),
  "// already in the lines, because that is where the proration put");

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["src/routes/salesInvoices.ts"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}