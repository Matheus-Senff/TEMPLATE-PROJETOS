import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time string comparison (hashing first makes lengths equal, so length is not leaked either). */
export function safeEqual(a: string, b: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/** True when the request carries `Authorization: Bearer <secret>` (secret unset = always false). */
export function hasBearer(authorization: string | undefined, secret: string | undefined): boolean {
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  return safeEqual(authorization.slice("Bearer ".length), secret);
}
