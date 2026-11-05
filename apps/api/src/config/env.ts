import { z } from "zod";

/** Treats empty strings (e.g. `STRIPE_SECRET_KEY=`) as "not set" so optional modules stay disabled. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

/** Same as `optional`, but keeps the schema's default when the value is empty. */
const withDefault = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

/** Explicit opt-in switch: only "true" or "1" turn it on. */
const flag = () =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .enum(["true", "false", "1", "0"])
      .optional()
      .transform((value) => value === "true" || value === "1"),
  );

const list = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url().default("http://localhost:5173"),
  CORS_ORIGINS: z
    .string()
    .default("*")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  /**
   * Extra origins allowed to use Clerk session tokens (`azp`), as an anchored regex, for preview deployments
   * whose URL changes per branch, e.g. ^https://myapp-web-[a-z0-9-]+-myteam\.vercel\.app$ . Exact origins come
   * from APP_URL + CORS_ORIGINS.
   */
  AUTHORIZED_PARTY_PATTERN: optional(
    z
      .string()
      .refine((value) => value.startsWith("^") && value.endsWith("$"), "must be anchored: ^...$")
      .refine((value) => {
        try {
          new RegExp(value);
          return true;
        } catch {
          return false;
        }
      }, "must be a valid regular expression"),
  ),

  DATABASE_URL: z.string().url(),
  /**
   * Host of the PRODUCTION Neon endpoint without "-pooler" (e.g. ep-cool-123456.sa-east-1.aws.neon.tech).
   * Not a secret; set it in every Vercel environment: a preview/development deployment refuses to start if its
   * DATABASE_URL points there, and the build migration (scripts/migrate.ts) uses it as a safety check.
   */
  PRODUCTION_DATABASE_HOST: optional(z.string().min(1)),

  CLERK_SECRET_KEY: z.string().startsWith("sk_"),
  CLERK_PUBLISHABLE_KEY: z.string().startsWith("pk_"),
  /**
   * Optional PEM public key (Clerk > API keys > JWT public key). With it, session tokens are verified locally
   * (networkless): a cold start does not fetch Clerk's JWKS first. Escaped "\n" are accepted.
   */
  CLERK_JWT_KEY: optional(
    z
      .string()
      .includes("PUBLIC KEY", { message: "must be the PEM public key (-----BEGIN PUBLIC KEY-----...)" })
      .transform((value) => value.replace(/\\n/g, "\n")),
  ),
  /** Clerk > Webhooks > endpoint .../webhooks/clerk > Signing secret. Empty = /webhooks/clerk answers 503. */
  CLERK_WEBHOOK_SIGNING_SECRET: optional(z.string().startsWith("whsec_")),

  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  R2_PUBLIC_URL: optional(z.string().url()),
  R2_PRESIGN_EXPIRES_IN: z.coerce.number().int().min(60).max(604_800).default(900),
  UPLOAD_MAX_BYTES: withDefault(
    z.coerce
      .number()
      .int()
      .positive()
      .default(25 * 1024 * 1024),
  ),
  UPLOAD_ALLOWED_TYPES: withDefault(
    z
      .string()
      .default(
        "image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,text/csv,application/zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      )
      .transform((value) =>
        value
          .split(",")
          .map((type) => type.trim().toLowerCase())
          .filter(Boolean),
      ),
  ),

  /** Per-user storage quota: bytes of ready + in-flight uploads (default 1 GiB). */
  UPLOAD_QUOTA_BYTES: withDefault(
    z.coerce
      .number()
      .int()
      .positive()
      .default(1024 * 1024 * 1024),
  ),

  CLIENT_IP_HEADER: optional(
    z
      .string()
      .min(1)
      .transform((value) => value.toLowerCase()),
  ),
  /**
   * Shared with the web (same value in both projects): the web's proxy.ts forwards the visitor IP in
   * `x-app-client-ip` together with this secret, and only then the API trusts that header. Min 16 chars.
   */
  API_PROXY_SECRET: optional(z.string().min(16, "must have at least 16 characters")),
  /** "debug" logs extra diagnostics (e.g. where the client IP came from). */
  LOG_LEVEL: withDefault(z.enum(["debug", "info"]).default("info")),
  /** Production refuses to start without Upstash Redis unless rate limiting is explicitly turned off. */
  RATE_LIMIT_DISABLED: flag(),

  /** Cloudflare Turnstile (bot check on public forms). Server-side secret; the site key goes to the web. */
  TURNSTILE_SECRET_KEY: optional(z.string().min(1)),
  /** Production refuses to start without TURNSTILE_SECRET_KEY unless this is "true". */
  TURNSTILE_DISABLED: flag(),
  /** Hostnames a Turnstile token may come from (subdomains included). Empty = the APP_URL hostname. */
  TURNSTILE_ALLOWED_HOSTNAMES: optional(z.string().transform(list)),

  /** Shared secret for Vercel Cron (`Authorization: Bearer <CRON_SECRET>`) and detailed /health. Min 16 chars. */
  CRON_SECRET: optional(z.string().min(16, "must have at least 16 characters")),

  // Optional modules: leave empty to disable.
  STRIPE_SECRET_KEY: optional(z.string().regex(/^(sk|rk)_(test|live)_/, "must start with sk_test_/sk_live_")),
  STRIPE_WEBHOOK_SECRET: optional(z.string().startsWith("whsec_")),
  /**
   * Who pays: "user" (each user has their own subscription, default) or "org" (the active Clerk organization
   * subscribes for all its members; only org admins manage billing). See src/lib/billing-owner.ts.
   */
  BILLING_OWNER: withDefault(z.enum(["user", "org"]).default("user")),
  /** Prices the checkout accepts (comma-separated price_...). Empty = any price in the account. */
  STRIPE_PRICE_IDS: optional(
    z.string().transform((value) =>
      value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ),

  ABLY_API_KEY: optional(z.string().regex(/^[^.:]+\.[^.:]+:.+$/, "must look like appId.keyId:keySecret")),

  // Sentry DSN is read by src/instrument.ts (loaded with --import before the app).
  SENTRY_DSN: optional(z.string().url()),

  RESEND_API_KEY: optional(z.string().startsWith("re_")),
  EMAIL_FROM: z.string().default("App <onboarding@resend.dev>"),
  /** Inbox that receives the public contact form. Empty = messages are only logged. */
  CONTACT_EMAIL: optional(z.string().email()),

  UPSTASH_REDIS_REST_URL: optional(z.string().url()),
  UPSTASH_REDIS_REST_TOKEN: optional(z.string().min(1)),

  QSTASH_TOKEN: optional(z.string().min(1)),
  QSTASH_URL: optional(z.string().url()),
  QSTASH_CURRENT_SIGNING_KEY: optional(z.string().min(1)),
  QSTASH_NEXT_SIGNING_KEY: optional(z.string().min(1)),
  /** Public URL of this API: QStash calls `${API_PUBLIC_URL}/jobs/<name>` back. */
  API_PUBLIC_URL: optional(z.string().url()),

  POSTHOG_KEY: optional(z.string().startsWith("phc_")),
  /** Feature flags on without PostHog (or when it fails): comma-separated names, e.g. "new-checkout,beta". */
  FEATURE_FLAGS: optional(z.string().transform(list)),
  POSTHOG_HOST: z.string().url().default("https://us.i.posthog.com"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  if (parsed.data.STRIPE_SECRET_KEY && !parsed.data.STRIPE_WEBHOOK_SECRET) {
    console.warn("STRIPE_WEBHOOK_SECRET is not set: the /stripe/webhook route will reject all events.");
  }
  if (parsed.data.STRIPE_SECRET_KEY && !parsed.data.STRIPE_PRICE_IDS?.length) {
    if (parsed.data.NODE_ENV === "production") {
      throw new Error("STRIPE_PRICE_IDS is required in production when Stripe is enabled.");
    }
    console.warn("STRIPE_PRICE_IDS is not set: /stripe/checkout accepts any price id sent by the browser.");
  }
  if (Boolean(parsed.data.UPSTASH_REDIS_REST_URL) !== Boolean(parsed.data.UPSTASH_REDIS_REST_TOKEN)) {
    throw new Error("Set both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or neither.");
  }
  if (parsed.data.QSTASH_TOKEN && !(parsed.data.QSTASH_CURRENT_SIGNING_KEY && parsed.data.QSTASH_NEXT_SIGNING_KEY)) {
    throw new Error("QSTASH_TOKEN requires QSTASH_CURRENT_SIGNING_KEY and QSTASH_NEXT_SIGNING_KEY.");
  }
  if (parsed.data.QSTASH_TOKEN && !parsed.data.API_PUBLIC_URL) {
    console.warn("API_PUBLIC_URL is not set: QStash cannot call /jobs back; jobs will run inline.");
  }
  const data = parsed.data;
  const databaseHost = new URL(data.DATABASE_URL).hostname.replace("-pooler.", ".");
  const vercelEnv = process.env.VERCEL_ENV;
  if (data.PRODUCTION_DATABASE_HOST && vercelEnv && vercelEnv !== "production") {
    if (databaseHost === data.PRODUCTION_DATABASE_HOST) {
      throw new Error(
        `This ${vercelEnv} deployment points to the PRODUCTION database. Use a Neon branch (Neon-Vercel integration).`,
      );
    }
  }
  const redisEnabled = Boolean(data.UPSTASH_REDIS_REST_URL && data.UPSTASH_REDIS_REST_TOKEN);
  if (data.NODE_ENV === "production") {
    // Collected so a misconfigured deploy shows every problem at once.
    const problems: string[] = [];
    if (data.CORS_ORIGINS.includes("*"))
      problems.push("CORS_ORIGINS cannot be * in production: list the front-end origins.");
    if (!redisEnabled && !data.RATE_LIMIT_DISABLED) {
      problems.push(
        "Rate limiting needs Upstash Redis in production: set UPSTASH_REDIS_REST_URL/TOKEN (or RATE_LIMIT_DISABLED=true to run without it, at your own risk).",
      );
    }
    if (!data.TURNSTILE_SECRET_KEY && !data.TURNSTILE_DISABLED) {
      problems.push(
        "TURNSTILE_SECRET_KEY is required in production to protect public forms (or set TURNSTILE_DISABLED=true).",
      );
    }
    if (problems.length > 0) throw new Error(problems.join("\n"));
  } else if (data.NODE_ENV === "development" && !redisEnabled && !data.RATE_LIMIT_DISABLED) {
    console.warn(
      "\n[rate-limit] WARNING: Upstash Redis is not configured, so RATE LIMITING IS OFF. " +
        "Production refuses to start like this; set UPSTASH_REDIS_REST_URL/TOKEN or RATE_LIMIT_DISABLED=true.\n",
    );
  }
  return data;
}

export const env = loadEnv();
