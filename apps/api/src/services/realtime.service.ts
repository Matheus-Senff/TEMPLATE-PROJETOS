import { createHmac } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { ablyConfig, getAblyRest } from "../config/ably.js";

/** Ably capability map: channel pattern -> allowed operations. */
export type AblyCapability = Record<string, Array<"subscribe" | "publish" | "presence" | "history">>;

const base64url = (input: string | Buffer): string => Buffer.from(input).toString("base64url");

/** Default per-user permissions. Adjust the channel naming to your app. */
export const defaultCapability = (userId: string): AblyCapability => ({
  [`user:${userId}`]: ["subscribe", "history"],
  "public:*": ["subscribe", "presence"],
});

/**
 * Signs an Ably JWT locally (no round-trip to Ably). The browser uses it via
 * `new Ably.Realtime({ authUrl: "/realtime/token" })`; the API key never leaves the server.
 */
export function createAblyJwt(userId: string, capability: AblyCapability = defaultCapability(userId)): string {
  if (!ablyConfig.enabled || !ablyConfig.keyName || !ablyConfig.keySecret) {
    throw new HTTPException(503, { message: "Tempo real desativado (ABLY_API_KEY não configurada)." });
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ typ: "JWT", alg: "HS256", kid: ablyConfig.keyName }));
  const payload = base64url(
    JSON.stringify({
      iat: now,
      exp: now + ablyConfig.tokenTtlSeconds,
      "x-ably-capability": JSON.stringify(capability),
      "x-ably-clientId": userId,
    }),
  );
  const signature = createHmac("sha256", ablyConfig.keySecret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/** Server-side publish over REST (stateless; no WebSocket needed). */
export async function publish(channel: string, name: string, data: unknown): Promise<void> {
  const ablyRest = ablyConfig.enabled ? await getAblyRest() : null;
  if (!ablyRest) throw new HTTPException(503, { message: "Tempo real desativado (ABLY_API_KEY não configurada)." });
  await ablyRest.channels.get(channel).publish(name, data);
}

/** Convenience: push an event to a single user's private channel. */
export const notifyUser = (userId: string, name: string, data: unknown): Promise<void> =>
  publish(`user:${userId}`, name, data);
