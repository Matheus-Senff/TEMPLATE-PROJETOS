import { afterEach, describe, expect, it, vi } from "vitest";
// Build-time helpers of apps/web (pure functions, no Next runtime needed): tested here with the API suite.
import { proxiedApiHeaders, resolveApiUrl } from "../../web/api-proxy";
import { buildCsp, clerkFrontendApi } from "../../web/csp";

const PK = "pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk"; // base64("example.clerk.accounts.dev$")

const directives = (csp: string) =>
  Object.fromEntries(
    csp.split("; ").map((part) => {
      const [name, ...values] = part.split(" ");
      return [name, values];
    }),
  ) as Record<string, string[]>;

describe("CSP (apps/web/csp.ts)", () => {
  it("decodes Clerk's Frontend API host from the publishable key", () => {
    expect(clerkFrontendApi(PK)).toBe("https://example.clerk.accounts.dev");
    expect(clerkFrontendApi(undefined)).toBeNull();
    expect(clerkFrontendApi("pk_test_%%%")).toBeNull();
  });

  it("production policy: strict allowlists, no eval, no framing, upgrade to https", () => {
    const csp = directives(buildCsp({ NODE_ENV: "production", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: PK }));
    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["script-src"]).toEqual([
      "'self'",
      "'unsafe-inline'",
      "https://example.clerk.accounts.dev",
      "https://challenges.cloudflare.com",
    ]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
    expect(csp["connect-src"]).toContain("https://example.clerk.accounts.dev");
    expect(csp["connect-src"]).toContain("wss://*.ably.io");
    expect(csp["connect-src"]).not.toContain("ws:");
    expect(csp["upgrade-insecure-requests"]).toEqual([]);
  });

  it("allows only the configured R2 bucket, direct API origin, public media and Sentry CDN when set", () => {
    const csp = directives(
      buildCsp({
        NODE_ENV: "production",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: PK,
        R2_UPLOAD_ORIGIN: "https://bucket.acc.r2.cloudflarestorage.com",
        R2_PUBLIC_URL: "https://files.example.com/public",
        NEXT_PUBLIC_API_URL: "https://api.example.com/v1",
        NEXT_PUBLIC_SENTRY_DSN: "https://abc@o1.ingest.sentry.io/1",
      }),
    );
    expect(csp["connect-src"]).toContain("https://bucket.acc.r2.cloudflarestorage.com");
    expect(csp["connect-src"]).not.toContain("https://*.r2.cloudflarestorage.com");
    expect(csp["connect-src"]).toContain("https://api.example.com");
    expect(csp["img-src"]).toContain("https://files.example.com");
    expect(csp["script-src"]).toContain("https://browser.sentry-cdn.com");
  });

  it("development relaxes eval and websockets for hot reload", () => {
    const csp = directives(buildCsp({ NODE_ENV: "development", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: PK }));
    expect(csp["script-src"]).toContain("'unsafe-eval'");
    expect(csp["connect-src"]).toContain("ws:");
    expect(csp["upgrade-insecure-requests"]).toBeUndefined();
  });
});

describe("same-origin API proxy (apps/web/api-proxy.ts)", () => {
  it("defaults to the local API and trims trailing slashes", () => {
    expect(resolveApiUrl({})).toBe("http://localhost:3000");
    expect(resolveApiUrl({ API_URL: "" })).toBe("http://localhost:3000"); // empty line copied from .env.example
    expect(resolveApiUrl({ API_URL: "https://api.example.com/" })).toBe("https://api.example.com");
  });

  it("fails the build on Vercel when API_URL is missing (no silent proxy to localhost)", () => {
    expect(() => resolveApiUrl({ VERCEL: "1", VERCEL_ENV: "production" })).toThrow("API_URL is not set");
    expect(() => resolveApiUrl({ VERCEL: "1", API_URL: " " })).toThrow("API_URL is not set");
    expect(resolveApiUrl({ VERCEL: "1", API_URL: "https://api.example.com" })).toBe("https://api.example.com");
  });

  it("points a preview at the API preview of the same branch", () => {
    expect(
      resolveApiUrl({
        API_URL: "https://myapp-api-git-{branch}-team.vercel.app",
        VERCEL_GIT_COMMIT_REF: "feature/Novo_Login",
      }),
    ).toBe("https://myapp-api-git-feature-novo-login-team.vercel.app");
  });
});

