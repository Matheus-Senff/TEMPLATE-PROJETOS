"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { unwrap, useApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { Card, Status } from "./card";
import { useToast } from "./toast";
import { Button } from "./ui/button";
import { Badge, Skeleton } from "./ui/misc";

const PRICE_ID = process.env.NEXT_PUBLIC_STRIPE_PRICE_ID;
const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" });

const statusLabel: Record<string, { text: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  active: { text: "Ativa", tone: "success" },
  trialing: { text: "Em período de teste", tone: "success" },
  past_due: { text: "Pagamento pendente", tone: "warning" },
  unpaid: { text: "Não paga", tone: "danger" },
  incomplete: { text: "Aguardando pagamento", tone: "warning" },
  incomplete_expired: { text: "Expirada", tone: "neutral" },
  paused: { text: "Pausada", tone: "neutral" },
  canceled: { text: "Cancelada", tone: "neutral" },
};

/**
 * Real plan state (GET /stripe/subscription, from the local table the Stripe webhooks keep in sync) with
 * subscribe / manage actions. Access itself is enforced by the API (`requirePlan()`); this only shows it.
 */
export function BillingCard({ showDetailsLink = true }: { showDetailsLink?: boolean }) {
  const api = useApi();
  const toast = useToast();
  const plan = useQuery({
    queryKey: queryKeys.billing.subscription(),
    queryFn: async () => unwrap(await api.stripe.subscription.$get()),
  });

  const redirect = useMutation({
    mutationFn: async (action: "checkout" | "portal") =>
      action === "checkout"
        ? (await unwrap(await api.stripe.checkout.$post({ json: { priceId: PRICE_ID ?? "", mode: "subscription" } })))
            .url
        : (await unwrap(await api.stripe.portal.$post())).url,
    onSuccess: (url) => window.location.assign(url),
    onError: (error) => toast({ type: "error", title: "Não foi possível abrir o pagamento", body: error.message }),
  });

  const entitlement = plan.data;
  const label = entitlement?.status ? statusLabel[entitlement.status] : undefined;

  return (
    <Card title="Assinatura">
      {plan.isPending ? (
        <Skeleton className="h-12 w-full" />
      ) : plan.isError ? (
        <div className="space-y-2">
          <Status text={`Não foi possível carregar a assinatura: ${plan.error.message}`} tone="error" />
          <Button variant="secondary" size="sm" onClick={() => plan.refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : (
        <div className="space-y-1 text-sm">
          <p className="flex items-center gap-2">
            Plano:{" "}
            {entitlement?.active ? (
              <Badge tone={label?.tone ?? "success"}>{label?.text ?? "Ativa"}</Badge>
            ) : (
              <Badge>{label ? label.text : "Gratuito"}</Badge>
            )}
          </p>
          {entitlement?.currentPeriodEnd && (
            <p className="text-neutral-600 dark:text-neutral-400">
              {entitlement.cancelAtPeriodEnd ? "Acesso até" : "Próxima cobrança em"}{" "}
              {dateFormat.format(new Date(entitlement.currentPeriodEnd))}
            </p>
          )}
          {entitlement?.status === "past_due" && (
            <Status
              text="O último pagamento falhou. Atualize a forma de pagamento para manter o acesso."
              tone="error"
            />
          )}
        </div>
      )}
      {!PRICE_ID && <Status text="Defina NEXT_PUBLIC_STRIPE_PRICE_ID (e STRIPE_SECRET_KEY na API) para ativar." />}
      <div className="flex flex-wrap gap-2">
        {!entitlement?.active && (
          <Button
            size="sm"
            disabled={!PRICE_ID || plan.isPending}
            loading={redirect.isPending && redirect.variables === "checkout"}
            onClick={() => redirect.mutate("checkout")}
          >
            Assinar
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          loading={redirect.isPending && redirect.variables === "portal"}
          onClick={() => redirect.mutate("portal")}
        >
          Gerenciar assinatura
        </Button>
        {showDetailsLink && (
          <Link href="/billing" className="self-center text-sm hover:underline">
            Detalhes
          </Link>
        )}
      </div>
    </Card>
  );
}
