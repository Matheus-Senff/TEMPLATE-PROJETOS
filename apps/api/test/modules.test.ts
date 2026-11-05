import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("optional modules disabled (default test env)", () => {
  it("sendEmail only logs without RESEND_API_KEY", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { sendEmail } = await import("../src/services/email.service.js");
    await expect(sendEmail({ to: "a@b.com", subject: "Oi", html: "<p>oi</p>" })).resolves.toEqual({ id: null });
    expect(info).toHaveBeenCalledWith(expect.stringContaining("[email:disabled]"));
  });

  it("enqueue runs the job inline without QStash", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { enqueue } = await import("../src/services/jobs.service.js");
    await expect(enqueue("send-welcome-email", { userId: "u1", email: "a@b.com", name: "Ana" })).resolves.toEqual({
      messageId: null,
      inline: true,
    });
  });

  it("enqueue validates the payload with zod", async () => {
    const { runJob } = await import("../src/services/jobs.service.js");
    await expect(runJob("send-welcome-email", { userId: "u1", email: "not-an-email", name: null })).rejects.toThrow();
  });

  it("cached() calls the loader every time without Redis", async () => {
    const { cached } = await import("../src/services/cache.service.js");
    const load = vi.fn(async () => 42);
    await cached("k", 60, load);
    await cached("k", 60, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("trackEvent is a no-op without PostHog", async () => {
    const { trackEvent } = await import("../src/services/analytics.service.js");
    await expect(trackEvent("u1", "test_event")).resolves.toBeUndefined();
  });

  it("createAblyJwt throws 503 without ABLY_API_KEY", async () => {
    const { createAblyJwt } = await import("../src/services/realtime.service.js");
    expect(() => createAblyJwt("u1")).toThrow("Tempo real desativado");
  });
});

describe("Ably enabled", () => {
  it("signs a JWT with the key name, client id and capabilities", async () => {
    vi.stubEnv("ABLY_API_KEY", "appX.keyY:supersecret");
    const { createAblyJwt } = await import("../src/services/realtime.service.js");

    const token = createAblyJwt("user_1");
    const [header, payload, signature] = token.split(".") as [string, string, string];
    const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString());

    expect(decode(header)).toMatchObject({ alg: "HS256", kid: "appX.keyY" });
    const claims = decode(payload);
    expect(claims["x-ably-clientId"]).toBe("user_1");
    expect(JSON.parse(claims["x-ably-capability"])).toHaveProperty("user:user_1");
    expect(claims.exp - claims.iat).toBe(3600);
    expect(signature).toBe(createHmac("sha256", "supersecret").update(`${header}.${payload}`).digest("base64url"));
  });
});

describe("env validation", () => {
  it("rejects a half-configured Upstash Redis", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    await expect(import("../src/config/env.js")).rejects.toThrow("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN");
  });

  it("rejects an invalid Stripe key", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "not-a-key");
    await expect(import("../src/config/env.js")).rejects.toThrow("STRIPE_SECRET_KEY");
  });
});
