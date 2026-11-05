import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminUsers } from "@/components/admin-users";

export const metadata: Metadata = { title: "Administração", robots: { index: false, follow: false } };

/**
 * Platform admin: Clerk publicMetadata.role = "admin". The session token must expose it
 * (Clerk > Sessions > Customize session token: `{ "metadata": "{{user.public_metadata}}" }`).
 * The API checks the role again on every call (requireRole).
 */
export default async function AdminPage() {
  const { sessionClaims } = await auth.protect();
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role;
  if (role !== "admin") redirect("/dashboard");

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-bold">Usuários</h1>
      <AdminUsers />
    </section>
  );
}
