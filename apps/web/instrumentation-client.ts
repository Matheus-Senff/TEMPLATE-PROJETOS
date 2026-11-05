import type * as SentryModule from "@sentry/nextjs";
import { initAnalytics, readConsent } from "./lib/analytics";

/**
 * Sentry is imported only when NEXT_PUBLIC_SENTRY_DSN is set (dynamic import): without a DSN the SDK and its
 * tracing never reach the browser bundle of the static public pages.
 */
const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
let sentry: typeof SentryModule | null = null;

if (sentryDsn) {
  void import("@sentry/nextjs").then((Sentry) => {
    Sentry.init({
      dsn: sentryDsn,
      // NEXT_PUBLIC_VERCEL_ENV (exposed by Vercel) separates preview from production; both have NODE_ENV=production.
      environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
      tracesSampleRate: process.env.NEXT_PUBLIC_VERCEL_ENV === "production" ? 0.1 : 1,
      // Replay is added on demand after cookie consent (lib/analytics.ts).
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1,
    });
    sentry = Sentry;
  });
}

// PostHog and Sentry Replay start only with consent (LGPD); the cookie banner calls initAnalytics() on accept.
if (readConsent() === "granted") void initAnalytics();

/** Navigation spans (no-op until Sentry has loaded, and always without a DSN). */
export function onRouterTransitionStart(...args: Parameters<typeof SentryModule.captureRouterTransitionStart>) {
  sentry?.captureRouterTransitionStart(...args);
}
