import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { ablyConfig } from "./config/ably.js";
import { env } from "./config/env.js";
import { analyticsConfig } from "./config/posthog.js";
import { emailConfig } from "./config/resend.js";
import { stripeConfig } from "./config/stripe.js";
import { upstashConfig } from "./config/upstash.js";
import { clerkWebhookConfig } from "./config/clerk.js";
import { turnstileConfig } from "./config/turnstile.js";
import { sql } from "drizzle-orm";
import { db } from "./db/index.js";
import { initSentry } from "./instrument.js";
import { hasBearer } from "./lib/secret.js";
import { clerkAuth, errorHandler, notFoundHandler, rateLimit } from "./middlewares/index.js";
import { billingRoutes } from "./routes/billing.js";
import { cronRoutes } from "./routes/cron.js";
import { jobsRoutes } from "./routes/jobs.js";
import { adminRoutes } from "./modules/admin/admin.routes.js";
import { contactRoutes } from "./modules/contact/contact.routes.js";
import { meRoutes } from "./routes/me.js";
import { notificationsRoutes } from "./routes/notifications.js";
import { realtimeRoutes } from "./routes/realtime.js";
import { uploadsRoutes } from "./routes/uploads.js";
import { webhooksRoutes } from "./routes/webhooks.js";

const features = {
  sentry: Boolean(env.SENTRY_DSN),
  analytics: analyticsConfig.enabled,
  email: emailConfig.enabled,
  redis: upstashConfig.redisEnabled,
  queue: upstashConfig.queueEnabled,
  stripe: stripeConfig.enabled,
  ably: ablyConfig.enabled,
  clerkWebhooks: clerkWebhookConfig.enabled,
  cron: Boolean(env.CRON_SECRET),
  turnstile: turnstileConfig.enabled,
};

/** Cheap connectivity check (one round-trip); false when the database does not answer within 3 s. */
async function databaseUp(): Promise<boolean> {
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000).unref()),
    ]);
    return true;
  } catch (error) {
    console.error("health: database check failed", error);
    return false;
  }
}

/** Signature/secret-verified callbacks (Stripe, QStash, Clerk, Vercel Cron): bursts are legitimate and retried. */
const isSignedCallback = (path: string): boolean =>
  path === "/stripe/webhook" || path.startsWith("/jobs/") || path.startsWith("/webhooks/") || path.startsWith("/cron/");
const globalRateLimit = rateLimit({ prefix: "global", limit: 120, window: "1 m" });

/**
 * Optional SDKs are imported lazily (config/*.ts getters) so a cold start only pays for what is configured
 * and used. Sentry is awaited here (top-level await) so it is ready whichever file Vercel picks as the
 * entrypoint (src/index.ts or src/app.ts); without SENTRY_DSN it is never imported.
 */
const Sentry = env.SENTRY_DSN ? await initSentry() : null;

const root = new Hono();
// Sentry first: traces every request and reports 5xx errors.
if (Sentry) root.use(Sentry.sentry(root));

export const app = root
  .use(logger())
  .use(secureHeaders())
  .use(
    cors({
      origin: env.CORS_ORIGINS.includes("*") ? "*" : env.CORS_ORIGINS,
      credentials: !env.CORS_ORIGINS.includes("*"),
      maxAge: 600,
    }),
  )
  .use(clerkAuth())
  // Per user (or IP when signed out) for the whole API; no-op without Upstash Redis.
  .use((c, next) =>
    isSignedCallback(c.req.path) || c.req.path.startsWith("/health") ? next() : globalRateLimit(c, next),
  )
  /**
   * Readiness: `{ status }` plus a database round-trip (503 when the DB is down). Module details only with
   * `Authorization: Bearer <CRON_SECRET>`. Note: every call wakes Neon's compute, so point frequent uptime
   * monitors at /health/live instead (otherwise Neon never scales to zero and bills compute hours).
   */
  .get("/health", async (c) => {
    c.header("Cache-Control", "no-store");
    const dbUp = await databaseUp();
    const status = dbUp ? ("ok" as const) : ("error" as const);
    const details = hasBearer(c.req.header("authorization"), env.CRON_SECRET) ? { database: dbUp, features } : {};
    return c.json({ status, ...details }, dbUp ? 200 : 503);
  })
  /** Liveness only (no database): cheap target for uptime monitors. */
  .get("/health/live", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ status: "ok" as const });
  })
  .route("/me", meRoutes)
  .route("/contact", contactRoutes)
  .route("/admin", adminRoutes)
  .route("/uploads", uploadsRoutes)
  .route("/notifications", notificationsRoutes)
  // Optional modules: always mounted (keeps RPC types stable); they answer 503 when their keys are not set.
  .route("/stripe", billingRoutes)
  .route("/realtime", realtimeRoutes)
  .route("/jobs", jobsRoutes)
  .route("/webhooks", webhooksRoutes)
  .route("/cron", cronRoutes);

app.onError(errorHandler);
app.notFound(notFoundHandler);

/** Export for typed RPC clients: `hc<AppType>(baseUrl)` from `hono/client`. */
export type AppType = typeof app;

export default app;
