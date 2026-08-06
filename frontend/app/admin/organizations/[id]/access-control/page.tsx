"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import AdminShell from "@/components/layout/AdminShell";
import AccessControlMatrix from "@/components/access-control/AccessControlMatrix";

export default function AdminAccessControlPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <AdminShell>
      <div className="ent-page-hdr">
        <h1>Access Control</h1>
        <p>
          <Link href={`/admin/organizations/${id}`}>&larr; Back to organization</Link>
        </p>
      </div>
      <AccessControlMatrix organizationId={id} />
    </AdminShell>
  );
}
