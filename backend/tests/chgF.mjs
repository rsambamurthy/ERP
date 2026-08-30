// SmartERP - freight, packing and insurance on a sales invoice.
//
// Script 6 of 7: the Sales Invoice screen.
//
// SCREEN TOUCHED: Sales > Invoices > New Invoice. Adds an 'Add charge'
// button under the lines, a label / account / amount row per charge, and
// 'Charges: +X' in the totals strip. There is deliberately NO rate box:
// a charge follows the goods' rate, so a rate box would only be a way to
// get every invoice carrying freight wrong.
//
// Save this as backend/tests/chgF.mjs and run it from backend/:
//   node tests/chgF.mjs
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
  "  ApiError, createSalesInvoice, downloadSalesInvoicePdf, getBranches, getBusinessPartnerLookup, getCompanyMaster, getDeliveryNotes, getItems, getSalesInvoice,",
  "  ApiError, createSalesInvoice, downloadSalesInvoicePdf, getBranches, getAccounts, getBusinessPartnerLookup, getCompanyMaster, getDeliveryNotes, getItems, getSalesInvoice,",
  "ApiError, createSalesInvoice, downloadSalesInvoicePdf, getBranches, getAccounts, getBusinessPartnerLookup, getCompanyMaster, getDeliveryNotes, getItems, getSalesInvoice,");

edit("../frontend/app/sales/invoices/page.tsx",
  "  const [lines, setLines] = useState<SalesLineInput[]>([emptyLine()]);",
  L(
    "  const [lines, setLines] = useState<SalesLineInput[]>([emptyLine()]);",
    "  // FREIGHT, PACKING, INSURANCE. Document-level charges, each posting to its",
    "  // own income head. They are NOT lines: a charge has no tax rate of its own,",
    "  // because it is prorated across the goods lines and taxed at their rate -",
    "  // section 15(2)(c) puts it inside the value of the supply and section 8(a)",
    "  // taxes a composite supply at the rate of the principal one. Giving the",
    "  // user a rate box for freight would be offering them a way to get that",
    "  // wrong on every invoice.",
    "  const [charges, setCharges] = useState<{ label: string; accountId: string; amount: string }[]>([]);",
    "  const [incomeAccounts, setIncomeAccounts] = useState<{ id: string; accountCode: string; accountName: string }[]>([]);",
    "  const chargesTotal = useMemo(",
    "    () => round2(charges.reduce((s, c) => s + (Number(c.amount) || 0), 0)),",
    "    [charges]",
    "  );",
    ""),
  "const [incomeAccounts, setIncomeAccounts] = useState<{ id: string; accountCode: string; accountName: string }[]>([]);");

edit("../frontend/app/sales/invoices/page.tsx",
  "        interState",
  L(
    "        interState,",
    "        chargesTotal"),
  "        interState,\u000a        chargesTotal");

edit("../frontend/app/sales/invoices/page.tsx",
  "    [lines, invoiceDiscountType, invoiceDiscountValue, interState]",
  "    [lines, invoiceDiscountType, invoiceDiscountValue, interState, chargesTotal]",
  "[lines, invoiceDiscountType, invoiceDiscountValue, interState, chargesTotal]");

edit("../frontend/app/sales/invoices/page.tsx",
  L(
    "",
    "  async function handleCreate(e: React.FormEvent, override = false) {"),
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
    "  }, []);",
    "",
    "  async function handleCreate(e: React.FormEvent, override = false) {"),
  "res.data.filter((a) => a.accountType === \"INCOME\" && !a.isGroup && a.accountCode !== \"5001\")");

edit("../frontend/app/sales/invoices/page.tsx",
  "        lines: lines.filter((l) => l.itemId && l.quantity > 0),",
  L(
    "        lines: lines.filter((l) => l.itemId && l.quantity > 0),",
    "        charges: charges",
    "          .filter((c) => c.label.trim() && c.accountId && Number(c.amount) > 0)",
    "          .map((c) => ({ label: c.label.trim(), accountId: c.accountId, amount: Number(c.amount) })),"),
  ".map((c) => ({ label: c.label.trim(), accountId: c.accountId, amount: Number(c.amount) })),");

edit("../frontend/app/sales/invoices/page.tsx",
  "      setInvoiceDiscountType(\"\"); setInvoiceDiscountValue(\"\");",
  "      setInvoiceDiscountType(\"\"); setInvoiceDiscountValue(\"\"); setCharges([]);",
  "setInvoiceDiscountType(\"\"); setInvoiceDiscountValue(\"\"); setCharges([]);");

