"use client";

import { useClerk, useReverification } from "@clerk/nextjs";
import { isReverificationCancelledError } from "@clerk/nextjs/errors";
import { useState } from "react";
import { unwrap, unwrapReverifiable, useApi } from "@/lib/api";
import { buttonClass, Card, Status } from "./card";
import { useToast } from "./toast";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

/**
 * LGPD: the user downloads everything stored about them or deletes the account and all data.
 * Deleting requires a recent re-authentication (API `requireReverification()`): Clerk's modal asks for the
 * password/2FA and the request is retried automatically.
 */
export function PrivacyCard() {
  const api = useApi();
  const { signOut } = useClerk();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: "muted" | "error" | "ok" } | null>(null);
  const deleteAccountRequest = useReverification(async () => unwrapReverifiable(await api.me.$delete()));

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setStatus(null);
    try {
      await action();
    } catch (error) {
      if (isReverificationCancelledError(error)) {
        toast({ type: "info", title: "Exclusão cancelada", body: "Confirme sua identidade para excluir a conta." });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setStatus({ text: message, tone: "error" });
      toast({ type: "error", title: "Não foi possível concluir", body: message });
    } finally {
      setBusy(false);
    }
  }

  const exportData = () =>
    run(async () => {
      const data = await unwrap(await api.me.export.$get());
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = Object.assign(document.createElement("a"), { href: url, download: "meus-dados.json" });
      link.click();
      URL.revokeObjectURL(url);
      toast({ type: "success", title: "Seus dados foram baixados" });
    });

  const deleteAccount = () =>
    run(async () => {
      setConfirming(false);
      await deleteAccountRequest();
      await signOut({ redirectUrl: "/" });
    });

  return (
    <Card title="Meus dados">
      <div className="flex flex-wrap gap-2">
        <button className={buttonClass} disabled={busy} onClick={exportData}>
          Baixar meus dados
        </button>
        <button
          className="rounded-md border border-red-600 px-3 py-1.5 text-sm text-red-600 disabled:opacity-50"
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          Excluir conta
        </button>
      </div>
      <Status text={status?.text ?? null} tone={status?.tone} />
      <Dialog open={confirming} onClose={() => setConfirming(false)} title="Excluir sua conta?">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Todos os seus dados e arquivos serão apagados e assinaturas ativas serão canceladas. Esta ação não pode ser
          desfeita. Por segurança, podemos pedir que você confirme sua identidade.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            Cancelar
          </Button>
          <Button variant="danger" loading={busy} onClick={deleteAccount}>
            Excluir definitivamente
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}
