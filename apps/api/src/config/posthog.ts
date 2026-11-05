import type { PostHog } from "posthog-node";
import { env } from "./env.js";
import { lazy } from "./lazy.js";

export const analyticsConfig = { enabled: Boolean(env.POSTHOG_KEY) } as const;

/**
 * Server-side analytics, loaded on first use. `null` when POSTHOG_KEY is not set.
 * flushAt/flushInterval tuned for serverless (Vercel): events are sent right away.
 */
export const getPostHog = lazy(async (): Promise<PostHog | null> => {
  if (!env.POSTHOG_KEY) return null;
  const { PostHog: PostHogClient } = await import("posthog-node");
  return new PostHogClient(env.POSTHOG_KEY, { host: env.POSTHOG_HOST, flushAt: 1, flushInterval: 0 });
});
