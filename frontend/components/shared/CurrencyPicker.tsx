"use client";

import SearchPicker from "@/components/shared/SearchPicker";
import type { CurrencyDef } from "@/lib/types";

// Currency picker. Unlike the other wrappers the value here is the ISO code,
// not a database id — SUPPORTED_CURRENCIES is a static list and every
// currency column in the schema stores the code.
//
// Typing matches code, name or symbol, so "SGD", "Singapore" and "$" all
// narrow sensibly.

interface Props {
  currencies: CurrencyDef[];
  value: string | null;
  onChange: (code: string | null) => void;
  disabled?: boolean;
  required?: boolean;
  emptyLabel?: string;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function CurrencyPicker({
  currencies,
  placeholder = "Search currency…",
  ...rest
}: Props) {
  return (
    <SearchPicker<CurrencyDef>
      options={currencies}
      placeholder={placeholder}
      noMatchLabel="No matching currency."
      getId={(c) => c.code}
      getSearchText={(c) => `${c.code} ${c.name} ${c.symbol}`}
      getLabel={(c) => `${c.code} — ${c.name}`}
      renderRow={(c) => (
        <>
          <span
            style={{
              color: "var(--color-muted)",
              fontVariantNumeric: "tabular-nums",
              minWidth: 42,
            }}
          >
            {c.code}
          </span>
          <span style={{ minWidth: 18 }}>{c.symbol}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
        </>
      )}
      {...rest}
    />
  );
}