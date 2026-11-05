"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { CONSENT_EVENT, getAnalytics } from "@/lib/analytics";

/**
 * Links PostHog events to the Clerk user id (same id the API uses in `trackEvent`) and resets on sign-out.
 * Sends only the id (no e-mail or name). No-op without PostHog or without analytics consent.
 */
export function AnalyticsIdentify() {
  const { isLoaded, isSignedIn, user } = useUser();
  const identifiedAs = useRef<string | null>(null);
  const [consentVersion, setConsentVersion] = useState(0);

  useEffect(() => {
    const onChange = () => setConsentVersion((v) => v + 1);
    window.addEventListener(CONSENT_EVENT, onChange);
    return () => window.removeEventListener(CONSENT_EVENT, onChange);
  }, []);

  useEffect(() => {
    const posthog = getAnalytics();
    if (!isLoaded || !posthog) return;
    if (isSignedIn && user) {
      if (identifiedAs.current === user.id) return;
      posthog.identify(user.id);
      identifiedAs.current = user.id;
    } else if (identifiedAs.current) {
      posthog.reset();
      identifiedAs.current = null;
    }
  }, [isLoaded, isSignedIn, user, consentVersion]);

  return null;
}