describe("visitor IP through the /api proxy (API_PROXY_SECRET)", () => {
  const SECRET = "proxy-secret-0123456789";

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("the web drops spoofed proxy headers and signs the visitor IP only with the secret", () => {
    const incoming = new Headers({
      "x-real-ip": "203.0.113.7",
      "x-app-client-ip": "6.6.6.6",
      "x-app-proxy-auth": "guess",
      authorization: "Bearer t",
    });
    const signed = proxiedApiHeaders(incoming, SECRET);
    expect(signed.get("x-app-client-ip")).toBe("203.0.113.7");
    expect(signed.get("x-app-proxy-auth")).toBe(SECRET);
    expect(signed.get("authorization")).toBe("Bearer t");
    const unsigned = proxiedApiHeaders(incoming, undefined);
    expect(unsigned.get("x-app-client-ip")).toBeNull();
    expect(unsigned.get("x-app-proxy-auth")).toBeNull();
  });

  const ipApp = async () => {
    const { Hono } = await import("hono");
    const { clientIp } = await import("../src/middlewares/rate-limit.js");
    return new Hono().get("/", (c) => c.text(clientIp(c)));
  };
  const call = async (headers: Record<string, string>) => (await (await ipApp()).request("/", { headers })).text();

  it("the API trusts x-app-client-ip only with the matching secret", async () => {
    vi.stubEnv("API_PROXY_SECRET", SECRET);
    vi.stubEnv("VERCEL", "1");
    const base = { "x-real-ip": "198.51.100.1", "x-app-client-ip": "203.0.113.7" };
    expect(await call({ ...base, "x-app-proxy-auth": SECRET })).toBe("203.0.113.7");
    expect(await call({ ...base, "x-app-proxy-auth": "wrong-secret-000000000" })).toBe("198.51.100.1");
    expect(await call(base)).toBe("198.51.100.1");
    expect(await call({ ...base, "x-app-client-ip": "<script>", "x-app-proxy-auth": SECRET })).toBe("198.51.100.1");
  });

  it("without API_PROXY_SECRET configured the header is ignored, and LOG_LEVEL=debug logs the source", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("LOG_LEVEL", "debug");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(
      await call({ "x-real-ip": "198.51.100.1", "x-app-client-ip": "203.0.113.7", "x-app-proxy-auth": SECRET }),
    ).toBe("198.51.100.1");
    expect(info).toHaveBeenCalledWith("[client-ip] 198.51.100.1 (source: vercel)");
  });
});

describe("authorized parties for preview deployments (API)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("accepts exact origins and, when configured, origins matching AUTHORIZED_PARTY_PATTERN", async () => {
    vi.stubEnv("APP_URL", "https://app.example.com");
    vi.stubEnv("AUTHORIZED_PARTY_PATTERN", "^https://myapp-web-[a-z0-9-]+-team\\.vercel\\.app$");
    const { isAuthorizedParty } = await import("../src/middlewares/auth.js");
    expect(isAuthorizedParty("https://app.example.com")).toBe(true);
    expect(isAuthorizedParty("https://myapp-web-git-feature-team.vercel.app")).toBe(true);
    expect(isAuthorizedParty("https://evil.example.net")).toBe(false);
    expect(isAuthorizedParty("https://myapp-web-x-team.vercel.app.evil.net")).toBe(false);
  });

  it("requireAuth rejects a token minted for another origin", async () => {
    vi.stubEnv("AUTHORIZED_PARTY_PATTERN", "^https://myapp-web-[a-z0-9-]+-team\\.vercel\\.app$");
    vi.doMock("../src/services/user.service.js", () => ({ ensureUser: async () => {} }));
    const { Hono } = await import("hono");
    const { requireAuth } = await import("../src/middlewares/auth.js");
    const { appWith } = await import("./helpers/auth.js");
    const routes = new Hono().get("/", requireAuth, (c) => c.json({ ok: true }));
    const evil = appWith("/x", routes, { userId: "u1", claims: { azp: "https://evil.example.net" } });
    const preview = appWith("/x", routes, { userId: "u1", claims: { azp: "https://myapp-web-git-a-team.vercel.app" } });
    expect((await evil.request("/x")).status).toBe(401);
    expect((await preview.request("/x")).status).toBe(200);
    vi.doUnmock("../src/services/user.service.js");
  });

  it("refuses an unanchored pattern", async () => {
    vi.stubEnv("AUTHORIZED_PARTY_PATTERN", "vercel\\.app");
    await expect(import("../src/config/env.js")).rejects.toThrow("anchored");
  });
});
