import { InputHTMLAttributes } from "react";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export default function Input({ label, id, className = "", ...rest }: Props) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="auth-fg">
      <label htmlFor={inputId} className="auth-fl">
        {label}
      </label>
      <input id={inputId} {...rest} className={`auth-fc ${className}`.trim()} />
    </div>
  );
}
