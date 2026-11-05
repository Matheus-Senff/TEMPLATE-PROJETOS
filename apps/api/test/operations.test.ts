import { createHash, createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appWith } from "./helpers/auth.js";
import { createTestDb } from "./helpers/pglite.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("migrations in the Vercel build (scripts/migrate.ts)", () => {
  const prodHost = "ep-prod-123.sa-east-1.aws.neon.tech";
  const pooled = `postgresql://u:p@ep-prod-123-pooler.sa-east-1.aws.neon.tech/db?sslmode=require`;

  it("production uses the direct (unpooled) URL", async () => {
    const { resolveTarget } = await import("../src/scripts/migrate.js");
    expect(resolveTarget({ VERCEL_ENV: "production", DATABASE_URL_UNPOOLED: "postgresql://u:p@direct/db" })).toEqual({
      url: "postgresql://u:p@direct/db",
      reason: "production build",
    });
    const derived = resolveTarget({ VERCEL_ENV: "production", DATABASE_URL: pooled });
    expect("url" in derived && new URL(derived.url).hostname).toBe(prodHost);
  });

  it("production fails the build when the URL is missing or is not PRODUCTION_DATABASE_HOST", async () => {
    const { resolveTarget } = await import("../src/scripts/migrate.js");
    expect(() => resolveTarget({ VERCEL_ENV: "production" })).toThrow("cannot migrate");
    expect(() =>
      resolveTarget({
        VERCEL_ENV: "production",
        PRODUCTION_DATABASE_HOST: prodHost,
        DATABASE_URL_UNPOOLED: "postgresql://u:p@ep-dev-9.sa-east-1.aws.neon.tech/db",
      }),
    ).toThrow("not PRODUCTION_DATABASE_HOST");
  });

  it("a preview never migrates production, and only migrates its own branch when explicitly enabled", async () => {
    const { resolveTarget } = await import("../src/scripts/migrate.js");
    const branchUrl = "postgresql://u:p@ep-preview-7.sa-east-1.aws.neon.tech/db";
    expect(resolveTarget({ VERCEL_ENV: "preview", DATABASE_URL: pooled })).toHaveProperty("skip");
    expect(resolveTarget({ VERCEL_ENV: "preview", MIGRATE_PREVIEW: "true", DATABASE_URL: branchUrl })).toHaveProperty(
      "skip",
    );
    expect(() =>
      resolveTarget({
        VERCEL_ENV: "preview",
        MIGRATE_PREVIEW: "true",
        PRODUCTION_DATABASE_HOST: prodHost,
        DATABASE_URL: pooled,
      }),
    ).toThrow("PRODUCTION database");
    expect(
      resolveTarget({
        VERCEL_ENV: "preview",
        MIGRATE_PREVIEW: "true",
        PRODUCTION_DATABASE_HOST: prodHost,
        DATABASE_URL_UNPOOLED: branchUrl,
      }),
    ).toEqual({ url: branchUrl, reason: "preview branch database" });
  });

  it("local and CI builds skip unless MIGRATE_DATABASE_URL is given", async () => {
    const { resolveTarget } = await import("../src/scripts/migrate.js");
    expect(resolveTarget({ DATABASE_URL: pooled })).toHaveProperty("skip");
    expect(resolveTarget({ MIGRATE_DATABASE_URL: "postgres://localhost/ci" })).toEqual({
      url: "postgres://localhost/ci",
      reason: "MIGRATE_DATABASE_URL",
    });
  });
});

