import { ButtonHTMLAttributes } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
  loading?: boolean;
}

export default function Button({
  variant = "primary",
  loading,
  className = "",
  children,
  disabled,
  ...rest
}: Props) {
  const base =
    "rounded-xl px-5 py-3 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed";
  const styles =
    variant === "primary"
      ? "bg-terracotta-500 text-white hover:bg-terracotta-600"
      : "bg-white text-navy-800 border border-cream-200 hover:bg-cream-50";

  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`${base} ${styles} ${className}`}
    >
      {loading ? "Working…" : children}
    </button>
  );
}
