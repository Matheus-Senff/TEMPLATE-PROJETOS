"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { unwrap, useApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { Button, buttonVariants } from "./ui/button";
import { EmptyState, Skeleton } from "./ui/misc";

const MAX_POLLS = 10;

/**
 * Asks the API to sync the Checkout session (same idempotent code as the Stripe webhook) and polls a few
 * times while the payment is still being confirmed. Boleto/Pix can take days: then it says "processando"
 * and the user is notified (bell + e-mail) when the webhook confirms it.
 */
export function CheckoutSuccess() {
  const api = useApi();
  const queryClient = useQueryClient();
  const sessionId = useSearchParams().get("session_id");

  const sync = useQuery({
    queryKey: ["billing", "checkout", sessionId],
    enabled: Boolean(sessionId?.startsWith("cs_")),
    queryFn: async () => unwrap(await api.stripe.checkout.sync.$post({ json: { sessionId: sessionId ?? "" } })),
    retry: 1,
    refetchInterval: (query) =>
      query.state.data?.status === "open" && query.state.dataUpdateCount < MAX_POLLS ? 2000 : false,
  });

  const status = sync.data?.status;
  useEffect(() => {
    if (status === "paid") void queryClient.invalidateQueries({ queryKey: queryKeys.billing.all });
  }, [status, queryClient]);

  if (!sessionId?.startsWith("cs_")) {
    return <EmptyState title="Pagamento não encontrado" description="Abra a assinatura pelo painel." />;
  }
  if (sync.isPending) return <Skeleton className="h-24 w-full" />;
  if (sync.isError) {
    return (
      <EmptyState
        title="Não foi possível confirmar o pagamento agora"
        description={`${sync.error.message} Se o valor foi cobrado, a confirmação chega em instantes.`}
        action={
          <Button variant="secondary" size="sm" onClick={() => sync.refetch()}>
            Tentar de novo
          </Button>
        }
      />
    );
  }

  const content = {
    paid: {
      title: "Pagamento confirmado",
      text: "Tudo certo! Seu plano já está ativo.",
    },
    processing: {
      title: "Pagamento em processamento",
      text: "Boleto e Pix podem levar até 3 dias úteis para compensar. Avisaremos por aqui e por e-mail quando confirmar.",
    },
    open: {
      title: "Processando...",
      text: "Estamos confirmando o pagamento com o Stripe. Esta página atualiza sozinha.",
    },
    expired: {
      title: "Sessão de pagamento expirada",
      text: "Nenhuma cobrança foi feita. Inicie a assinatura de novo.",
    },
  }[status ?? "open"];

  return (
    <div className="space-y-4" aria-live="polite">
      <h1 className="text-2xl font-bold">{content.title}</h1>
      <p className="text-neutral-600 dark:text-neutral-400">{content.text}</p>
      <div className="flex gap-2">
        <Link href="/dashboard" className={buttonVariants({ size: "sm" })}>
          Ir para o painel
        </Link>
        <Link href="/billing" className={buttonVariants({ variant: "secondary", size: "sm" })}>
          Ver assinatura
        </Link>
      </div>
    </div>
  );
}
