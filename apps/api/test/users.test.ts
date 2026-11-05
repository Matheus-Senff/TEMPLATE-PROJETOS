import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appWith } from "./helpers/auth.js";
import { createTestDb } from "./helpers/pglite.js";

const testDb = await createTestDb();
vi.doMock("../src/db/index.js", () => testDb.module);

/** Clerk (source of identity) and the job queue are mocked; the users table is a real Postgres. */
const clerkUsers = new Map<string, { firstName: string | null; email: string | null; createdAt?: number }>();
const getUser = vi.fn(async (id: string) => {
  const user = clerkUsers.get(id);
  if (!user) throw Object.assign(new Error("not found"), { status: 404 });
  return {
    id,
    firstName: user.firstName,
    primaryEmailAddress: user.email ? { emailAddress: user.email } : null,
    createdAt: user.createdAt ?? Date.now() - 60_000, // signed up a minute ago
  };
});
vi.doMock("../src/config/clerk.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  clerkClient: { users: { getUser } },
}));
const enqueue = vi.fn(async () => ({ messageId: null, inline: true }));
vi.doMock("../src/services/jobs.service.js", () => ({ enqueue }));

const schema = await import("../src/db/schema.js");
const users = await import("../src/services/user.service.js");
const { db } = testDb;

beforeEach(async () => {
  await testDb.reset();
  clerkUsers.clear();
  getUser.mockClear();
  enqueue.mockClear();
  for (const id of ["user_a", "user_b", "user_gone"]) users.forgetUser(id);
});
afterAll(() => testDb.close());

const welcomes = () => enqueue.mock.calls.filter((call) => (call as unknown[])[0] === "send-welcome-email");

describe("ensureUser (lazy creation in the auth path, Postgres real)", () => {
  it("creates the row from Clerk once, enqueues the welcome e-mail once and then uses the cache", async () => {
    clerkUsers.set("user_a", { firstName: "Ana", email: "ana@x.com" });
    await users.ensureUser("user_a");
    await users.ensureUser("user_a");
    expect(await db.query.users.findFirst({ where: eq(schema.users.id, "user_a") })).toMatchObject({
      email: "ana@x.com",
    });
    expect(getUser).toHaveBeenCalledOnce();
    expect(welcomes()).toEqual([
      [
        "send-welcome-email",
        { userId: "user_a", email: "ana@x.com", name: "Ana" },
        { deduplicationId: "welcome-user_a" },
      ],
    ]);
  });

  it("concurrent first requests and the Clerk webhook create the row and send the welcome e-mail exactly once", async () => {
    clerkUsers.set("user_a", { firstName: "Ana", email: "ana@x.com" });
    await Promise.all([
      users.ensureUser("user_a"),
      users.ensureUser("user_a"),
      users.upsertUser("user_a", "ana@x.com", "Ana"),
    ]);
    expect(await db.query.users.findMany()).toHaveLength(1);
    expect(welcomes()).toHaveLength(1);
  });

  it("a user deleted in Clerk (token still valid) gets 401, is not recreated and Clerk is not asked again", async () => {
    await expect(users.ensureUser("user_gone")).rejects.toMatchObject({ status: 401 });
    await expect(users.ensureUser("user_gone")).rejects.toMatchObject({ status: 401 });
    expect(await db.query.users.findMany()).toEqual([]);
    expect(getUser).toHaveBeenCalledOnce();
  });

  it("an account created long ago gets its row but NO welcome e-mail (project without the Clerk webhook)", async () => {
    clerkUsers.set("user_a", { firstName: "Ana", email: "ana@x.com", createdAt: Date.UTC(2024, 0, 1) });
    await users.ensureUser("user_a");
    expect(await db.query.users.findMany()).toHaveLength(1);
    expect(welcomes()).toEqual([]);
  });

  it("a burst of first requests makes a single Clerk call", async () => {
    clerkUsers.set("user_a", { firstName: "Ana", email: "ana@x.com" });
    await Promise.all(Array.from({ length: 10 }, () => users.ensureUser("user_a")));
    expect(getUser).toHaveBeenCalledOnce();
    expect(welcomes()).toHaveLength(1);
  });

  it("a failed welcome e-mail does not fail the request (the row exists)", async () => {
    clerkUsers.set("user_a", { firstName: null, email: "ana@x.com" });
    enqueue.mockRejectedValueOnce(new Error("resend down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(users.ensureUser("user_a")).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    expect(await db.query.users.findMany()).toHaveLength(1);
  });

  it("requireAuth guarantees the row, so FK'd writes (notifications) work for brand-new users", async () => {
    clerkUsers.set("user_b", { firstName: "Bia", email: "bia@x.com" });
    const { requireAuth } = await import("../src/middlewares/auth.js");
    const { notify } = await import("../src/services/notification.service.js");
    const routes = new Hono<{ Variables: { userId: string } }>().post("/", requireAuth, async (c) => {
      await notify(c.get("userId"), { title: "Bem-vinda" });
      return c.json({ ok: true });
    });
    const res = await appWith("/hello", routes, { userId: "user_b" }).request("/hello", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await db.query.notifications.findMany()).toHaveLength(1);
  });
});

describe("Clerk webhook writes (Postgres real)", () => {
  it("user.created does not resurrect a user already deleted in Clerk (late/retried delivery)", async () => {
    await users.upsertUser("user_gone", "x@x.com", null);
    expect(await db.query.users.findMany()).toEqual([]);
    expect(welcomes()).toEqual([]);
  });

  it("user.updated never inserts", async () => {
    await users.updateUserEmail("user_gone", "x@x.com");
    expect(await db.query.users.findMany()).toEqual([]);
  });

  it("user.created on an existing row only refreshes the e-mail (no second welcome)", async () => {
    clerkUsers.set("user_a", { firstName: "Ana", email: "new@x.com" });
    await db.insert(schema.users).values({ id: "user_a", email: "old@x.com" });
    await users.upsertUser("user_a", "new@x.com", "Ana");
    expect(await db.query.users.findFirst()).toMatchObject({ email: "new@x.com" });
    expect(welcomes()).toEqual([]);
  });
});
