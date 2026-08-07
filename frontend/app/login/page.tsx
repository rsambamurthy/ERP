"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AuthCard from "@/components/ui/AuthCard";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { ApiError, login } from "@/lib/api";
import { setSession } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const isEmail = identifier.includes("@");
      const res = await login({
        password,
        ...(isEmail ? { email: identifier } : { phone: identifier }),
      });
      setSession(res.token, res.organizationId, res.role, res.isPlatformAdmin, res.name, res.permissions);
      router.push(res.isPlatformAdmin ? "/admin" : "/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-12">
      <AuthCard>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <h2 className="text-lg font-semibold text-navy-800">Log in</h2>
          <Input
            label="Email or phone"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" loading={loading}>
            Log in
          </Button>
        </form>
      </AuthCard>
    </main>
  );
}
