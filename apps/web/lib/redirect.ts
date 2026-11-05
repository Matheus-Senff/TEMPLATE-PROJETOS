/**
 * True for internal paths only. Rejects absolute URLs, protocol-relative `//x` and backslash tricks like
 * `/\evil.com` (browsers treat `\` as `/`).
 */
export function isSafePath(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("\\")) return false;
  try {
    return new URL(value, "http://local.invalid").origin === "http://local.invalid";
  } catch {
    return false;
  }
}
