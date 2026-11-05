/**
 * Sentry, loaded only when SENTRY_DSN is set: importing the SDK costs ~1.5 s of cold start, so without a DSN
 * it is never imported. app.ts awaits this (top-level await) before building the app, so the first request
 * is already traced. Request tracing and 5xx capture come from the `sentry()` Hono middleware; for Node
 * auto-instrumentation of every module (self-hosted), start with `node --import ./dist/instrument.js`.
 */
export async function initSentry() {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn || process.env.NODE_ENV === "test") return null;
  const Sentry = await import("@sentry/hono/node");
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    tracesSampleRate: Number(
      process.env.SENTRY_TRACES_SAMPLE_RATE ?? (process.env.VERCEL_ENV === "production" ? 0.1 : 1),
    ),
  });
  return Sentry;
}
