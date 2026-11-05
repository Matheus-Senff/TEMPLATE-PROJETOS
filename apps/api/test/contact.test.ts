import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.doUnmock("../src/services/jobs.service.js");
});

const valid = {
  name: "Ana Souza",
  email: "ANA@Exemplo.com ",
  phone: "(11) 99999-0000",
  message: "Quero um orçamento.",
};

describe("contact form", () => {
  it("normalizes e-mail and rejects short messages", async () => {
    const { contactSchema } = await import("../src/modules/contact/contact.schemas.js");
    expect(contactSchema.parse(valid).email).toBe("ana@exemplo.com");
    expect(contactSchema.safeParse({ ...valid, message: "oi" }).success).toBe(false);
  });

  it("queues the message and answers 202", async () => {
    const enqueue = vi.fn(async () => ({ messageId: null, inline: true }));
    vi.doMock("../src/services/jobs.service.js", () => ({ enqueue }));
    const { contactRoutes } = await import("../src/modules/contact/contact.routes.js");
    const res = await contactRoutes.request("/", {
      method: "POST",
      body: JSON.stringify(valid),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(202);
    expect(enqueue).toHaveBeenCalledWith(
      "send-contact-email",
      expect.objectContaining({ email: "ana@exemplo.com" }),
      expect.anything(),
    );
  });

  it("silently drops bots that fill the honeypot", async () => {
    const enqueue = vi.fn();
    vi.doMock("../src/services/jobs.service.js", () => ({ enqueue }));
    const { contactRoutes } = await import("../src/modules/contact/contact.routes.js");
    const res = await contactRoutes.request("/", {
      method: "POST",
      body: JSON.stringify({ ...valid, website: "spam" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(202);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("Turnstile (bot check)", () => {
  const siteverify = (result: Record<string, unknown> | Error) =>
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      if (result instanceof Error) throw result;
      return new Response(JSON.stringify(result));
    });

  const setup = async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000AA");
    vi.stubEnv("APP_URL", "https://app.example.com");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const enqueue = vi.fn(async () => ({ messageId: null, inline: true }));
    vi.doMock("../src/services/jobs.service.js", () => ({ enqueue }));
    const { contactRoutes } = await import("../src/modules/contact/contact.routes.js");
    const { errorHandler } = await import("../src/middlewares/error-handler.js");
    contactRoutes.onError(errorHandler);
    const send = (body: Record<string, unknown>) =>
      contactRoutes.request("/", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      });
    return { send, enqueue };
  };

  afterEach(() => vi.unstubAllEnvs());

  it("requires a token when enabled", async () => {
    const { send, enqueue } = await setup();
    const res = await send(valid);
    expect(res.status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("accepts a valid token for the right hostname and action, and never forwards the token", async () => {
    const { send, enqueue } = await setup();
    const fetch = siteverify({ success: true, hostname: "app.example.com", action: "contact" });
    const res = await send({ ...valid, turnstileToken: "tok" });
    expect(res.status).toBe(202);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect((init?.body as URLSearchParams).get("response")).toBe("tok");
    expect(enqueue).toHaveBeenCalledWith(
      "send-contact-email",
      expect.not.objectContaining({ turnstileToken: expect.anything() }),
      expect.anything(),
    );
  });

  it.each([
    ["failed challenge", { success: false, "error-codes": ["invalid-input-response"] }],
    ["token solved on another site", { success: true, hostname: "evil.example.net", action: "contact" }],
    ["token from another form", { success: true, hostname: "app.example.com", action: "signup" }],
  ])("rejects a %s", async (_name, result) => {
    const { send, enqueue } = await setup();
    siteverify(result);
    expect((await send({ ...valid, turnstileToken: "tok" })).status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("fails closed (503) when Cloudflare cannot be reached", async () => {
    const { send } = await setup();
    siteverify(new Error("network down"));
    expect((await send({ ...valid, turnstileToken: "tok" })).status).toBe(503);
  });

  it("accepts subdomains of an allowed hostname (e.g. preview deployments)", async () => {
    vi.stubEnv("TURNSTILE_ALLOWED_HOSTNAMES", "example.com,vercel.app");
    const { send } = await setup();
    siteverify({ success: true, hostname: "web-git-feature-team.vercel.app", action: "contact" });
    expect((await send({ ...valid, turnstileToken: "tok" })).status).toBe(202);
  });
});

describe("tenant scope", () => {
  it("requires an orgId", async () => {
    const { byTenant } = await import("../src/lib/tenant.js");
    const table = { orgId: {} as never };
    expect(() => byTenant(table, "")).toThrow("orgId is required");
  });
});
