import { Suspense } from "react";
import AppShell from "@/components/layout/AppShell";
import DashboardContent from "./DashboardContent";

export default function DashboardPage() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <DashboardContent />
      </Suspense>
    </AppShell>
  );
}