describe("migration lock (pg_advisory_lock on a dedicated connection)", () => {
  /** In-memory stand-in for Postgres advisory locks: a second locker waits until the first unlocks. */
  function fakeServer() {
    const log: string[] = [];
    let held: Promise<void> | null = null;
    let release: (() => void) | null = null;
    const connect = async () => ({
      query: async (sql: string) => {
        if (sql.includes("pg_advisory_lock(")) {
          while (held) await held;
          held = new Promise<void>((resolve) => (release = resolve));
          log.push("lock");
        } else if (sql.includes("pg_advisory_unlock(")) {
          log.push("unlock");
          const done = release;
          held = null;
          done?.();
        }
      },
      release: () => log.push("release"),
    });
    return { connect, log };
  }

  it("locks, migrates, unlocks and releases, even when the migration fails", async () => {
    const { withMigrationLock } = await import("../src/scripts/migrate.js");
    const { connect, log } = fakeServer();
    await withMigrationLock(connect, async () => void log.push("migrate"));
    await expect(withMigrationLock(connect, async () => Promise.reject(new Error("bad migration")))).rejects.toThrow(
      "bad migration",
    );
    expect(log).toEqual(["lock", "migrate", "unlock", "release", "lock", "unlock", "release"]);
  });

  it("two concurrent deploys run their migrations one after the other", async () => {
    const { withMigrationLock } = await import("../src/scripts/migrate.js");
    const { connect, log } = fakeServer();
    const migrate = (name: string) => async () => {
      log.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      log.push(`${name}:end`);
    };
    await Promise.all([withMigrationLock(connect, migrate("a")), withMigrationLock(connect, migrate("b"))]);
    const order = log.filter((entry) => entry.includes(":"));
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });
});

describe("preview deployments never use the production database", () => {
  it("refuses to start a preview whose DATABASE_URL is the production endpoint", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("PRODUCTION_DATABASE_HOST", "ep-test.us-east-2.aws.neon.tech");
    await expect(import("../src/config/env.js")).rejects.toThrow("PRODUCTION database");
    vi.resetModules();
    vi.stubEnv("PRODUCTION_DATABASE_HOST", "ep-prod.sa-east-1.aws.neon.tech");
    await expect(import("../src/config/env.js")).resolves.toBeDefined();
  });
});

describe("leaving Clerk: user ids can be remapped in one UPDATE (ON UPDATE CASCADE)", () => {
  it("cascades the new id to files, notifications, billing customers and subscriptions", async () => {
    const testDb = await createTestDb();
    const schema = await import("../src/db/schema.js");
    const { db } = testDb;
    await db.insert(schema.users).values({ id: "user_clerk_1" });
    await db.insert(schema.files).values({ ownerId: "user_clerk_1", key: "k", contentType: "x" });
    await db.insert(schema.notifications).values({ userId: "user_clerk_1", title: "t" });
    await db.insert(schema.billingCustomers).values({ stripeCustomerId: "cus_1", userId: "user_clerk_1" });
    await db
      .insert(schema.subscriptions)
      .values({ id: "sub_1", userId: "user_clerk_1", stripeCustomerId: "cus_1", status: "active" });

    await db.update(schema.users).set({ id: "new_provider_1" }).where(eq(schema.users.id, "user_clerk_1"));

    expect((await db.query.files.findFirst())?.ownerId).toBe("new_provider_1");
    expect((await db.query.notifications.findFirst())?.userId).toBe("new_provider_1");
    expect((await db.query.billingCustomers.findFirst())?.userId).toBe("new_provider_1");
    expect((await db.query.subscriptions.findFirst())?.userId).toBe("new_provider_1");
    await testDb.close();
  });
});

