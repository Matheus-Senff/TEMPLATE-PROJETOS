"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { unwrap, useApi } from "./api";
import { queryKeys } from "./query-keys";

/** Flags on for everyone when PostHog is off (and for signed-out visitors): NEXT_PUBLIC_FEATURE_FLAGS. */
const envFlags = new Set(
  (process.env.NEXT_PUBLIC_FEATURE_FLAGS ?? "")
    .split(",")
    .map((flag) => flag.trim())
    .filter(Boolean),
);

/**
 * `const enabled = useFeatureFlag("new-checkout")`. Signed-in users get the API's server-side evaluation
 * (GET /me/flags: PostHog per user, FEATURE_FLAGS without it), so it works without analytics cookies (LGPD);
 * signed-out visitors and the loading state use NEXT_PUBLIC_FEATURE_FLAGS. Hiding UI only: the API checks
 * `isFeatureEnabled()` again for anything that matters.
 */
export function useFeatureFlag(flag: string): boolean {
  const { isSignedIn } = useAuth();
  const api = useApi();
  const flags = useQuery({
    queryKey: queryKeys.flags(),
    enabled: Boolean(isSignedIn),
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await api.me.flags.$get()),
  });
  if (isSignedIn && flags.data) return flags.data.flags[flag] === true;
  return envFlags.has(flag);
}
