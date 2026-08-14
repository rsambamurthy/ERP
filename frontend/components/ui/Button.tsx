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
  const styles = variant === "primary" ? "auth-btn" : "auth-btn auth-btn-secondary";

  return (
    <button {...rest} disabled={disabled || loading} className={`${styles} ${className}`.trim()}>
      {loading ? "Working…" : children}
    </button>
  );
}
