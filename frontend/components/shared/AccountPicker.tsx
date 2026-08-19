"use client";

import SearchPicker from "@/components/shared/SearchPicker";
import type { Account } from "@/lib/types";

// Chart-of-accounts picker. Rows read "Code — Name", the same shape the
// plain <select>s used, so the text people already recognise doesn't change
// — only the ability to search it does. Typing matches either half, so both
// "4008" and "Administrative" find the same account.
//
// Callers pass an already-filtered list (active-only, non-group, excluding
// the contra money account, and so on). Filtering stays at the call site
// because each screen's rule is different and pushing them in here would
// mean a prop per rule.

interface Props {
  accounts: Account[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  required?: boolean;
  emptyLabel?: string;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function AccountPicker({
  accounts,
  placeholder = "Search account code or name…",
  ...rest
}: Props) {
  return (
    <SearchPicker<Account>
      options={accounts}
      placeholder={placeholder}
      noMatchLabel="No matching account."
      getId={(a) => a.id}
      getSearchText={(a) => `${a.accountCode} ${a.accountName}`}
      getLabel={(a) => `${a.accountCode} — ${a.accountName}`}
      renderRow={(a) => (
        <>
          <span
            style={{
              color: "var(--color-muted)",
              fontVariantNumeric: "tabular-nums",
              minWidth: 54,
            }}
          >
            {a.accountCode}
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{a.accountName}</span>
        </>
      )}
      {...rest}
    />
  );
}