import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import { resolveApiUrl } from "./api-proxy";
import { buildCsp } from "./csp";

/** API behind the same-origin `/api` proxy (see api-proxy.ts). */
const apiUrl = resolveApiUrl();
if (process.env.VERCEL) console.info(`[api-proxy] /api/* -> ${apiUrl}`);

/** PostHog region: "us" or "eu". */
const posthogRegion = process.env.NEXT_PUBLIC_POSTHOG_REGION === "eu" ? "eu" : "us";

/**
 * Security headers for every page. The CSP is computed at build time from env (see csp.ts for the
 * allowlist and why there is no nonce: public pages must stay static).
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  { key: "Content-Security-Policy", value: buildCsp() },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Shared zod schemas come from apps/api source (`@app/api/schemas`).
  transpilePackages: ["@app/api"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // PostHog API paths end with "/" (e.g. /e/, /flags/); avoid 308 redirects on them.
  skipTrailingSlashRedirect: true,
  // Reverse proxies: the API (same origin, see api-proxy.ts) and PostHog (see lib/analytics.ts).
  // Specific PostHog rules come before its catch-all.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiUrl}/:path*` },
      { source: "/ingest/static/:path*", destination: `https://${posthogRegion}-assets.i.posthog.com/static/:path*` },
      { source: "/ingest/array/:path*", destination: `https://${posthogRegion}-assets.i.posthog.com/array/:path*` },
      { source: "/ingest/:path*", destination: `https://${posthogRegion}.i.posthog.com/:path*` },
    ];
  },
};

/**
 * Source maps are uploaded only when SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT are set
 * (e.g. in the Vercel project env). Without them the build works normally.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  // Proxies browser events through the app to avoid ad-blockers.
  tunnelRoute: "/monitoring",
});
