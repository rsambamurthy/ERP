"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BusinessPartnerLookup } from "@/lib/types";

// Searchable replacement for the plain <select> customer/vendor dropdowns.
//
// A native select stops being usable somewhere in the low hundreds of
// options: it has no type-ahead beyond first-letter matching, so finding one
// customer among ~10k means scrolling. This renders the same choice as a
// filter box over a virtual-ish list instead.
//
// Each row reads "Code · Phone · Name". Missing code or phone shows an em
// dash rather than collapsing, so the three columns stay aligned — most
// bulk-uploaded customers have a code but no phone, and ragged rows are
// much harder to scan than rows with a visible gap.
//
// Typing filters across all three fields at once, so "C57", "98765" and
// "BALA" each narrow toward the same record from a different direction.

// Cap on rows put in the DOM at once. Filtering 10k strings per keystroke is
// cheap; laying out 10k absolutely-positioned rows is not. Anything past this
// is reachable by typing more, and the count below the list says so rather
// than pretending the list is complete.
const MAX_VISIBLE = 100;

function displayLabel(p: BusinessPartnerLookup): string {
  return `${p.code || "—"} · ${p.phone || "—"} · ${p.name}`;
}

interface Props {
  partners: BusinessPartnerLookup[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  required?: boolean;
  /** Label for the "no partner" row. Omit to make the field selection-only. */
  emptyLabel?: string;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function PartnerPicker({
  partners,
  value,
  onChange,
  disabled = false,
  required = false,
  emptyLabel,
  placeholder = "Search code, phone or name…",
  className = "ent-fc",
  style,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => partners.find((p) => p.id === value) ?? null,
    [partners, value]
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return partners;
    return partners.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.code ?? "").toLowerCase().includes(q) ||
        (p.phone ?? "").toLowerCase().includes(q)
    );
  }, [partners, query]);

  const visible = matches.slice(0, MAX_VISIBLE);

  useEffect(() => {
    setActive(0);
  }, [query]);

  function choose(p: BusinessPartnerLookup | null) {
    onChange(p ? p.id : null);
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
        ref={inputRef}
        className={className}
        disabled={disabled}
        // `required` rides on the visible input rather than a hidden mirror:
        // a zero-size required input is not focusable, and the browser
        // silently refuses to submit a form it cannot focus the offender in.
        // When a partner is selected this input shows a non-empty label, so
        // native validation passes; when nothing is selected it is empty and
        // the browser points at the field the user can actually see.
        required={required && !disabled}
        value={open ? query : selected ? displayLabel(selected) : ""}
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
              No matching partner.
            </div>
          )}

          {visible.map((p, i) => (
            <div
              key={p.id}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(p);
              }}
              onMouseEnter={() => setActive(i)}
              style={{
                ...rowBase,
                background: i === active ? "#eff6ff" : "#fff",
                fontWeight: p.id === value ? 600 : 400,
              }}
            >
              <span
                style={{
                  color: "var(--color-muted)",
                  fontVariantNumeric: "tabular-nums",
                  minWidth: 62,
                }}
              >
                {p.code || "—"}
              </span>
              <span
                style={{
                  color: "var(--color-muted)",
                  fontVariantNumeric: "tabular-nums",
                  minWidth: 92,
                }}
              >
                {p.phone || "—"}
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
            </div>
          ))}

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