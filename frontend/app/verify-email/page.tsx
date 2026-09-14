"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AuthCard from "@/components/ui/AuthCard";
import Button from "@/components/ui/Button";
import { ApiError, verifyEmail } from "@/lib/api";
import { setSession } from "@/lib/auth";

type Status = "verifying" | "success" | "error";

function VerifyEmailContent() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [status, setStatus] = useState<Status>(token ? "verifying" : "error");
  const [error, setError] = useState<string | null>(
    token ? null : "This verification link is missing its token."
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await verifyEmail(token);
        if (cancelled) return;
        setSession(res.token, res.organizationId, res.role, res.isPlatformAdmin, res.name, res.permissions, res.customRoleId, res.deniedModules);
        setStatus("success");
        router.push("/dashboard");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Something went wrong verifying your email.");
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <AuthCard>
      <div className="flex flex-col items-center gap-3 text-center">
        {status === "verifying" && (
          <>
            <div
              className="h-8 w-8 animate-spin rounded-full"
              style={{ border: "2px solid var(--theme-accent)", borderTopColor: "transparent" }}
            />
            <p>Verifying your email…</p>
          </>
        )}
        {status === "success" && <p>Email verified — taking you to your workspace…</p>}
        {status === "error" && (
          <>
            <p className="auth-err">{error}</p>
            <Button type="button" onClick={() => router.push("/register")}>
              Back to sign up
            </Button>
          </>
        )}
      </div>
    </AuthCard>
  );
}

export default function VerifyEmailPage() {
  return (
    <main className="auth-page">
      <Suspense fallback={null}>
        <VerifyEmailContent />
      </Suspense>
    </main>
  );
}
