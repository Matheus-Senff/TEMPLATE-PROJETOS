import { redis } from "../config/upstash.js";

/**
 * Read-through cache on Upstash Redis. Without Redis it just calls `load()` (no caching).
 * Values must be JSON-serializable.
 */
export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  if (!redis) return load();
  const hit = await redis.get<T>(key);
  if (hit !== null) return hit;
  const value = await load();
  await redis.set(key, value, { ex: ttlSeconds });
  return value;
}

export async function invalidate(...keys: string[]): Promise<void> {
  if (redis && keys.length > 0) await redis.del(...keys);
}
