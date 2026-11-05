import type { Client as QStashClient, Receiver } from "@upstash/qstash";
import { Redis } from "@upstash/redis";
import { env } from "./env.js";
import { lazy } from "./lazy.js";

/**
 * Upstash Redis (cache + rate limit). `null` when not configured. Imported eagerly on purpose: it is small
 * and the rate limiters are built when routes are defined.
 */
export const redis: Redis | null =
  env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN })
    : null;

const queueConfigured = Boolean(
  env.QSTASH_TOKEN && env.QSTASH_CURRENT_SIGNING_KEY && env.QSTASH_NEXT_SIGNING_KEY && env.API_PUBLIC_URL,
);

export const upstashConfig = {
  redisEnabled: redis !== null,
  /** Jobs go through QStash only when it can call this API back. */
  queueEnabled: queueConfigured,
  apiPublicUrl: env.API_PUBLIC_URL,
} as const;

/** Upstash QStash (background jobs, retries, schedules), loaded on first use. `null` when not configured. */
export const getQStash = lazy(async (): Promise<QStashClient | null> => {
  if (!env.QSTASH_TOKEN) return null;
  const { Client } = await import("@upstash/qstash");
  return new Client({ token: env.QSTASH_TOKEN, ...(env.QSTASH_URL && { baseUrl: env.QSTASH_URL }) });
});

/** Verifies that /jobs requests really come from QStash. `null` when the signing keys are not set. */
export const getQStashReceiver = lazy(async (): Promise<Receiver | null> => {
  if (!env.QSTASH_CURRENT_SIGNING_KEY || !env.QSTASH_NEXT_SIGNING_KEY) return null;
  const { Receiver: QStashReceiver } = await import("@upstash/qstash");
  return new QStashReceiver({
    currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
  });
});
