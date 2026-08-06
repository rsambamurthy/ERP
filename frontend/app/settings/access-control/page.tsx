"use client";

import AppShell from "@/components/layout/AppShell";
import AccessControlMatrix from "@/components/access-control/AccessControlMatrix";
import { getOrganizationId } from "@/lib/auth";

export default function AccessControlPage() {
  const organizationId = getOrganizationId();

  return (
    <AppShell>
      <div className="ent-page-hdr">
        <h1>Access Control</h1>
        <p>Which sidebar items each role sees. The backend enforces the real permission on every action regardless — this only controls what shows up.</p>
      </div>
      {organizationId ? (
        <AccessControlMatrix organizationId={organizationId} />
      ) : (
        <p className="ent-empty">Could not determine your organization.</p>
      )}
    </AppShell>
  );
}
