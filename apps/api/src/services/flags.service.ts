import { analyticsConfig, getPostHog } from "../config/posthog.js";
import { env } from "../config/env.js";

/**
 * Feature flags. With PostHog (POSTHOG_KEY) flags are evaluated per user (rollouts, targeting, A/B); without
 * it, or if PostHog fails, the env list FEATURE_FLAGS decides (on/off for everyone). Never throws.
 *   if (await isFeatureEnabled("new-checkout", userId)) { ... }
 * The web reads the same answers through GET /me/flags (`useFeatureFlag()` in apps/web/lib/flags.ts).
 */
const envFlags = (): Set<string> => new Set(env.FEATURE_FLAGS ?? []);

export async function isFeatureEnabled(flag: string, distinctId?: string): Promise<boolean> {
  if (analyticsConfig.enabled && distinctId) {
    try {
      const posthog = await getPostHog();
      const value = await posthog?.isFeatureEnabled(flag, distinctId);
      if (typeof value === "boolean") return value;
    } catch (error) {
      console.warn(`flags: PostHog failed for "${flag}", using FEATURE_FLAGS`, error);
    }
  }
  return envFlags().has(flag);
}

/** Every flag on for this user (multivariate flags count as on; their variant goes through PostHog itself). */
export async function enabledFlags(distinctId?: string): Promise<Record<string, boolean>> {
  const flags: Record<string, boolean> = Object.fromEntries([...envFlags()].map((flag) => [flag, true]));
  if (analyticsConfig.enabled && distinctId) {
    try {
      const posthog = await getPostHog();
      const all = (await posthog?.getAllFlags(distinctId)) ?? {};
      for (const [flag, value] of Object.entries(all)) flags[flag] = value === true || typeof value === "string";
    } catch (error) {
      console.warn("flags: PostHog failed, using FEATURE_FLAGS", error);
    }
  }
  return flags;
}
