import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "./helpers/pglite.js";

const testDb = await createTestDb();
vi.doMock("../src/db/index.js", () => testDb.module);
const deleteObjects = vi.fn(async (keys: string[]) => ({ deleted: keys.length }));
vi.doMock("../src/services/storage.service.js", () => ({ deleteObject: vi.fn(async () => {}), deleteObjects }));
const deleteClerkUser = vi.fn(async () => ({}));
vi.doMock("../src/config/clerk.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  clerkClient: { users: { deleteUser: deleteClerkUser } },
}));

const schema = await import("../src/db/schema.js");
const { db } = testDb;

beforeEach(() => testDb.reset());
afterAll(() => testDb.close());

const createUser = (id: string) => db.insert(schema.users).values({ id, email: `${id}@x.com` });

describe("notifications (Postgres real)", () => {
  it("lists newest first with unread count and cursor pages", async () => {
    const { listNotifications } = await import("../src/services/notification.service.js");
    await createUser("u1");
    const base = Date.UTC(2026, 0, 1);
    await db
      .insert(schema.notifications)
      .values(
        Array.from({ length: 25 }, (_, i) => ({ userId: "u1", title: `n${i}`, createdAt: new Date(base + i * 1000) })),
      );

    const first = await listNotifications("u1", { limit: 10 });
    expect(first.items).toHaveLength(10);
    expect(first.items[0]?.title).toBe("n24");
    expect(first.unreadCount).toBe(25);

    const second = await listNotifications("u1", { limit: 10, cursor: first.nextCursor! });
    const third = await listNotifications("u1", { limit: 10, cursor: second.nextCursor! });
    expect(third.items).toHaveLength(5);
    expect(third.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items, ...third.items].map((n) => n.id);
    expect(new Set(ids).size).toBe(25);
  });

  it("does not skip or repeat rows that share the same created_at", async () => {
    const { listNotifications } = await import("../src/services/notification.service.js");
    await createUser("u1");
    const same = new Date(Date.UTC(2026, 0, 1));
    await db
      .insert(schema.notifications)
      .values(Array.from({ length: 7 }, (_, i) => ({ userId: "u1", title: `t${i}`, createdAt: same })));
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listNotifications("u1", { limit: 3, cursor });
      seen.push(...page.items.map((n) => n.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it("only the owner can mark as read; read-all clears the count", async () => {
    const { notify, markRead, markAllRead, unreadCount } = await import("../src/services/notification.service.js");
    await createUser("u1");
    await createUser("u2");
    const n = await notify("u1", { title: "oi" });
    await notify("u1", { title: "oi 2" });

    await expect(markRead("u2", n.id)).rejects.toThrow("Notificação não encontrada");
    await markRead("u1", n.id);
    expect(await unreadCount("u1")).toBe(1);
    await markAllRead("u1");
    expect(await unreadCount("u1")).toBe(0);
  });
});

describe("webhook idempotency (Postgres real)", () => {
  it("runs a delivery once and releases the claim when the handler fails", async () => {
    const { processOnce } = await import("../src/services/webhook.service.js");
    const handler = vi.fn(async () => {});
    expect(await processOnce("stripe", "evt_1", "t", handler)).toEqual({ duplicate: false });
    expect(await processOnce("stripe", "evt_1", "t", handler)).toEqual({ duplicate: true });
    expect(handler).toHaveBeenCalledOnce();

    await expect(processOnce("stripe", "evt_2", "t", async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(await processOnce("stripe", "evt_2", "t", handler)).toEqual({ duplicate: false });
  });

  it("takes over a stale claim left by a crashed attempt, but not a recent one", async () => {
    const { processOnce } = await import("../src/services/webhook.service.js");
    const old = new Date(Date.now() - 10 * 60 * 1000);
    await db.insert(schema.webhookEvents).values([
      { id: "evt_stale", source: "stripe", type: "t", createdAt: old },
      { id: "evt_running", source: "stripe", type: "t" },
    ]);
    const handler = vi.fn(async () => {});
    expect(await processOnce("stripe", "evt_stale", "t", handler)).toEqual({ duplicate: false });
    expect(await processOnce("stripe", "evt_running", "t", handler)).toEqual({ duplicate: true });
    expect(handler).toHaveBeenCalledOnce();
    const row = await db.query.webhookEvents.findFirst({ where: eq(schema.webhookEvents.id, "evt_stale") });
    expect(row?.processedAt).toBeInstanceOf(Date);
  });
});

describe("LGPD export (Postgres real)", () => {
  it("includes every user-owned table: profile, files, notifications and activity", async () => {
    const { exportUserData } = await import("../src/services/user.service.js");
    const { audit } = await import("../src/services/audit.service.js");
    await createUser("u1");
    await createUser("u2");
    await db.insert(schema.files).values({ ownerId: "u1", key: "users/u1/a.pdf", contentType: "application/pdf" });
    await db.insert(schema.notifications).values([
      { userId: "u1", title: "mine" },
      { userId: "u2", title: "not mine" },
    ]);
    await audit({ actorId: "u1", action: "x", entity: "y" });
    const data = await exportUserData("u1");
    expect(data.user?.id).toBe("u1");
    expect(data.files).toHaveLength(1);
    expect(data.notifications.map((n) => n.title)).toEqual(["mine"]);
    expect(data.activity).toHaveLength(1);
  });
});

describe("LGPD erasure (Postgres real)", () => {
  it("deletes the user, cascades files and anonymizes audit logs", async () => {
    const { deleteUserData } = await import("../src/services/user.service.js");
    const { audit } = await import("../src/services/audit.service.js");
    await createUser("u1");
    await db.insert(schema.files).values({ ownerId: "u1", key: "users/u1/a.pdf", contentType: "application/pdf" });
    await audit({ actorId: "u1", action: "file.upload_presigned", entity: "file", ip: "1.2.3.4" });

    await expect(deleteUserData("u1")).resolves.toEqual({ files: 1 });
    expect(await db.query.users.findFirst({ where: eq(schema.users.id, "u1") })).toBeUndefined();
    expect(await db.query.files.findMany()).toEqual([]);
    const logs = await db.query.auditLogs.findMany();
    expect(logs.every((log) => log.actorId === null && log.ip === null)).toBe(true);
  });
});

describe("transactions (Postgres real)", () => {
  it("rolls back every write when one step fails", async () => {
    const { transaction } = await import("../src/db/index.js");
    await expect(
      transaction(async (tx) => {
        await tx.insert(schema.users).values({ id: "u9" });
        await tx.insert(schema.files).values({ ownerId: "u9", key: "k", contentType: "x" });
        await tx.insert(schema.files).values({ ownerId: "u9", key: "k", contentType: "x" });
      }),
    ).rejects.toThrow();
    expect(await db.query.users.findMany()).toEqual([]);
  });
});

describe("retention (Postgres real)", () => {
  it("removes old webhook events and old read notifications only", async () => {
    const { cleanupOldRecords } = await import("../src/services/retention.service.js");
    await createUser("u1");
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    await db.insert(schema.webhookEvents).values([
      { id: "old", source: "stripe", type: "t", createdAt: old },
      { id: "new", source: "stripe", type: "t" },
    ]);
    await db.insert(schema.notifications).values([
      { userId: "u1", title: "old read", readAt: old, createdAt: old },
      { userId: "u1", title: "old unread", createdAt: old },
    ]);
    expect(await cleanupOldRecords()).toMatchObject({ webhookEvents: 1, notifications: 1 });
  });

  it("erases IP addresses from audit logs older than 180 days, keeping the rows", async () => {
    const { cleanupOldRecords } = await import("../src/services/retention.service.js");
    const day = 24 * 60 * 60 * 1000;
    await db.insert(schema.auditLogs).values([
      { action: "a", entity: "e", ip: "1.1.1.1", createdAt: new Date(Date.now() - 181 * day) },
      { action: "b", entity: "e", ip: "2.2.2.2", createdAt: new Date(Date.now() - 179 * day) },
    ]);
    expect(await cleanupOldRecords()).toMatchObject({ auditIps: 1 });
    const logs = await db.query.auditLogs.findMany({ orderBy: (t, { asc }) => asc(t.action) });
    expect(logs.map((log) => log.ip)).toEqual([null, "2.2.2.2"]);
  });

  it("deletes stale pending uploads (rows and objects), never ready files", async () => {
    const { cleanupOldRecords } = await import("../src/services/retention.service.js");
    await createUser("u1");
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await db.insert(schema.files).values([
      { ownerId: "u1", key: "users/u1/stale", contentType: "x", status: "pending", createdAt: old },
      { ownerId: "u1", key: "users/u1/fresh", contentType: "x", status: "pending" },
      { ownerId: "u1", key: "users/u1/ready", contentType: "x", status: "ready", createdAt: old },
    ]);
    deleteObjects.mockClear();
    expect(await cleanupOldRecords()).toMatchObject({ staleUploads: 1 });
    expect(deleteObjects).toHaveBeenCalledWith(["users/u1/stale"]);
    const keys = (await db.query.files.findMany()).map((file) => file.key).sort();
    expect(keys).toEqual(["users/u1/fresh", "users/u1/ready"]);
  });
});
