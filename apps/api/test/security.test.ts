import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type * as ClerkConfig from "../src/config/clerk.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
  vi.doUnmock("../src/db/index.js");
  vi.doUnmock("../src/services/notification.service.js");
  vi.doUnmock("../src/services/audit.service.js");
});

describe("upload validation", () => {
  it("accepts allowlisted types, normalizing parameters and case", async () => {
    const { presignBody } = await import("../src/routes/uploads.js");
    const parsed = presignBody.parse({ fileName: "a.png", contentType: "IMAGE/PNG; charset=binary", size: 10 });
    expect(parsed.contentType).toBe("image/png");
  });

  it.each(["text/html", "image/svg+xml", "application/javascript"])("rejects %s", async (contentType) => {
    const { presignBody } = await import("../src/routes/uploads.js");
    expect(presignBody.safeParse({ fileName: "x", contentType, size: 10 }).success).toBe(false);
  });

  it("requires a size within UPLOAD_MAX_BYTES", async () => {
    vi.stubEnv("UPLOAD_MAX_BYTES", "100");
    const { presignBody } = await import("../src/routes/uploads.js");
    expect(presignBody.safeParse({ fileName: "a.pdf", contentType: "application/pdf" }).success).toBe(false);
    expect(presignBody.safeParse({ fileName: "a.pdf", contentType: "application/pdf", size: 101 }).success).toBe(false);
    expect(presignBody.safeParse({ fileName: "a.pdf", contentType: "application/pdf", size: 100 }).success).toBe(true);
  });

  it("signs content-length into the upload URL", async () => {
    const { createPresignedUpload } = await import("../src/services/storage.service.js");
    const upload = await createPresignedUpload({
      prefix: "u",
      fileName: "a.pdf",
      contentType: "application/pdf",
      contentLength: 42,
    });
    expect(new URL(upload.uploadUrl).searchParams.get("X-Amz-SignedHeaders")).toContain("content-length");
  });
});

describe("validate()", () => {
  it("answers 400 with a readable error message", async () => {
    const { validate } = await import("../src/middlewares/validate.js");
    const app = new Hono().post("/", validate("json", z.object({ age: z.number() })), (c) => c.json({ ok: true }));
    const res = await app.request("/", {
      method: "POST",
      body: JSON.stringify({ age: "x" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toMatch(/^age: /);
    expect(body.issues).toHaveLength(1);
  });
});

describe("client IP", () => {
  const ipApp = async () => {
    const { clientIp } = await import("../src/middlewares/rate-limit.js");
    return new Hono().get("/", (c) => c.text(clientIp(c)));
  };

  it("on Vercel, trusts x-real-ip and ignores spoofable cf-connecting-ip", async () => {
    vi.stubEnv("VERCEL", "1");
    const app = await ipApp();
    const res = await app.request("/", { headers: { "cf-connecting-ip": "6.6.6.6", "x-real-ip": "1.1.1.1" } });
    expect(await res.text()).toBe("1.1.1.1");
  });

  it("self-hosted (no VERCEL), ignores forwarded headers any client can send", async () => {
    vi.stubEnv("VERCEL", "");
    const app = await ipApp();
    const res = await app.request("/", { headers: { "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2, 3.3.3.3" } });
    // app.request() has no socket; with @hono/node-server this is the real peer address.
    expect(await res.text()).toBe("unknown");
  });

  it("self-hosted, reads the socket address from @hono/node-server", async () => {
    vi.stubEnv("VERCEL", "");
    const app = await ipApp();
    const env = { incoming: { socket: { remoteAddress: "9.9.9.9", remotePort: 1234, remoteFamily: "IPv4" } } };
    const res = await app.request("/", { headers: { "x-real-ip": "1.1.1.1" } }, env);
    expect(await res.text()).toBe("9.9.9.9");
  });

  it("uses the header named in CLIENT_IP_HEADER", async () => {
    vi.stubEnv("CLIENT_IP_HEADER", "CF-Connecting-IP");
    const app = await ipApp();
    const res = await app.request("/", { headers: { "cf-connecting-ip": "2.2.2.2", "x-real-ip": "1.1.1.1" } });
    expect(await res.text()).toBe("2.2.2.2");
  });
});

describe("CORS and Clerk origins", () => {
  it("refuses CORS_ORIGINS=* in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CORS_ORIGINS", "*");
    await expect(import("../src/config/env.js")).rejects.toThrow("CORS_ORIGINS cannot be *");
  });

  it("authorizedParties lists APP_URL and CORS origins without * or trailing slash", async () => {
    vi.stubEnv("APP_URL", "https://app.example.com/");
    vi.stubEnv("CORS_ORIGINS", "https://app.example.com,https://admin.example.com,*");
    const { authorizedParties } = await import("../src/middlewares/auth.js");
    expect(authorizedParties()).toEqual(["https://app.example.com", "https://admin.example.com"]);
  });
});

describe("production safety checks (env.ts)", () => {
  const production = () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CORS_ORIGINS", "https://app.example.com");
  };

  it("refuses to start without Upstash Redis (rate limiting would silently disappear)", async () => {
    production();
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    await expect(import("../src/config/env.js")).rejects.toThrow("Rate limiting needs Upstash Redis");
  });

  it("refuses to start without Turnstile on public forms", async () => {
    production();
    vi.stubEnv("RATE_LIMIT_DISABLED", "true");
    await expect(import("../src/config/env.js")).rejects.toThrow("TURNSTILE_SECRET_KEY is required");
  });

  it("starts when both are configured or explicitly disabled", async () => {
    production();
    vi.stubEnv("RATE_LIMIT_DISABLED", "true");
    vi.stubEnv("TURNSTILE_DISABLED", "true");
    await expect(import("../src/config/env.js")).resolves.toBeDefined();
    vi.resetModules();
    vi.stubEnv("RATE_LIMIT_DISABLED", "");
    vi.stubEnv("TURNSTILE_DISABLED", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    await expect(import("../src/config/env.js")).resolves.toBeDefined();
  });

  it("warns loudly in development when rate limiting is off", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await import("../src/config/env.js");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("RATE LIMITING IS OFF"));
  });
});

