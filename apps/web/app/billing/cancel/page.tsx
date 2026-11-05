import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Pagamento cancelado", robots: { index: false, follow: false } };

/** Stripe Checkout `cancel_url`: nothing was charged. */
export default async function BillingCancelPage() {
  await auth.protect();
  return (
    <section className="max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">Pagamento cancelado</h1>
      <p className="text-neutral-600 dark:text-neutral-400">
        Nenhuma cobrança foi feita. Você pode assinar quando quiser.
      </p>
      <div className="flex gap-2">
        <Link href="/billing" className={buttonVariants({ size: "sm" })}>
          Ver planos
        </Link>
        <Link href="/dashboard" className={buttonVariants({ variant: "secondary", size: "sm" })}>
          Voltar ao painel
        </Link>
      </div>
    </section>
  );
}
