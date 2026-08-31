// SmartERP - Charge Master.
//
// Script 10 of 12: the Sales Invoice screen, part 2 - the charge picker.
//
// SCREEN TOUCHED: Sales > Invoices > New Invoice. The charge row becomes
// one dropdown of charge types, the account shown beside it read-only,
// and an amount. No label box and no account box any more - and when the
// master is empty there is no Add button either, just a line saying where
// to go, because a button that can only open an empty dropdown is worse
// than no button.
//
// Save this as backend/tests/cmJ.mjs and run it from backend/:
//   node tests/cmJ.mjs
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
    "                  <tr>",
    "                    <th style={{ width: \"34%\" }}>Charge</th>",
    "                    <th style={{ width: \"44%\" }}>Posts to</th>",
    "                    <th style={{ width: \"18%\" }}>Amount</th>"),
  L(
    "                  <tr>",
    "                    <th style={{ width: \"40%\" }}>Charge</th>",
    "                    <th style={{ width: \"38%\" }}>Credits</th>",
    "                    <th style={{ width: \"18%\" }}>Amount</th>"),
  "<th style={{ width: \"38%\" }}>Credits</th>");

edit("../frontend/app/sales/invoices/page.tsx",
  L(
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
    "                          ))}"),
  L(
    "                <tbody>",
    "                  {charges.map((c, i) => {",
    "                    // The account is shown, not chosen. It belongs to the",
    "                    // charge type, and letting it be overridden here would",
    "                    // reopen the drift the master was built to close.",
    "                    const type = chargeTypes.find((t) => t.id === c.chargeTypeId);",
    "                    return (",
    "                    <tr key={i}>",
    "                      <td>",
    "                        <select",
    "                          className=\"ent-fc\" value={c.chargeTypeId}",
    "                          onChange={(e) => setCharges((cs) => cs.map((x, idx) => idx === i ? { ...x, chargeTypeId: e.target.value } : x))}",
    "                        >",
    "                          <option value=\"\">Select a charge\u2026</option>",
    "                          {chargeTypes.map((t) => (",
    "                            <option key={t.id} value={t.id}>{t.label}</option>",
    "                          ))}"),
  "onChange={(e) => setCharges((cs) => cs.map((x, idx) => idx === i ? { ...x, chargeTypeId: e.target.value } : x))}");

edit("../frontend/app/sales/invoices/page.tsx",
  L(
    "                      </td>",
    "                      <td>",
    "                        <input"),
  L(
    "                      </td>",
    "                      <td style={{ fontSize: 12, color: \"var(--color-muted)\" }}>",
    "                        {type ? `${type.account.accountCode} ${type.account.accountName}` : \"\u2014\"}",
    "                      </td>",
    "                      <td>",
    "                        <input"),
  "{type ? `${type.account.accountCode} ${type.account.accountName}` : \"\u2014\"}");

edit("../frontend/app/sales/invoices/page.tsx",
  L(
    "                    </tr>",
    "                  ))}",
    "                </tbody>"),
  L(
    "                    </tr>",
    "                    );",
    "                  })}",
    "                </tbody>"),
  "                    </tr>\u000a                    );\u000a                  })}\u000a                </tbody>");

edit("../frontend/app/sales/invoices/page.tsx",
  L(
    "            <div style={{ display: \"flex\", alignItems: \"center\", gap: 10, margin: \"0 0 12px\" }}>",
    "              <button",
    "                type=\"button\" className=\"ent-add-row\" style={{ margin: 0 }}",
    "                onClick={() => setCharges((cs) => [...cs, { label: \"\", accountId: \"\", amount: \"\" }])}",
    "              >",
    "                + Add charge (freight, packing, insurance)",
    "              </button>",
    "              {charges.length > 0 && ("),
  L(
    "            <div style={{ display: \"flex\", alignItems: \"center\", gap: 10, margin: \"0 0 12px\" }}>",
    "              {/* No button at all when the master is empty, and a sentence",
    "                  saying where to go instead. An \"Add charge\" that can only",
    "                  produce an empty dropdown is worse than no button. */}",
    "              {chargeTypes.length > 0 ? (",
    "                <button",
    "                  type=\"button\" className=\"ent-add-row\" style={{ margin: 0 }}",
    "                  onClick={() => setCharges((cs) => [...cs, { chargeTypeId: \"\", amount: \"\" }])}",
    "                >",
    "                  + Add charge (freight, packing, insurance)",
    "                </button>",
    "              ) : (",
    "                <span style={{ fontSize: 11.5, color: \"var(--color-muted)\" }}>",
    "                  To charge delivery, packing or insurance on an invoice, set the charges up once under",
    "                  Configuration &rsaquo; Charge Master.",
    "                </span>",
    "              )}",
    "              {charges.length > 0 && ("),
  "To charge delivery, packing or insurance on an invoice, set the charges up once under");

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["../frontend/app/sales/invoices/page.tsx"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}