describe("QStash callbacks (/jobs/:name)", () => {
  const CURRENT = "sig_current_key_123";
  const NEXT = "sig_next_key_456";
  const API = "https://api.example.com";

  /** Same JWT QStash sends in `Upstash-Signature` (HS256, iss Upstash, sub = URL, body = sha256). */
  function qstashSignature(url: string, body: string, key = CURRENT): string {
    const b64 = (value: string | Buffer) => Buffer.from(value).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = b64(
      JSON.stringify({
        iss: "Upstash",
        sub: url,
        iat: now,
        nbf: now,
        exp: now + 300,
        jti: "msg_1",
        body: createHash("sha256").update(body).digest("base64url"),
      }),
    );
    const signature = createHmac("sha256", key).update(`${header}.${payload}`).digest("base64url");
    return `${header}.${payload}.${signature}`;
  }

  const setup = async () => {
    vi.stubEnv("QSTASH_TOKEN", "token");
    vi.stubEnv("QSTASH_CURRENT_SIGNING_KEY", CURRENT);
    vi.stubEnv("QSTASH_NEXT_SIGNING_KEY", NEXT);
    vi.stubEnv("API_PUBLIC_URL", API);
    const runJob = vi.fn(async () => {});
    vi.doMock("../src/services/jobs.service.js", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      runJob,
    }));
    const { jobsRoutes } = await import("../src/routes/jobs.js");
    const { errorHandler } = await import("../src/middlewares/error-handler.js");
    const app = new Hono().route("/jobs", jobsRoutes);
    app.onError(errorHandler);
    vi.doUnmock("../src/services/jobs.service.js");
    const call = (body: string, signature?: string) =>
      app.request("/jobs/cleanup-old-records", {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json", ...(signature && { "Upstash-Signature": signature }) },
      });
    return { call, runJob };
  };

  it("runs the job only with a valid signature for this URL and body", async () => {
    const { call, runJob } = await setup();
    const url = `${API}/jobs/cleanup-old-records`;
    expect((await call("{}", qstashSignature(url, "{}"))).status).toBe(200);
    expect(runJob).toHaveBeenCalledWith("cleanup-old-records", {});
    // The next key works too (key rotation).
    expect((await call("{}", qstashSignature(url, "{}", NEXT))).status).toBe(200);
  });

  it.each([
    ["missing signature", undefined],
    ["wrong key", "wrong"],
    ["another URL", "other-url"],
    ["tampered body", "tampered"],
  ])("rejects a %s with 401", async (_name, kind) => {
    const { call, runJob } = await setup();
    const url = `${API}/jobs/cleanup-old-records`;
    const signature =
      kind === "wrong"
        ? qstashSignature(url, "{}", "attacker")
        : kind === "other-url"
          ? qstashSignature(`${API}/jobs/delete-user-data`, "{}")
          : kind === "tampered"
            ? qstashSignature(url, '{"x":1}')
            : undefined;
    expect((await call("{}", signature)).status).toBe(401);
    expect(runJob).not.toHaveBeenCalled();
  });
});

describe("rate limiting (Upstash mocked in memory)", () => {
  const setup = async (options: { failing?: boolean } = {}) => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
    const counts = new Map<string, number>();
    vi.doMock("@upstash/ratelimit", () => ({
      Ratelimit: class {
        static slidingWindow = (limit: number) => ({ limit });
        private readonly max: number;
        private readonly prefix: string;
        constructor(config: { limiter: { limit: number }; prefix: string }) {
          this.max = config.limiter.limit;
          this.prefix = config.prefix;
        }
        async limit(key: string) {
          if (options.failing) throw new Error("redis down");
          const id = `${this.prefix}:${key}`;
          const used = (counts.get(id) ?? 0) + 1;
          counts.set(id, used);
          return { success: used <= this.max, limit: this.max, remaining: this.max - used, reset: Date.now() + 60_000 };
        }
      },
    }));
    const { rateLimit } = await import("../src/middlewares/rate-limit.js");
    const { errorHandler } = await import("../src/middlewares/error-handler.js");
    const routes = new Hono().get("/", rateLimit({ prefix: "test", limit: 2, window: "1 m" }), (c) => c.text("ok"));
    vi.doUnmock("@upstash/ratelimit");
    const asUser = (userId: string | null) => {
      const app = appWith("/r", routes, { userId });
      app.onError(errorHandler);
      return app;
    };
    return { asUser, counts };
  };

  it("answers 429 with RateLimit headers after the limit, per user", async () => {
    const { asUser } = await setup();
    const alice = asUser("u_alice");
    expect((await alice.request("/r")).status).toBe(200);
    const second = await alice.request("/r");
    expect(second.headers.get("RateLimit-Remaining")).toBe("0");
    const third = await alice.request("/r");
    expect(third.status).toBe(429);
    expect(((await third.json()) as { error: string }).error).toContain("Muitas requisições");
    expect((await asUser("u_bob").request("/r")).status).toBe(200);
  });

  it("keys anonymous requests by IP (on Vercel, from x-real-ip)", async () => {
    vi.stubEnv("VERCEL", "1");
    const { asUser, counts } = await setup();
    await asUser(null).request("/r", { headers: { "x-real-ip": "1.2.3.4" } });
    expect([...counts.keys()]).toEqual(["ratelimit:test:ip:1.2.3.4"]);
  });

  it("fails open when Redis is unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { asUser } = await setup({ failing: true });
    expect((await asUser("u_alice").request("/r")).status).toBe(200);
  });
});

