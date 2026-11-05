/**
 * Same-origin API proxy: the browser calls `/api/...` on the site's own origin and Next rewrites it to the API
 * project (no CORS preflight on every authenticated call, and preview deployments reach their own API).
 * Resolved at BUILD time from the server-side env `API_URL`, which Vercel sets per environment
 * (Production / Preview / Development). `{branch}` is replaced by the Git branch slug Vercel builds, e.g.
 * API_URL=https://myapp-api-git-{branch}-myteam.vercel.app points every preview at the API preview of the
 * same branch (check the URL printed in the build log: Vercel shortens very long branch names).
 */
/** Header names shared with the API (apps/api/src/middlewares/rate-limit.ts). */
export const PROXY_IP_HEADER = "x-app-client-ip";
export const PROXY_AUTH_HEADER = "x-app-proxy-auth";

/**
 * Request headers for an /api call forwarded to the API by proxy.ts: whatever the browser sent in the proxy
 * headers is dropped (no spoofing), and with API_PROXY_SECRET the visitor IP (as seen by Vercel at the web's
 * edge) travels with the secret, so the API can rate-limit anonymous visitors per IP instead of per proxy.
 */
export function proxiedApiHeaders(incoming: Headers, secret: string | undefined): Headers {
  const headers = new Headers(incoming);
  headers.delete(PROXY_IP_HEADER);
  headers.delete(PROXY_AUTH_HEADER);
  const ip = incoming.get("x-real-ip")?.trim() || incoming.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
  if (secret && ip) {
    headers.set(PROXY_IP_HEADER, ip);
    headers.set(PROXY_AUTH_HEADER, secret);
  }
  return headers;
}

export function resolveApiUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.VERCEL && !env.API_URL?.trim()) {
    // Fail the build instead of silently proxying /api to localhost (every API call would 404 in production).
    throw new Error(
      `API_URL is not set for this Vercel environment (${env.VERCEL_ENV ?? "unknown"}): set it in the web project.`,
    );
  }
  const template = (env.API_URL || "http://localhost:3000").trim().replace(/\/+$/, "");
  if (!template.includes("{branch}")) return template;
  const branch = (env.VERCEL_GIT_COMMIT_REF ?? "main")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return template.replaceAll("{branch}", branch);
}
