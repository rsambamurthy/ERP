// SmartERP - Charge Master.
//
// Script 8 of 12: the Charge Master screen, part 2 of 2.
//
// Save this as backend/tests/cmH.mjs and run it from backend/:
//   node tests/cmH.mjs
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

edit("../frontend/app/settings/charge-master/page.tsx",
  L(
    "        <p>",
    "          What a Sales Invoice may charge on top of the goods \u2014 delivery, packing, insurance \u2014 and the income"),
  L(
    "        <p>",
    "          What a Sales Invoice may charge on top of the goods \u2014 delivery, packing, insurance \u2014 and the income",
    "          account each one credits. Chosen on the invoice rather than typed, so the same charge reads the same way",
    "          on every document and can actually be totalled. There is no tax rate here on purpose: a charge is spread",
    "          across the goods on the invoice and taxed at their rate, as a composite supply.",
    "        </p>",
    "      </div>",
    "",
    "      <div className=\"ent-toolbar\">",
    "        <div style={{ flex: 1 }} />",
    "        <button className=\"ent-btn-add\" onClick={() => setShowForm((s) => !s)}>{showForm ? \"Cancel\" : \"+ New Charge\"}</button>",
    "      </div>",
    "",
    "      {showForm && (",
    "        <form onSubmit={handleCreate} className=\"ent-section\">",
    "          <div className=\"ent-section-hdr\"><span className=\"ent-section-title\">New Charge Type</span></div>",
    "          <div className=\"ent-form-grid\" style={{ gridTemplateColumns: \"1fr 1.4fr\" }}>",
    "            <div className=\"ent-fg\">",
    "              <label className=\"ent-fl\">Label</label>",
    "              <input",
    "                className=\"ent-fc\" maxLength={60} placeholder=\"e.g. Delivery charges\"",
    "                value={label} onChange={(e) => setLabel(e.target.value)} required",
    "              />",
    "            </div>",
    "            <div className=\"ent-fg\">",
    "              <label className=\"ent-fl\">Credits</label>",
    "              <select className=\"ent-fc\" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>",
    "                <option value=\"\">Select an income account\u2026</option>",
    "                {accounts.map((a) => <option key={a.id} value={a.id}>{a.accountCode} {a.accountName}</option>)}",
    "              </select>",
    "            </div>",
    "          </div>",
    "          <p style={{ fontSize: 11.5, color: \"var(--color-muted)\", padding: \"0 14px 8px\" }}>",
    "            Not Sales Revenue. Recovered freight is only worth separating if it can be read against freight paid,",
    "            and crediting it to Sales Revenue makes that impossible to reconstruct later. If the head you want",
    "            does not exist yet, add it in Chart of Accounts as an INCOME account first.",
    "          </p>",
    "          {error && <p style={{ color: \"#dc2626\", fontSize: 13, padding: \"0 14px 10px\" }}>{error}</p>}",
    "          <div style={{ padding: \"0 14px 14px\" }}>",
    "            <button type=\"submit\" className=\"ent-btn-save\" disabled={saving || !label.trim() || !accountId}>",
    "              {saving ? \"Saving\u2026\" : \"Save Charge\"}",
    "            </button>",
    "          </div>",
    "        </form>",
    "      )}",
    "",
    "      {error && !showForm && <p style={{ color: \"#dc2626\", fontSize: 13, marginBottom: 12 }}>{error}</p>}",
    "      {rowError && <p style={{ color: \"#dc2626\", fontSize: 13, marginBottom: 12 }}>{rowError}</p>}",
    "",
    "      <div className=\"ent-page-table\">",
    "        <table>",
    "          <thead>",
    "            <tr>",
    "              <th style={{ width: \"32%\" }}>Charge</th>",
    "              <th style={{ width: \"44%\" }}>Credits</th>",
    "              <th style={{ width: \"10%\" }}>Status</th>",
    "              <th />",
    "            </tr>",
    "          </thead>",
    "          <tbody>",
    "            {loading && <tr><td colSpan={4} className=\"ent-empty\">Loading\u2026</td></tr>}",
    "            {!loading && types.length === 0 && (",
    "              <tr><td colSpan={4} className=\"ent-empty\">",
    "                No charge types yet \u2014 until one exists, an invoice cannot carry a delivery or packing charge.",
    "              </td></tr>",
    "            )}",
    "            {types.map((t) => (",
    "              <tr key={t.id} style={t.isActive ? undefined : { opacity: 0.55 }}>",
    "                <td style={{ fontWeight: 500 }}>",
    "                  {editingId === t.id ? (",
    "                    <input className=\"ent-fc\" maxLength={60} value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />",
    "                  ) : t.label}",
    "                </td>",
    "                <td>",
    "                  {editingId === t.id ? (",
    "                    <select className=\"ent-fc\" value={editAccountId} onChange={(e) => setEditAccountId(e.target.value)}>",
    "                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.accountCode} {a.accountName}</option>)}",
    "                    </select>",
    "                  ) : `${t.account.accountCode} ${t.account.accountName}`}",
    "                </td>",
    "                <td>{t.isActive ? \"Active\" : \"Retired\"}</td>",
    "                <td style={{ display: \"flex\", gap: 6, justifyContent: \"flex-end\" }}>",
    "                  {editingId === t.id ? (",
    "                    <>",
    "                      <button type=\"button\" className=\"ent-ia ent-ia-edit\" disabled={rowBusy === t.id} onClick={() => handleSaveEdit(t.id)}>",
    "                        {rowBusy === t.id ? \"Saving\u2026\" : \"Save\"}",
    "                      </button>",
    "                      <button type=\"button\" className=\"ent-ia ent-ia-edit\" onClick={() => setEditingId(null)}>Cancel</button>",
    "                    </>",
    "                  ) : (",
    "                    <>",
    "                      <button type=\"button\" className=\"ent-ia ent-ia-edit\" onClick={() => startEdit(t)}>Edit</button>",
    "                      <button",
    "                        type=\"button\" className={t.isActive ? \"ent-ia ent-ia-del\" : \"ent-ia ent-ia-edit\"}",
    "                        disabled={rowBusy === t.id} onClick={() => handleToggle(t)}",
    "                        title={t.isActive",
    "                          ? \"Take it out of the invoice picker. Invoices that already used it are untouched.\"",
    "                          : \"Offer it on invoices again.\"}",
    "                      >",
    "                        {rowBusy === t.id ? \"\u2026\" : t.isActive ? \"Retire\" : \"Reactivate\"}",
    "                      </button>",
    "                    </>",
    "                  )}",
    "                </td>",
    "              </tr>",
    "            ))}",
    "          </tbody>",
    "        </table>",
    "      </div>",
    "",
    "      {/* Retiring rather than deleting is not squeamishness. A charge type",
    "          that has been used is pointed at by invoices; deleting it would",
    "          either fail on the foreign key or take the link with it, leaving a",
    "          report unable to say what a recovery was for. */}",
    "      {!loading && types.length > 0 && (",
    "        <p style={{ fontSize: 11.5, color: \"var(--color-muted)\", marginTop: 10 }}>",
    "          {activeCount} active of {types.length}. A charge type is retired, never deleted \u2014 invoices that already",
    "          carry it keep the label and account they were posted with.",
    "        </p>",
    "      )}",
    "    </>",
    "  );",
    "}",
    "",
    "export default function ChargeMasterPage() {",
    "  return (",
    "    <AppShell>",
    "      <ChargeMasterInner />",
    "    </AppShell>",
    "  );",
    "}"),
  "export default function ChargeMasterPage()");

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["../frontend/app/settings/charge-master/page.tsx"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}a