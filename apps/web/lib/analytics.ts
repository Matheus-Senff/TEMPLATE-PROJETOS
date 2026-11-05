import type { PostHog } from "posthog-js";

const CONSENT_KEY = "cookie-consent";
export const CONSENT_EVENT = "consentchange";

export type Consent = "granted" | "denied";

let instance: PostHog | null = null;
let loading: Promise<PostHog | null> | null = null;
let replayLoaded = false;

export const analyticsConfigured = (): boolean => Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);

export function readConsent(): Consent | null {
  try {
    const value = localStorage.getItem(CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

/** Sentry session replay (masked) only with consent, loaded on demand from Sentry's CDN. */
async function enableReplay(): Promise<void> {
  if (replayLoaded || !process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  replayLoaded = true;
  try {
    const Sentry = await import("@sentry/nextjs");
    const replay = await Sentry.lazyLoadIntegration("replayIntegration");
    Sentry.addIntegration(replay({ maskAllText: true, blockAllMedia: true }));
  } catch {
    replayLoaded = false;
  }
}

/** Loads PostHog (and replay) only after the visitor accepts analytics cookies (LGPD). */
export function initAnalytics(): Promise<PostHog | null> {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  void enableReplay();
  if (!key) return Promise.resolve(null);
  loading ??= import("posthog-js").then(({ default: posthog }) => {
    if (!posthog.__loaded) {
      posthog.init(key, {
        api_host: "/ingest",
        ui_host: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST ?? "https://us.posthog.com",
        defaults: "2026-08-30",
        person_profiles: "identified_only",
      });
    }
    instance = posthog;
    return posthog;
  });
  return loading;
}

/** PostHog instance when loaded and allowed; null otherwise. */
export const getAnalytics = (): PostHog | null =>
  instance?.__loaded && !instance.has_opted_out_capturing() ? instance : null;

export function writeConsent(consent: Consent | null): void {
  try {
    if (consent) localStorage.setItem(CONSENT_KEY, consent);
    else localStorage.removeItem(CONSENT_KEY);
  } catch {}
  if (consent === "granted") {
    void initAnalytics().then((posthog) => {
      posthog?.opt_in_capturing();
      window.dispatchEvent(new Event(CONSENT_EVENT));
    });
  } else if (consent === "denied") {
    instance?.opt_out_capturing();
  }
  window.dispatchEvent(new Event(CONSENT_EVENT));
}
