"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AuthCard from "@/components/ui/AuthCard";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { ApiError, acceptInvite } from "@/lib/api";
import { setSession } from "@/lib/auth";

function AcceptInviteForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await acceptInvite(token, name, password);
      setSession(res.token, res.organizationId, res.role, false, res.name, res.permissions);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <AuthCard>
        <p className="text-sm text-red-600">This invite link is missing its token.</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <h2 className="text-lg font-semibold text-navy-800">Set your password</h2>
        <p className="text-sm text-gray-500">You&apos;ve been invited to join a SmartERP workspace.</p>
        <Input label="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <Input label="Confirm password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" loading={loading}>Join workspace</Button>
      </form>
    </AuthCard>
  );
}

export default function AcceptInvitePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-12">
      <Suspense fallback={null}>
        <AcceptInviteForm />
      </Suspense>
    </main>
  );
}
