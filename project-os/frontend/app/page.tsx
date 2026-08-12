"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isLoggedIn } from "../lib/auth";

// Root route just redirects — no marketing landing page in R1 (this is a
// pilot tool, not a public product yet).
export default function RootPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(isLoggedIn() ? "/dashboard" : "/login");
  }, [router]);
  return null;
}
