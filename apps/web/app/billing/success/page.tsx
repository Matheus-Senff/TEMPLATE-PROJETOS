import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckoutSuccess } from "@/components/checkout-success";
import { Skeleton } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Pagamento", robots: { index: false, follow: false } };

/** Stripe Checkout `success_url` (`?session_id=cs_...`). The state shown comes from the API, never the URL. */
export default async function BillingSuccessPage() {
  await auth.protect();
  return (
    <section className="max-w-xl space-y-4">
      <Suspense fallback={<Skeleton className="h-24 w-full" />}>
        <CheckoutSuccess />
      </Suspense>
    </section>
  );
}
