/**
 * Content-Security-Policy built at BUILD time from env (no per-request nonce).
 *
 * Tradeoff: a nonce-based CSP forces every page to render dynamically (the nonce changes per request), which
 * would break the template's promise of static public pages (CDN-cached, fast, cheap). So scripts are allowed
 * with 'unsafe-inline' (Next.js streams inline RSC payload scripts) and the protection comes from the strict
 * host allowlists instead: a script can only load from this origin and the services listed below, and data
 * can only be sent (connect-src) to them, which blocks exfiltration to arbitrary hosts.
 * Add a host here only when the browser really talks to it (and rebuild: values are fixed at build time).
 */

const originOf = (url: string | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/** Clerk Frontend API host, decoded from the publishable key (`pk_test_<base64("host$")>`). */
export function clerkFrontendApi(publishableKey: string | undefined): string | null {
  const encoded = publishableKey?.split("_")[2];
  if (!encoded) return null;
  try {
    const host = Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
    return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : null;
  } catch {
    return null;
  }
}

export function buildCsp(env: NodeJS.ProcessEnv = process.env): string {
  const dev = env.NODE_ENV !== "production";
  const preview = env.VERCEL_ENV === "preview";
  const clerk = [
    clerkFrontendApi(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
    originOf(env.NEXT_PUBLIC_CLERK_PROXY_URL),
  ].filter(Boolean) as string[];
  const turnstile = "https://challenges.cloudflare.com";
  // Direct cross-origin API mode only; the default same-origin proxy (/api) is covered by 'self'.
  const api = env.NEXT_PUBLIC_API_URL?.startsWith("http") ? originOf(env.NEXT_PUBLIC_API_URL) : null;
  // Presigned PUT uploads go straight to the bucket: set R2_UPLOAD_ORIGIN to
  // https://<bucket>.<account_id>.r2.cloudflarestorage.com to allow only your bucket.
  const r2Upload = originOf(env.R2_UPLOAD_ORIGIN) ?? "https://*.r2.cloudflarestorage.com";
  const r2Public = originOf(env.R2_PUBLIC_URL);
  // Ably realtime endpoints and fallback hosts (REST + WebSocket).
  const ably = ["ably.io", "ably.net", "ably-realtime.com"].flatMap((domain) => [
    `https://*.${domain}`,
    `wss://*.${domain}`,
  ]);
  // Sentry and PostHog go through same-origin proxies (/monitoring, /ingest). Sentry Replay is loaded from its CDN.
  const sentryCdn = env.NEXT_PUBLIC_SENTRY_DSN ? ["https://browser.sentry-cdn.com"] : [];
  // Vercel Toolbar on preview deployments.
  const vercelLive = preview ? ["https://vercel.live", "wss://ws-us3.pusher.com"] : [];
  // Stripe: Checkout and the Customer Portal are full-page redirects (no Stripe.js), so nothing to allow.

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : []), ...clerk, turnstile, ...sentryCdn],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https://img.clerk.com", ...(r2Public ? [r2Public] : [])],
    "font-src": ["'self'", "data:"],
    "media-src": ["'self'", "blob:", ...(r2Public ? [r2Public] : [])],
    "connect-src": [
      "'self'",
      ...clerk,
      "https://clerk-telemetry.com",
      ...(api ? [api] : []),
      r2Upload,
      ...ably,
      ...(dev ? ["ws:", "http://localhost:*"] : []),
    ],
    "frame-src": ["'self'", turnstile, ...clerk],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "form-action": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "frame-ancestors": ["'none'"],
  };
  for (const host of vercelLive) {
    directives["script-src"]!.push(host);
    directives["connect-src"]!.push(host);
    directives["frame-src"]!.push(host);
  }

  const policy = Object.entries(directives).map(([name, values]) => `${name} ${[...new Set(values)].join(" ")}`);
  if (!dev) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}
