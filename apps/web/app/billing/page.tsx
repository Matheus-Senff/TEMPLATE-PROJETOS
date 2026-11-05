import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import Link from "next/link";
import { BillingCard } from "@/components/billing-card";

export const metadata: Metadata = { title: "Assinatura", robots: { index: false, follow: false } };

/** Private: plan state + Stripe Customer Portal (also the portal's return URL, STRIPE portalReturnUrl). */
export default async function BillingPage() {
  await auth.protect();
  return (
    <section className="max-w-xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Assinatura</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Plano, próxima cobrança, forma de pagamento e notas fiscais.
        </p>
      </div>
      <BillingCard showDetailsLink={false} />
      <Link href="/dashboard" className="text-sm hover:underline">
        Voltar ao painel
      </Link>
    </section>
  );
}
