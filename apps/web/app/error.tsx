"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/report-error";
import { buttonClass } from "@/components/card";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportError(error);
  }, [error]);

  return (
    <section className="space-y-3">
      <h1 className="text-2xl font-bold">Algo deu errado.</h1>
      <p className="text-neutral-600 dark:text-neutral-400">O erro foi registrado. Tente novamente.</p>
      <button className={buttonClass} onClick={() => reset()}>
        Tentar de novo
      </button>
    </section>
  );
}
