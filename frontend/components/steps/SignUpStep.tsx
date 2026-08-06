"use client";

import { useState } from "react";
import Input from "../ui/Input";
import Button from "../ui/Button";
import type { RegisterPayload } from "@/lib/types";

interface Props {
  loading: boolean;
  error: string | null;
  onSubmit: (payload: RegisterPayload) => void;
}

export default function SignUpStep({ loading, error, onSubmit }: Props) {
  const [form, setForm] = useState<RegisterPayload>({
    businessName: "",
    email: "",
    phone: "",
    password: "",
  });

  function update<K extends keyof RegisterPayload>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
    >
      <h2 className="text-lg font-semibold text-gray-900">Sign up</h2>
      <p className="text-sm text-gray-500">
        Email, phone, business name — the basics to get your account started.
      </p>
      <Input
        label="Business name"
        required
        value={form.businessName}
        onChange={(e) => update("businessName", e.target.value)}
      />
      <Input
        label="Email"
        type="email"
        required
        value={form.email}
        onChange={(e) => update("email", e.target.value)}
      />
      <Input
        label="Phone"
        type="tel"
        required
        value={form.phone}
        onChange={(e) => update("phone", e.target.value)}
      />
      <Input
        label="Password"
        type="password"
        required
        minLength={8}
        value={form.password}
        onChange={(e) => update("password", e.target.value)}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" loading={loading}>
        Continue
      </Button>
    </form>
  );
}