edit("../frontend/app/sales/invoices/page.tsx",
  L(
    "",
    "            <div style={{ display: \"flex\", gap: 8, alignItems: \"flex-end\", marginBottom: 12 }}>"),
  L(
    "",
    "            {/* CHARGES. Deliberately not lines, and deliberately without a tax",
    "                rate box. A charge is prorated across the goods above and taxed",
    "                at their rate - section 15(2)(c) puts incidental expenses inside",
    "                the value of the supply, and section 8(a) taxes a composite",
    "                supply at the rate of the principal one. Offering a rate here",
    "                would be offering a way to get that wrong on every invoice. */}",
    "            {charges.length > 0 && (",
    "              <table className=\"ent-table\" style={{ marginBottom: 8 }}>",
    "                <thead>",
    "                  <tr>",
    "                    <th style={{ width: \"34%\" }}>Charge</th>",
    "                    <th style={{ width: \"44%\" }}>Posts to</th>",
    "                    <th style={{ width: \"18%\" }}>Amount</th>",
    "                    <th style={{ width: \"4%\" }}></th>",
    "                  </tr>",
    "                </thead>",
    "                <tbody>",
    "                  {charges.map((c, i) => (",
    "                    <tr key={i}>",
    "                      <td>",
    "                        <input",
    "                          className=\"ent-fc\" maxLength={60} placeholder=\"e.g. Delivery charges\"",
    "                          value={c.label}",
    "                          onChange={(e) => setCharges((cs) => cs.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))}",
    "                        />",
    "                      </td>",
    "                      <td>",
    "                        <select",
    "                          className=\"ent-fc\" value={c.accountId}",
    "                          onChange={(e) => setCharges((cs) => cs.map((x, idx) => idx === i ? { ...x, accountId: e.target.value } : x))}",
    "                        >",
    "                          <option value=\"\">Select an income account\u2026</option>",
    "                          {incomeAccounts.map((a) => (",
    "                            <option key={a.id} value={a.id}>{a.accountCode} {a.accountName}</option>",
    "                          ))}",
    "                        </select>",
    "                      </td>",
    "                      <td>",
    "                        <input",
    "                          type=\"number\" min={0} step=\"0.01\" className=\"ent-fc\" placeholder=\"0.00\"",
    "                          value={c.amount}",
    "                          onChange={(e) => setCharges((cs) => cs.map((x, idx) => idx === i ? { ...x, amount: e.target.value } : x))}",
    "                        />",
    "                      </td>",
    "                      <td>",
    "                        <button type=\"button\" className=\"ent-ia ent-ia-del\" onClick={() => setCharges((cs) => cs.filter((_, idx) => idx !== i))}>\u2715</button>",
    "                      </td>",
    "                    </tr>",
    "                  ))}",
    "                </tbody>",
    "              </table>",
    "            )}",
    "            <div style={{ display: \"flex\", alignItems: \"center\", gap: 10, margin: \"0 0 12px\" }}>",
    "              <button",
    "                type=\"button\" className=\"ent-add-row\" style={{ margin: 0 }}",
    "                onClick={() => setCharges((cs) => [...cs, { label: \"\", accountId: \"\", amount: \"\" }])}",
    "              >",
    "                + Add charge (freight, packing, insurance)",
    "              </button>",
    "              {charges.length > 0 && (",
    "                <span style={{ fontSize: 11.5, color: \"var(--color-muted)\" }}>",
    "                  Charges are spread across the lines above by value and taxed at the goods&rsquo; rate,",
    "                  as a composite supply. They have no rate of their own.",
    "                </span>",
    "              )}",
    "            </div>",
    "",
    "            <div style={{ display: \"flex\", gap: 8, alignItems: \"flex-end\", marginBottom: 12 }}>"),
  "<button type=\"button\" className=\"ent-ia ent-ia-del\" onClick={() => setCharges((cs) => cs.filter((_, idx) => idx !== i))}>\u2715</button>");

edit("../frontend/app/sales/invoices/page.tsx",
  "              <span>Discount: <strong>-{totals.discountTotal.toFixed(2)}</strong></span>",
  L(
    "              <span>Discount: <strong>-{totals.discountTotal.toFixed(2)}</strong></span>",
    "              {chargesTotal > 0 && <span>Charges: <strong>+{chargesTotal.toFixed(2)}</strong></span>}"),
  "{chargesTotal > 0 && <span>Charges: <strong>+{chargesTotal.toFixed(2)}</strong></span>}");

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["../frontend/app/sales/invoices/page.tsx"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}