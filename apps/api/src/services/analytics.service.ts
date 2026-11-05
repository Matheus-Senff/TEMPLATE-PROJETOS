import { analyticsConfig, getPostHog } from "../config/posthog.js";

/**
 * Records a server-side product event (e.g. "file uploaded", "subscription started").
 * Use the Clerk user id as distinctId so it matches the browser events. No-op without PostHog.
 * Never throws: analytics must not break a request.
 */
export async function trackEvent(
  distinctId: string,
  event: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  if (!analyticsConfig.enabled) return;
  try {
    const posthog = await getPostHog();
    await posthog?.captureImmediate({ distinctId, event, properties });
  } catch (error) {
    console.warn(`analytics: failed to send "${event}"`, error);
  }
}
