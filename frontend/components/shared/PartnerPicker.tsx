"use client";

import SearchPicker from "@/components/shared/SearchPicker";
import type { BusinessPartnerLookup } from "@/lib/types";

// Customer/vendor picker. Rows read "Code · Phone · Name"; a missing code or
// phone shows an em dash rather than collapsing, so the three columns stay
// aligned — most bulk-uploaded customers have a code but no phone, and
// ragged rows are much harder to scan than rows with a visible gap.
//
// Typing filters across all three fields at once, so "C57", "98765" and
// "BALA" each narrow toward the same record from a different direction.

const muted: React.CSSProperties = {
  color: "var(--color-muted)",
  fontVariantNumeric: "tabular-nums",
};

interface Props {
  partners: BusinessPartnerLookup[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  required?: boolean;
  emptyLabel?: string;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function PartnerPicker({
  partners,
  placeholder = "Search code, phone or name…",
  ...rest
}: Props) {
  return (
    <SearchPicker<BusinessPartnerLookup>
      options={partners}
      placeholder={placeholder}
      noMatchLabel="No matching partner."
      getId={(p) => p.id}
      getSearchText={(p) => `${p.code ?? ""} ${p.phone ?? ""} ${p.name}`}
      getLabel={(p) => `${p.code || "—"} · ${p.phone || "—"} · ${p.name}`}
      renderRow={(p) => (
        <>
          <span style={{ ...muted, minWidth: 62 }}>{p.code || "—"}</span>
          <span style={{ ...muted, minWidth: 92 }}>{p.phone || "—"}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
        </>
      )}
      {...rest}
    />
  );
}