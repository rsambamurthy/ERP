// SmartERP - Charge Master.
//
// Script 9 of 12: the Sales Invoice screen, part 1 - state and wiring.
//
// SCREEN TOUCHED: Sales > Invoices > New Invoice.
//
// Save this as backend/tests/cmI.mjs and run it from backend/:
//   node tests/cmI.mjs
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

edit("../frontend/app/sales/invoices/page.tsx",
  L(
    "import {",
    "  ApiError, createSalesInvoice, downloadSalesInvoicePdf, getBranches, getAccounts, getBusinessPartnerLookup, getCompanyMaster, getDeliveryNotes, getItems, getSalesInvoice,",
    "  getSalesInvoices, getSalesOrder, getSalesOrders, lookupCurrencyRate, updateSalesInvoiceReference,",
    "} from \"@/lib/api\";",
    "import { computeDiscountedLines, isInterState, round2 } from \"@/lib/discountGst\";"),
  L(
    "import {",
    "  ApiError, createSalesInvoice, downloadSalesInvoicePdf, getBranches, getChargeTypes, getBusinessPartnerLookup, getCompanyMaster, getDeliveryNotes, getItems, getSalesInvoice,",
    "  getSalesInvoices, getSalesOrder, getSalesOrders, lookupCurrencyRate, updateSalesInvoiceReference,",
    "} from \"@/lib/api\";",
    "import type { ChargeType } from \"@/lib/api\";",
    "import { computeDiscountedLines, isInterState, round2 } from \"@/lib/discountGst\";"),
  "ApiError, createSalesInvoice, downloadSalesInvoicePdf, getBranches, getChargeTypes, getBusinessPartnerLookup, getCompanyMaster, getDeliveryNotes, getItems, getSalesInvoice,");

edit("../frontend/app/sales/invoices/page.tsx",
  L(
    "  // wrong on every invoice.",
    "  const [charges, setCharges] = useState<{ label: string; accountId: string; amount: string }[]>([]);",
    "  const [incomeAccounts, setIncomeAccounts] = useState<{ id: string; accountCode: string; accountName: string }[]>([]);",
    "  const chargesTotal = useMemo("),
  L(
    "  // wrong on every invoice.",
    "  // The label and the account are NOT typed here - they come from the",
    "  // Charge Master, and all this form carries is which type and how much.",
    "  // See migration_055 for what free text did to reporting.",
    "  const [charges, setCharges] = useState<{ chargeTypeId: string; amount: string }[]>([]);",
    "  const [chargeTypes, setChargeTypes] = useState<ChargeType[]>([]);",
    "  const chargesTotal = useMemo("),
  "const [charges, setCharges] = useState<{ chargeTypeId: string; amount: string }[]>([]);");

edit("../frontend/app/sales/invoices/page.tsx",
  L(
    "",
    "  // Heads a charge may post to: every INCOME account except Sales Revenue",
    "  // itself, which the server refuses anyway. Excluding it here as well",
    "  // means the user is never offered a choice that will be rejected.",
    "  useEffect(() => {",
    "    getAccounts()",
    "      .then((res) => setIncomeAccounts(",
    "        res.data.filter((a) => a.accountType === \"INCOME\" && !a.isGroup && a.accountCode !== \"5001\")",
    "      ))",
    "      .catch(() => setIncomeAccounts([]));",
    "  }, []);"),
  L(
    "",
    "  // Active charge types only - a retired one must not be offered on a new",
    "  // invoice, though every invoice that already used it keeps it.",
    "  useEffect(() => {",
    "    getChargeTypes()",
    "      .then((res) => setChargeTypes(res.data))",
    "      .catch(() => setChargeTypes([]));",
    "  }, []);"),
  "// Active charge types only - a retired one must not be offered on a new");

edit("../frontend/app/sales/invoices/page.tsx",
  L(
    "        charges: charges",
    "          .filter((c) => c.label.trim() && c.accountId && Number(c.amount) > 0)",
    "          .map((c) => ({ label: c.label.trim(), accountId: c.accountId, amount: Number(c.amount) })),",
    "        discountType: invoiceDiscountType || null,"),
  L(
    "        charges: charges",
    "          .filter((c) => c.chargeTypeId && Number(c.amount) > 0)",
    "          .map((c) => ({ chargeTypeId: c.chargeTypeId, amount: Number(c.amount) })),",
    "        discountType: invoiceDiscountType || null,"),
  ".map((c) => ({ chargeTypeId: c.chargeTypeId, amount: Number(c.amount) })),");

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["../frontend/app/sales/invoices/page.tsx"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}