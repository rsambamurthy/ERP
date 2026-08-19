"use client";

import SearchPicker from "@/components/shared/SearchPicker";
import type { BranchSummary } from "@/lib/types";

// Branch picker. Rows read "Code — Name", with the head office flagged so an
// admin assigning someone to a branch can see which one it is without
// cross-referencing the Branches screen.

interface Props {
  branches: BranchSummary[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  required?: boolean;
  emptyLabel?: string;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function BranchPicker({
  branches,
  placeholder = "Search branch…",
  ...rest
}: Props) {
  return (
    <SearchPicker<BranchSummary>
      options={branches}
      placeholder={placeholder}
      noMatchLabel="No matching branch."
      getId={(b) => b.id}
      getSearchText={(b) => `${b.code} ${b.name}`}
      getLabel={(b) => b.name}
      renderRow={(b) => (
        <>
          <span
            style={{
              color: "var(--color-muted)",
              fontVariantNumeric: "tabular-nums",
              minWidth: 48,
            }}
          >
            {b.code}
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{b.name}</span>
          {b.isHeadOffice && <span className="badge badge-purple">HO</span>}
        </>
      )}
      {...rest}
    />
  );
}