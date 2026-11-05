import type Ably from "ably";
import { env } from "./env.js";
import { lazy } from "./lazy.js";

const [keyName, keySecret] = env.ABLY_API_KEY?.split(":") ?? [];

export const ablyConfig = {
  enabled: Boolean(env.ABLY_API_KEY),
  /** `appId.keyId` - goes in the JWT `kid` header. */
  keyName,
  /** Signs client JWTs locally (no SDK needed). Never send it to the browser. */
  keySecret,
  tokenTtlSeconds: 60 * 60,
} as const;

/** Server-side REST client (publish, history), loaded on first use. `null` when ABLY_API_KEY is not set. */
export const getAblyRest = lazy(async (): Promise<Ably.Rest | null> => {
  if (!env.ABLY_API_KEY) return null;
  const { default: AblySdk } = await import("ably");
  return new AblySdk.Rest({ key: env.ABLY_API_KEY });
});
