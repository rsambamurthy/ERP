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
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-gray-900">
        Select business domain(s)
      </h2>
      <p className="text-sm text-gray-500">
        Pick one or both — an org can run Trading and Manufacturing together.
      </p>
      <div className="flex flex-col gap-3">
        {OPTIONS.map((opt) => {
          const checked = selected.includes(opt.code);
          return (
            <label
              key={opt.code}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 text-left ${
                checked ? "border-brand-600 bg-brand-50" : "border-gray-300"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(opt.code)}
                className="mt-1"
              />
              <span>
                <span className="block font-medium text-gray-900">{opt.label}</span>
                <span className="block text-sm text-gray-500">{opt.blurb}</span>
              </span>
            </label>
          );
        })}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="button" onClick={onNext} disabled={selected.length === 0}>
        Continue
      </Button>
    </div>
  );
}
