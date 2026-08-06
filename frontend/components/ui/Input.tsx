import { InputHTMLAttributes } from "react";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export default function Input({ label, id, ...rest }: Props) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="flex flex-col gap-1 text-left">
      <label
        htmlFor={inputId}
        className="text-xs font-semibold uppercase tracking-wide text-terracotta-700"
      >
        {label}
      </label>
      <input
        id={inputId}
        {...rest}
        className="rounded-lg border border-cream-300 bg-cream-50 px-3.5 py-2.5 text-sm outline-none focus:border-terracotta-400 focus:ring-1 focus:ring-terracotta-400"
      />
    </div>
  );
}
