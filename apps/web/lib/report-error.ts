/**
 * Reports an error to Sentry from error boundaries. The SDK is loaded on demand and only when
 * NEXT_PUBLIC_SENTRY_DSN is set, so it never weighs on the bundle otherwise.
 */
export function reportError(error: unknown): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  void import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error)).catch(() => {});
}
