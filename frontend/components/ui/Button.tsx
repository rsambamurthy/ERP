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
    "rounded-lg px-5 py-2.5 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed";
  const styles =
    variant === "primary"
      ? "bg-brand-600 text-white hover:bg-brand-800"
      : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50";

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
