import { Ratelimit } from "@upstash/ratelimit";
import { getAuth } from "@clerk/hono";
import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { HTTPException } from "hono/http-exception";
import { env } from "../config/env.js";
import { safeEqual } from "../lib/secret.js";
import { redis } from "../config/upstash.js";

type Duration = `${number} ${"ms" | "s" | "m" | "h" | "d"}`;

export type RateLimitOptions = {
  /** Requests allowed per window. */
  limit: number;
  window: Duration;
  /** Separates counters per use case, e.g. "global", "uploads". */
  prefix: string;
  /** Defaults to the authenticated user id, falling back to the client IP. */
  key?: (c: Context) => string;
};

const firstForwarded = (value: string | undefined): string | undefined => value?.split(",")[0]?.trim() || undefined;

/** Headers the web's proxy.ts sets on /api requests (see apps/web/api-proxy.ts). */
export const PROXY_IP_HEADER = "x-app-client-ip";
export const PROXY_AUTH_HEADER = "x-app-proxy-auth";

const IP_SHAPE = /^[0-9a-f:.]{2,45}$/i;

type IpSource = "web-proxy" | "client-ip-header" | "vercel" | "socket" | "unknown";

function resolveClientIp(c: Context): { ip: string; source: IpSource } {
  // 1. The web's same-origin proxy, authenticated by API_PROXY_SECRET (the visitor never sees the secret).
  const proxyAuth = c.req.header(PROXY_AUTH_HEADER);
  if (env.API_PROXY_SECRET && proxyAuth && safeEqual(proxyAuth, env.API_PROXY_SECRET)) {
    const fromProxy = c.req.header(PROXY_IP_HEADER)?.trim();
    if (fromProxy && IP_SHAPE.test(fromProxy)) return { ip: fromProxy, source: "web-proxy" };
  }
  // 2. A proxy you control that overwrites this header (cf-connecting-ip, x-real-ip behind your nginx).
  if (env.CLIENT_IP_HEADER) {
    const fromHeader = firstForwarded(c.req.header(env.CLIENT_IP_HEADER));
    if (fromHeader) return { ip: fromHeader, source: "client-ip-header" };
  }
  // 3. Vercel overwrites x-real-ip / x-forwarded-for.
  if (process.env.VERCEL) {
    const fromPlatform = firstForwarded(c.req.header("x-real-ip")) ?? firstForwarded(c.req.header("x-forwarded-for"));
    if (fromPlatform) return { ip: fromPlatform, source: "vercel" };
  }
  // 4. Self-hosted: the socket (forwarded headers are ignored: any client can send them).
  try {
    const address = getConnInfo(c).remote.address;
    return address ? { ip: address, source: "socket" } : { ip: "unknown", source: "unknown" };
  } catch {
    return { ip: "unknown", source: "unknown" };
  }
}

/**
 * Client IP, trusting only what is guaranteed, in this order: the web proxy header signed with
 * API_PROXY_SECRET; CLIENT_IP_HEADER; x-real-ip/x-forwarded-for on Vercel; the socket address elsewhere.
 * LOG_LEVEL=debug logs which source was used (check it once after deploying the proxy).
 */
export const clientIp = (c: Context): string => {
  const { ip, source } = resolveClientIp(c);
  if (env.LOG_LEVEL === "debug") console.info(`[client-ip] ${ip} (source: ${source})`);
  return ip;
};

const noop: MiddlewareHandler = async (_c, next) => next();

/** Signed-in user id, if any (routes mounted without clerkMiddleware, e.g. in tests, count as signed out). */
const currentUserId = (c: Context): string | undefined => {
  const fromContext = (c.get as (key: string) => unknown)("userId");
  if (typeof fromContext === "string") return fromContext;
  try {
    return getAuth(c)?.userId ?? undefined;
  } catch {
    return undefined;
  }
};

/**
 * Sliding-window rate limit on Upstash Redis.
 * Without Redis it is a no-op: allowed only in development (a loud warning is logged at startup) or with
 * RATE_LIMIT_DISABLED=true; production refuses to start otherwise (see config/env.ts).
 * Fails open: if Redis is slow or down, the request goes through instead of breaking the API.
 */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  if (!redis || env.RATE_LIMIT_DISABLED) return noop;

  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(options.limit, options.window),
    prefix: `ratelimit:${options.prefix}`,
    analytics: false,
    timeout: 1000,
  });

  return async (c, next) => {
    const userId = currentUserId(c);
    const key = options.key?.(c) ?? (userId ? `user:${userId}` : `ip:${clientIp(c)}`);
    let result: Awaited<ReturnType<typeof limiter.limit>>;
    try {
      result = await limiter.limit(key);
    } catch (error) {
      console.warn(`rate-limit(${options.prefix}): Redis unavailable, allowing request`, error);
      return next();
    }
    const { success, limit, remaining, reset } = result;

    c.header("RateLimit-Limit", String(limit));
    c.header("RateLimit-Remaining", String(Math.max(0, remaining)));
    c.header("RateLimit-Reset", String(Math.ceil((reset - Date.now()) / 1000)));
    if (!success) throw new HTTPException(429, { message: "Muitas requisições. Tente novamente em instantes." });
    await next();
  };
}
