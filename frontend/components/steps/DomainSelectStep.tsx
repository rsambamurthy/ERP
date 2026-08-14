"use client";

import Button from "../ui/Button";
import type { DomainCode } from "@/lib/types";

const OPTIONS: { code: DomainCode; label: string; blurb: string }[] = [
  {
    code: "TRADING",
    label: "Trading",
    blurb: "Buy, sell, and track inventory — retail, wholesale, distribution.",
  },
  {
    code: "MANUFACTURING",
    label: "Manufacturing",
    blurb: "Production with a bill of materials — raw materials to finished goods.",
  },
];

interface Props {
  selected: DomainCode[];
  onToggle: (code: DomainCode) => void;
  onNext: () => void;
  error: string | null;
}

export default function DomainSelectStep({ selected, onToggle, onNext, error }: Props) {
  return (
    <div className="flex flex-col gap-3">
      {OPTIONS.map((opt) => {
        const checked = selected.includes(opt.code);
        return (
          <label key={opt.code} className={`auth-check ${checked ? "selected" : ""}`}>
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(opt.code)}
              className="mt-1"
            />
            <span>
              <span className="auth-check-title">{opt.label}</span>
              <span className="auth-check-sub">{opt.blurb}</span>
            </span>
          </label>
        );
      })}
      {error && <p className="auth-err">{error}</p>}
      <Button type="button" onClick={onNext} disabled={selected.length === 0}>
        Continue
      </Button>
    </div>
  );
}
