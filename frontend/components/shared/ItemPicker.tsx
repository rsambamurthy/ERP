"use client";

import SearchPicker from "@/components/shared/SearchPicker";
import type { Item } from "@/lib/types";

// Item picker. Rows read "SKU — Name", the same text the plain <select>s
// showed. Typing matches either half, so a part number and a description
// both find the same item.
//
// Callers pass an already-filtered list — most document lines want
// active-only, the Stock Ledger wants everything including retired items so
// their history stays reachable. That rule belongs at the call site.

interface Props {
  items: Item[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  required?: boolean;
  emptyLabel?: string;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function ItemPicker({
  items,
  placeholder = "Search SKU or name…",
  ...rest
}: Props) {
  return (
    <SearchPicker<Item>
      options={items}
      placeholder={placeholder}
      noMatchLabel="No matching item."
      getId={(i) => i.id}
      getSearchText={(i) => `${i.sku} ${i.name}`}
      getLabel={(i) => `${i.sku} — ${i.name}`}
      renderRow={(i) => (
        <>
          <span
            style={{
              color: "var(--color-muted)",
              fontVariantNumeric: "tabular-nums",
              minWidth: 72,
            }}
          >
            {i.sku}
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{i.name}</span>
        </>
      )}
      {...rest}
    />
  );
}