describe("reverification for irreversible actions", () => {
  const setup = async (reverified: boolean) => {
    const deleteUser = vi.fn(async () => ({}));
    vi.doMock("../src/config/clerk.js", async (importOriginal) => ({
      ...(await importOriginal<typeof ClerkConfig>()),
      clerkClient: { users: { deleteUser, updateUserMetadata: vi.fn(async () => ({})) } },
    }));
    vi.doMock("../src/services/audit.service.js", () => ({ audit: vi.fn(async () => {}) }));
    const enqueue = vi.fn(async () => ({ messageId: null, inline: true }));
    vi.doMock("../src/services/jobs.service.js", () => ({ enqueue }));
    vi.doMock("../src/services/user.service.js", () => ({ ensureUser: async () => {}, exportUserData: vi.fn() }));
    const { appWith } = await import("./helpers/auth.js");
    const { meRoutes } = await import("../src/routes/me.js");
    const { adminRoutes } = await import("../src/modules/admin/admin.routes.js");
    const admin = { metadata: { role: "admin" } };
    return {
      deleteUser,
      enqueue,
      me: appWith("/me", meRoutes, { userId: "user_1", reverified }),
      admin: appWith("/admin", adminRoutes, { userId: "admin_1", reverified, claims: admin }),
    };
  };

  afterEach(() => {
    vi.doUnmock("../src/config/clerk.js");
    vi.doUnmock("../src/services/jobs.service.js");
    vi.doUnmock("../src/services/user.service.js");
  });

  it("DELETE /me answers Clerk's reverification hint (403) without a recent re-authentication", async () => {
    const { me, deleteUser } = await setup(false);
    const res = await me.request("/me", { method: "DELETE" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ clerk_error: { type: "forbidden", reason: "reverification-error" } });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("DELETE /me proceeds after reverification: enqueues the erasure, which deletes the Clerk user last", async () => {
    const { me, deleteUser, enqueue } = await setup(true);
    const res = await me.request("/me", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(enqueue).toHaveBeenCalledWith("delete-user-data", { userId: "user_1" }, expect.anything());
    // Not deleted up front: if the erasure fails, the user can still sign in and retry.
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("admin role change requires reverification too", async () => {
    const { admin } = await setup(false);
    const res = await admin.request("/admin/users/user_2/role", {
      method: "POST",
      body: JSON.stringify({ role: "admin" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ clerk_error: { reason: "reverification-error" } });
  });
});

describe("Stripe in production", () => {
  it("requires STRIPE_PRICE_IDS", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CORS_ORIGINS", "https://app.example.com");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    await expect(import("../src/config/env.js")).rejects.toThrow("STRIPE_PRICE_IDS is required");
  });
});

describe("Stripe price allowlist", () => {
  it("accepts any price when the list is empty and only listed prices otherwise", async () => {
    const { assertPriceAllowed } = await import("../src/services/billing.service.js");
    expect(() => assertPriceAllowed("price_any", [])).not.toThrow();
    expect(() => assertPriceAllowed("price_ok", ["price_ok"])).not.toThrow();
    expect(() => assertPriceAllowed("price_cheap", ["price_ok"])).toThrow("Plano não disponível");
  });
});

describe("Stripe webhook idempotency", () => {
  const event = { id: "evt_1", type: "invoice.payment_failed", data: { object: { id: "in_1" } } };

  const mockDb = (claimed: boolean) => {
    const deleted = vi.fn();
    vi.doMock("../src/db/index.js", () => ({
      db: {
        insert: () => ({
          values: () => ({
            onConflictDoNothing: () => ({ returning: async () => (claimed ? [{ id: event.id }] : []) }),
          }),
        }),
        delete: () => ({ where: deleted }),
        update: () => ({
          set: () => ({ where: () => Object.assign(Promise.resolve(), { returning: async () => [] }) }),
        }),
      },
    }));
    return deleted;
  };

  it("handles a new event once", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockDb(true);
    const { processStripeEvent } = await import("../src/services/billing.service.js");
    await expect(processStripeEvent(event as never)).resolves.toEqual({ duplicate: false });
  });

  it("skips an event that was already processed", async () => {
    mockDb(false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { processStripeEvent } = await import("../src/services/billing.service.js");
    await expect(processStripeEvent(event as never)).resolves.toEqual({ duplicate: true });
    expect(warn).not.toHaveBeenCalled();
  });

  it("releases the claim when the handler fails, so Stripe can retry", async () => {
    const deleted = mockDb(true);
    vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("boom");
    });
    const { processStripeEvent } = await import("../src/services/billing.service.js");
    await expect(processStripeEvent(event as never)).rejects.toThrow("boom");
    expect(deleted).toHaveBeenCalledOnce();
  });
});
