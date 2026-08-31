// SmartERP - Charge Master.
//
// Script 7 of 12: the Charge Master screen, part 1 of 2.
//
// SCREEN: Configuration > Charge Master. Will not compile until cmH.
//
// Save this as backend/tests/cmG.mjs and run it from backend/:
//   node tests/cmG.mjs
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
function create(file, text, done) {
  if (fs.existsSync(at(file)) && read(file).includes(done)) { already++; return; }
  fs.mkdirSync(path.dirname(at(file)), { recursive: true });
  save(file, text);
  applied++;
}

create("../frontend/app/settings/charge-master/page.tsx", L(
    "\"use client\";",
    "",
    "import { useEffect, useMemo, useState } from \"react\";",
    "import AppShell from \"@/components/layout/AppShell\";",
    "import {",
    "  ApiError, createChargeType, getAccounts, getChargeTypes, toggleChargeType, updateChargeType,",
    "} from \"@/lib/api\";",
    "import type { ChargeType } from \"@/lib/api\";",
    "",
    "// Charge Master. The labels a Sales Invoice may put on freight, packing and",
    "// insurance, each bound to the income account it credits.",
    "//",
    "// The screen exists because the alternative failed: charges shipped with a",
    "// free-text label, and a free-text label drifts. \"Delivery charges\",",
    "// \"Delivery Charges\", \"Delivery\", \"Frieght\" \u2014 one thing, four rows, and no",
    "// report able to add them up. The account was always the stable key. Here",
    "// the label is bound to it once and chosen thereafter.",
    "//",
    "// There is no rate column and there will not be one: a charge is prorated",
    "// across the goods on the invoice and taxed at THEIR rate, because section",
    "// 8(a) taxes a composite supply at the rate of the principal supply. A rate",
    "// box here would be a way to get that wrong on every invoice.",
    "",
    "function ChargeMasterInner() {",
    "  const [types, setTypes] = useState<ChargeType[]>([]);",
    "  const [accounts, setAccounts] = useState<{ id: string; accountCode: string; accountName: string }[]>([]);",
    "  const [loading, setLoading] = useState(true);",
    "  const [error, setError] = useState<string | null>(null);",
    "  const [showForm, setShowForm] = useState(false);",
    "  const [saving, setSaving] = useState(false);",
    "",
    "  const [label, setLabel] = useState(\"\");",
    "  const [accountId, setAccountId] = useState(\"\");",
    "",
    "  const [editingId, setEditingId] = useState<string | null>(null);",
    "  const [editLabel, setEditLabel] = useState(\"\");",
    "  const [editAccountId, setEditAccountId] = useState(\"\");",
    "  const [rowBusy, setRowBusy] = useState<string | null>(null);",
    "  const [rowError, setRowError] = useState<string | null>(null);",
    "",
    "  async function loadAll() {",
    "    setLoading(true);",
    "    try {",
    "      // Inactive ones included: this is the only screen that can bring a",
    "      // retired charge type back, so it is the only one that must see them.",
    "      const res = await getChargeTypes(true);",
    "      setTypes(res.data);",
    "    } catch (err) {",
    "      setError(err instanceof ApiError ? err.message : \"Could not load charge types.\");",
    "    } finally {",
    "      setLoading(false);",
    "    }",
    "  }",
    "",
    "  useEffect(() => { loadAll(); }, []);",
    "",
    "  // Every INCOME account except Sales Revenue, which the server refuses.",
    "  // Excluding it here as well means nobody is ever offered a choice that",
    "  // will come back as an error.",
    "  useEffect(() => {",
    "    getAccounts()",
    "      .then((res) => setAccounts(",
    "        res.data.filter((a) => a.accountType === \"INCOME\" && !a.isGroup && a.accountCode !== \"5001\")",
    "      ))",
    "      .catch(() => setAccounts([]));",
    "  }, []);",
    "",
    "  const activeCount = useMemo(() => types.filter((t) => t.isActive).length, [types]);",
    "",
    "  async function handleCreate(e: React.FormEvent) {",
    "    e.preventDefault();",
    "    setSaving(true);",
    "    setError(null);",
    "    try {",
    "      await createChargeType({ label: label.trim(), accountId, sortOrder: (types.length + 1) * 10 });",
    "      setShowForm(false);",
    "      setLabel(\"\"); setAccountId(\"\");",
    "      await loadAll();",
    "    } catch (err) {",
    "      setError(err instanceof ApiError ? err.message : \"Could not save the charge type.\");",
    "    } finally {",
    "      setSaving(false);",
    "    }",
    "  }",
    "",
    "  function startEdit(t: ChargeType) {",
    "    setEditingId(t.id);",
    "    setEditLabel(t.label);",
    "    setEditAccountId(t.accountId);",
    "    setRowError(null);",
    "  }",
    "",
    "  async function handleSaveEdit(id: string) {",
    "    setRowBusy(id);",
    "    setRowError(null);",
    "    try {",
    "      await updateChargeType(id, { label: editLabel.trim(), accountId: editAccountId });",
    "      setEditingId(null);",
    "      await loadAll();",
    "    } catch (err) {",
    "      setRowError(err instanceof ApiError ? err.message : \"Could not save the change.\");",
    "    } finally {",
    "      setRowBusy(null);",
    "    }",
    "  }",
    "",
    "  async function handleToggle(t: ChargeType) {",
    "    setRowBusy(t.id);",
    "    setRowError(null);",
    "    try {",
    "      await toggleChargeType(t.id);",
    "      await loadAll();",
    "    } catch (err) {",
    "      setRowError(err instanceof ApiError ? err.message : \"Could not change that.\");",
    "    } finally {",
    "      setRowBusy(null);",
    "    }",
    "  }",
    "",
    "  return (",
    "    <>",
    "      <div className=\"ent-page-hdr\">",
    "        <h1>Charge Master</h1>",
    "        <p>",
    "          What a Sales Invoice may charge on top of the goods \u2014 delivery, packing, insurance \u2014 and the income"
),
  "function ChargeMasterInner()");

console.log(`${applied} change(s) applied, ${already} already there`);
for (const f of ["../frontend/app/settings/charge-master/page.tsx"]) {
  const h = crypto.createHash("sha256").update(fs.readFileSync(at(f))).digest("hex");
  console.log("  " + f.padEnd(46) + h.slice(0, 16).toUpperCase());
}