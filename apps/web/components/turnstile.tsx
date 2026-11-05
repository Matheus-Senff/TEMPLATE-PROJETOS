"use client";

import { useEffect, useRef } from "react";

type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      action?: string;
      language?: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** True when the site key is set; the API then requires a token (TURNSTILE_SECRET_KEY). */
export const turnstileEnabled = Boolean(SITE_KEY);

let scriptLoading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptLoading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = Object.assign(document.createElement("script"), { src: SCRIPT_SRC, async: true, defer: true });
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile indisponível")));
    script.onerror = () => {
      scriptLoading = null;
      reject(new Error("Não foi possível carregar a verificação anti-robô"));
    };
    document.head.appendChild(script);
  });
  return scriptLoading;
}

/**
 * Cloudflare Turnstile widget (loaded only on pages that render it, e.g. /contato). Renders nothing when
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY is empty. Tokens are single-use: bump `resetKey` after every submit.
 * `action` must match the one the API checks (`verifyTurnstile(token, ip, "contact")`).
 */
export function Turnstile({
  action,
  onToken,
  resetKey = 0,
}: {
  action: string;
  onToken: (token: string | null) => void;
  resetKey?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const latestOnToken = useRef(onToken);
  useEffect(() => {
    latestOnToken.current = onToken;
  });

  useEffect(() => {
    if (!SITE_KEY || !container.current) return;
    let cancelled = false;
    void loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !container.current || widgetId.current) return;
        widgetId.current = turnstile.render(container.current, {
          sitekey: SITE_KEY,
          action,
          language: "pt-br",
          callback: (token) => latestOnToken.current(token),
          "expired-callback": () => latestOnToken.current(null),
          "error-callback": () => latestOnToken.current(null),
        });
      })
      .catch(() => latestOnToken.current(null));
    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [action]);

  useEffect(() => {
    if (resetKey > 0 && widgetId.current) {
      window.turnstile?.reset(widgetId.current);
      latestOnToken.current(null);
    }
  }, [resetKey]);

  if (!SITE_KEY) return null;
  return <div ref={container} className="min-h-[65px]" />;
}
