"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/report-error";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportError(error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: "sans-serif", padding: 32 }}>
        <h1>Algo deu errado.</h1>
        <p>O erro foi registrado. Tente novamente.</p>
        <button onClick={() => reset()}>Tentar de novo</button>
      </body>
    </html>
  );
}
