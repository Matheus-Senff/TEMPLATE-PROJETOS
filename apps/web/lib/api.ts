"use client";

import type { AppType } from "@app/api/app";
import { useAuth } from "@clerk/nextjs";
import { type ClientResponse, hc } from "hono/client";
import { useMemo } from "react";

/**
 * Default: same-origin `/api` (rewritten by next.config.ts to the API project, see api-proxy.ts): no CORS
 * preflights and previews reach their own API. Direct cross-origin mode (another domain, mobile apps, tests):
 * set NEXT_PUBLIC_API_URL to the API's absolute URL and list this site in the API's CORS_ORIGINS.
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "/api").replace(/\/+$/, "");

/**
 * Typed client for apps/api (routes, bodies and responses inferred from the Hono app).
 * Every request carries the Clerk session token as `Authorization: Bearer`.
 */
export function useApi() {
  const { getToken } = useAuth();
  return useMemo(
    () =>
      hc<AppType>(API_URL, {
        headers: async (): Promise<Record<string, string>> => {
          const token = await getToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    [getToken],
  );
}

/** JSON body of the success branch (drops the 400 validation-error branch added by zValidator). */
type SuccessJson<R> = R extends ClientResponse<infer T, infer S, string> ? (S extends 400 ? never : T) : never;

/** Throws with the API's `{ error }` message when the response is not 2xx; otherwise returns the typed body. */
export async function unwrap<R extends ClientResponse<unknown, number, string>>(response: R): Promise<SuccessJson<R>> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${response.status}`);
  }
  return (await response.json()) as SuccessJson<R>;
}

/** Body Clerk's `reverificationError()` sends (403) when an action needs a recent re-authentication. */
export type ReverificationHint = { clerk_error: { type: "forbidden"; reason: "reverification-error" } };

const isReverificationHint = (body: unknown): body is ReverificationHint =>
  (body as ReverificationHint | null)?.clerk_error?.reason === "reverification-error";

/**
 * Like `unwrap()`, but hands Clerk's reverification hint back instead of throwing, so `useReverification()`
 * can open the re-authentication modal and retry:
 *   const remove = useReverification(async () => unwrapReverifiable(await api.me.$delete()));
 */
export async function unwrapReverifiable<R extends ClientResponse<unknown, number, string>>(
  response: R,
): Promise<SuccessJson<R> | ReverificationHint> {
  if (response.status === 403) {
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    if (isReverificationHint(body)) return body;
  }
  return unwrap(response);
}
