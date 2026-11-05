import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { BillingCard } from "@/components/billing-card";
import { Greeting } from "@/components/greeting";
import { PrivacyCard } from "@/components/privacy-card";
import { RealtimeCard } from "@/components/realtime-card";
import { UploadCard } from "@/components/upload-card";

export const metadata: Metadata = { title: "Painel", robots: { index: false, follow: false } };

/** Private: protected by proxy.ts and checked here too (never rely on the proxy alone). */
export default async function DashboardPage() {
  const { sessionClaims } = await auth.protect();
  const isAdmin = (sessionClaims?.metadata as { role?: string } | undefined)?.role === "admin";

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Greeting />
        {isAdmin && (
          <Link href="/admin" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Administração
          </Link>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <UploadCard />
        <BillingCard />
        <RealtimeCard />
        <PrivacyCard />
      </div>
    </section>
  );
}