describe("DELETE /me end to end (Postgres real; Clerk, Stripe and R2 mocked)", () => {
  it("deletes the Clerk user, cancels Stripe, batch-deletes R2 objects and erases the rows", async () => {
    const testDb = await createTestDb();
    vi.doMock("../src/db/index.js", () => testDb.module);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    let rowsWhenClerkDeleted = -1;
    const deleteUser = vi.fn(async () => {
      rowsWhenClerkDeleted = (await testDb.db.query.users.findMany()).length;
      return {};
    });
    vi.doMock("../src/config/clerk.js", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      clerkClient: { users: { deleteUser, getUser: vi.fn() } },
    }));
    const schema = await import("../src/db/schema.js");
    const { db } = testDb;
    await db.insert(schema.users).values({ id: "u1", email: "u1@x.com" });
    await db.insert(schema.files).values([
      { ownerId: "u1", key: "users/u1/a.pdf", contentType: "application/pdf", size: 1 },
      { ownerId: "u1", key: "users/u1/b.png", contentType: "image/png", size: 1, status: "pending" },
    ]);
    await db.insert(schema.billingCustomers).values({ stripeCustomerId: "cus_1", userId: "u1" });
    await db
      .insert(schema.subscriptions)
      .values({ id: "sub_1", userId: "u1", stripeCustomerId: "cus_1", status: "active" });

    const stripe = (await (await import("../src/config/stripe.js")).getStripe())!;
    vi.spyOn(stripe.subscriptions, "list").mockReturnValue(
      (async function* () {
        yield { id: "sub_1", status: "active" };
      })() as never,
    );
    const cancel = vi.spyOn(stripe.subscriptions, "cancel").mockResolvedValue({} as never);
    const delCustomer = vi.spyOn(stripe.customers, "del").mockResolvedValue({} as never);
    const r2 = await (await import("../src/config/r2.js")).getR2Client();
    const send = vi.spyOn(r2, "send").mockResolvedValue({ Errors: [] } as never);

    const { meRoutes } = await import("../src/routes/me.js");
    const res = await appWith("/me", meRoutes, { userId: "u1" }).request("/me", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(deleteUser).toHaveBeenCalledWith("u1");
    expect(rowsWhenClerkDeleted).toBe(0); // Clerk account deleted only after the data
    expect(cancel).toHaveBeenCalledWith("sub_1", { prorate: false });
    expect(delCustomer).toHaveBeenCalledWith("cus_1");
    const deleted = send.mock.calls.map(
      ([command]) => (command as { input: { Delete?: { Objects: unknown[] } } }).input,
    );
    expect(deleted).toEqual([
      expect.objectContaining({
        Delete: { Objects: [{ Key: "users/u1/a.pdf" }, { Key: "users/u1/b.png" }], Quiet: true },
      }),
    ]);
    expect(await db.query.users.findMany()).toEqual([]);
    expect(await db.query.files.findMany()).toEqual([]);
    expect(await db.query.subscriptions.findMany()).toEqual([]);
    const logs = await db.query.auditLogs.findMany();
    expect(logs.map((log) => log.action).sort()).toEqual(["user.data_deleted", "user.deletion_requested"]);
    expect(logs.every((log) => log.actorId === null)).toBe(true);
    vi.doUnmock("../src/db/index.js");
    vi.doUnmock("../src/config/clerk.js");
    await testDb.close();
  });
});
