// Turning the assertion language into English.
//
// The pack's assertions are written for a parser - `field data.period.periodStart
// = 2026-04-01`. That is exactly right for the runner and no use at all to
// somebody reading a test pack, so this renders the same meaning as a sentence.
// Nothing is restated or paraphrased from a second source: this IS the
// assertion, spelled out, which is why the two cannot drift apart.

const money = (n) => Number(n).toLocaleString("en-IN",
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------------------------------------------------------------------------
// The assertion language, rendered as something a person reads rather than
// something a parser eats. Same meaning, no DSL.
// ---------------------------------------------------------------------------
export function plain(a) {
  let t = a.trim(), prefix = "";
  if (/^pre\s+/i.test(t)) { t = t.replace(/^pre\s+/i, ""); prefix = "Before the call, "; }
  const m = /^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)\s*::\s*([\s\S]+)$/.exec(t);
  if (m) { prefix += `reading ${m[1]} ${m[2]} \u2014 `; t = m[3].trim(); }

  if (/^manual:/i.test(t)) return "BY HAND: " + t.replace(/^manual:\s*/i, "");
  if (t.startsWith("error contains ")) {
    return prefix + `the request is refused, and the message contains ${t.slice(15).trim()}`;
  }
  if (t.startsWith("journal ")) {
    return prefix + "the ledger entry for this document matches the rows in the previous column, "
      + "and it balances";
  }
  const q = /^sql\s+"([\s\S]*?)"\s*(?:capture\s+(\w+)|(>=|=)\s*(.+))?$/.exec(t);
  if (q) {
    return prefix + (q[2] ? `read from the database and remembered as ${q[2]}:`
      : `from the database, this returns ${q[3] === ">=" ? "at least " : ""}${q[4]}:`) + `\n${q[1]}`;
  }
  const f = /^field\s+(.*?)\s+(>=|=)\s+(.+)$/s.exec(t);
  if (f) {
    const [, expr, op, want] = f;
    const cmp = op === ">=" ? "at least " : "";
    // count(...) / sum(...) / distinct(...) read badly as "X is N". Say what
    // they mean instead - these are the lines a reviewer actually checks.
    const fn = /^(count|sum|distinct)\((.+)\)$/s.exec(expr);
    if (fn) {
      const inner = fn[2];
      if (fn[1] === "count") return prefix + `exactly ${cmp}${want} row(s) match: ${inner}`;
      if (fn[1] === "sum") return prefix + `the total of ${inner} is ${cmp}${want}`;
      return prefix + `there are ${cmp}${want} distinct values of ${inner}`;
    }
    return prefix + `${expr} is ${cmp}${want}`;
  }
  return prefix + t;
}

export function requestText(s) {
  if (!s.method || !s.path) return s.body ? JSON.stringify(s.body, null, 1) : "";
  const head = `${s.method} ${s.path}` + (s.status ? `   expects HTTP ${s.status}` : "");
  return s.body ? `${head}\n${JSON.stringify(s.body, null, 1)}` : head;
}

export function jeText(je) {
  if (!je || je.length === 0) return "";
  return je.map((l) =>
    `${l.code}  ${l.name}\n      ${Number(l.debit) > 0 ? "Dr " + money(l.debit) : "Cr " + money(l.credit)}`)
    .join("\n");
}
