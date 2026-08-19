"use client";

import { useEffect, useMemo, useState } from "react";

// Generic searchable dropdown. A native <select> stops being usable somewhere
// in the low hundreds of options — no type-ahead beyond first-letter
// matching, and every option laid out at once — which is why partner and
// account pickers both needed replacing.
//
// Everything domain-specific (what a row looks like, what text is searched,
// what the closed field reads) is passed in, so the two wrappers around this
// stay a few lines each and there is exactly one copy of the keyboard,
// focus and filtering behaviour to get right.

// Cap on rows put in the DOM at once. Filtering 10k strings per keystroke is
// cheap; laying out 10k rows is not. Anything past this is reachable by
// typing more, and the footer says so rather than pretending the list is
// complete.
const MAX_VISIBLE = 100;

export interface SearchPickerProps<T> {
  options: T[];
  value: string | null;
  onChange: (id: string | null) => void;
  getId: (o: T) => string;
  /** Everything the filter should match against, in one string. */
  getSearchText: (o: T) => string;
  /** Text shown in the closed field once something is selected. */
  getLabel: (o: T) => string;
  renderRow: (o: T) => React.ReactNode;
  disabled?: boolean;
  required?: boolean;
  /** Label for the "nothing selected" row. Omit to make the field selection-only. */
  emptyLabel?: string;
  placeholder?: string;
  noMatchLabel?: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function SearchPicker<T>({
  options,
  value,
  onChange,
  getId,
  getSearchText,
  getLabel,
  renderRow,
  disabled = false,
  required = false,
  emptyLabel,
  placeholder = "Type to search…",
  noMatchLabel = "No matches.",
  className = "ent-fc",
  style,
}: SearchPickerProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const selected = useMemo(
    () => options.find((o) => getId(o) === value) ?? null,
    [options, value, getId]
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => getSearchText(o).toLowerCase().includes(q));
  }, [options, query, getSearchText]);

  const visible = matches.slice(0, MAX_VISIBLE);

  useEffect(() => {
    setActive(0);
  }, [query]);

  function choose(o: T | null) {
    onChange(o ? getId(o) : null);
    setQuery("");
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, visible.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (open && visible[active]) {
        // Only swallow Enter when it actually picks something, so it still
        // submits the surrounding form when the list isn't open.
        e.preventDefault();
        choose(visible[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  const rowBase: React.CSSProperties = {
    padding: "6px 10px",
    fontSize: 13,
    cursor: "pointer",
    display: "flex",
    gap: 8,
    alignItems: "baseline",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  return (
    <div style={{ position: "relative", ...style }}>
      <input
        className={className}
        disabled={disabled}
        // `required` rides on the visible input rather than a hidden mirror:
        // a zero-size required input is not focusable, and the browser
        // silently refuses to submit a form it cannot focus the offender in.
        // When something is selected this input shows a non-empty label, so
        // native validation passes; when nothing is selected it is empty and
        // the browser points at the field the user can actually see.
        required={required && !disabled}
        value={open ? query : selected ? getLabel(selected) : ""}
        placeholder={disabled ? "—" : placeholder}
        autoComplete="off"
        onFocus={() => {
          if (!disabled) {
            setOpen(true);
            setQuery("");
          }
        }}
        // Discards a half-typed query that never became a selection, so the
        // input can never sit there looking like it holds a value it doesn't.
        onBlur={() => {
          setOpen(false);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
      />

      {open && !disabled && (
        <div
          style={{
            position: "absolute",
            zIndex: 50,
            top: "100%",
            left: 0,
            right: 0,
            minWidth: 280,
            marginTop: 2,
            background: "#fff",
            border: "1px solid var(--color-border, #e2e8f0)",
            borderRadius: 6,
            boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)",
            maxHeight: 300,
            overflowY: "auto",
          }}
        >
          {emptyLabel && (
            <div
              // mousedown, not click: blur fires first on click and would
              // close the list before the handler ever runs. preventDefault
              // keeps focus on the input so blur never fires at all.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(null);
              }}
              style={{ ...rowBase, color: "var(--color-muted)", fontStyle: "italic" }}
            >
              {emptyLabel}
            </div>
          )}

          {visible.length === 0 && (
            <div style={{ ...rowBase, cursor: "default", color: "var(--color-muted)" }}>
              {noMatchLabel}
            </div>
          )}

          {visible.map((o, i) => {
            const id = getId(o);
            return (
              <div
                key={id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
                onMouseEnter={() => setActive(i)}
                style={{
                  ...rowBase,
                  background: i === active ? "#eff6ff" : "#fff",
                  fontWeight: id === value ? 600 : 400,
                }}
              >
                {renderRow(o)}
              </div>
            );
          })}

          {matches.length > MAX_VISIBLE && (
            <div
              style={{
                padding: "6px 10px",
                fontSize: 12,
                color: "var(--color-muted)",
                borderTop: "1px solid var(--color-border, #e2e8f0)",
                background: "#f8fafc",
              }}
            >
              Showing {MAX_VISIBLE} of {matches.length} matches — keep typing to narrow.
            </div>
          )}
        </div>
      )}
    </div>
  );
}