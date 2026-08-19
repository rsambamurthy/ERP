"use client";

import SearchPicker from "@/components/shared/SearchPicker";

// Picker over a plain {value,label} list, for choices that aren't a database
// entity — the Team page's role dropdown, which mixes the three fixed roles
// with however many custom roles an org has defined.

export interface PickerOption {
  value: string;
  label: string;
}

interface Props {
  options: PickerOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  required?: boolean;
  emptyLabel?: string;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function OptionPicker({ options, placeholder = "Search…", ...rest }: Props) {
  return (
    <SearchPicker<PickerOption>
      options={options}
      placeholder={placeholder}
      noMatchLabel="No matches."
      getId={(o) => o.value}
      getSearchText={(o) => o.label}
      getLabel={(o) => o.label}
      renderRow={(o) => <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{o.label}</span>}
      {...rest}
    />
  );
}