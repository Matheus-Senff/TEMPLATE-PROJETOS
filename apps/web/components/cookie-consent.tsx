"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { analyticsConfigured, CONSENT_EVENT, readConsent, writeConsent } from "@/lib/analytics";

/**
 * LGPD banner: analytics (PostHog) only runs after "Aceitar". Essential cookies (login) need no consent.
 * Hidden when PostHog is not configured.
 */
export function CookieConsent() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const sync = () => setOpen(analyticsConfigured() && readConsent() === null);
    sync();
    window.addEventListener(CONSENT_EVENT, sync);
    return () => window.removeEventListener(CONSENT_EVENT, sync);
  }, []);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Preferências de cookies"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-200 bg-white p-4 shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-neutral-700 dark:text-neutral-300">
          Usamos cookies essenciais para o login e, com sua permissão, cookies de análise para melhorar o site. Veja a{" "}
          <Link href="/privacidade" className="underline">
            Política de Privacidade
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            className="rounded-md px-3 py-1.5 hover:bg-neutral-200 dark:hover:bg-neutral-800"
            onClick={() => writeConsent("denied")}
          >
            Recusar
          </button>
          <button
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-white dark:bg-white dark:text-neutral-900"
            onClick={() => writeConsent("granted")}
          >
            Aceitar
          </button>
        </div>
      </div>
    </div>
  );
}

/** Footer link that reopens the banner. */
export function CookiePreferencesButton() {
  if (!analyticsConfigured()) return null;
  return (
    <button className="hover:underline" onClick={() => writeConsent(null)}>
      Preferências de cookies
    </button>
  );
}
