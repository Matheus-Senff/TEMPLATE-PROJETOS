import { defineConfig } from "vitest/config";

/**
 * Tests run fully offline: services get dummy credentials and every optional module is off.
 * A test that needs a module enabled sets its vars with `vi.stubEnv` and re-imports with `vi.resetModules()`.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Cold runs import big SDKs (AWS, Stripe, Clerk) and start PGlite per file: 5 s defaults flake on CI/Windows.
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://user:pass@ep-test-pooler.us-east-2.aws.neon.tech/db?sslmode=require",
      CLERK_SECRET_KEY: "sk_test_dummy",
      // base64("example.clerk.accounts.dev$")
      CLERK_PUBLISHABLE_KEY: "pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk",
      CLERK_WEBHOOK_SIGNING_SECRET: "",
      R2_ACCOUNT_ID: "acc123",
      R2_ACCESS_KEY_ID: "AKIDTEST",
      R2_SECRET_ACCESS_KEY: "secrettest",
      R2_BUCKET: "test-bucket",
      UPLOAD_MAX_BYTES: "",
      UPLOAD_ALLOWED_TYPES: "",
      CLIENT_IP_HEADER: "",
      STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: "",
      STRIPE_PRICE_IDS: "",
      ABLY_API_KEY: "",
      SENTRY_DSN: "",
      RESEND_API_KEY: "",
      CONTACT_EMAIL: "",
      UPSTASH_REDIS_REST_URL: "",
      UPSTASH_REDIS_REST_TOKEN: "",
      QSTASH_TOKEN: "",
      POSTHOG_KEY: "",
    },
  },
});
