import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appWith, json } from "./helpers/auth.js";
import { createTestDb } from "./helpers/pglite.js";

const testDb = await createTestDb();
vi.doMock("../src/db/index.js", () => testDb.module);

/** R2 is mocked: the routes' rules (owner, quota, status) run against a real Postgres. */
const objects = new Map<string, number>();
const storage = {
  createPresignedUpload: vi.fn(async (input: { prefix: string; fileName: string }) => ({
    key: `${input.prefix}/${crypto.randomUUID()}-${input.fileName}`,
    uploadUrl: "https://r2.example/put",
    expiresIn: 900,
    publicUrl: null,
  })),
  createPresignedDownload: vi.fn(async (key: string) => `https://r2.example/get/${key}`),
  headObject: vi.fn(async (key: string) => (objects.has(key) ? { size: objects.get(key)!, contentType: "x" } : null)),
  deleteObject: vi.fn(async (key: string) => void objects.delete(key)),
  deleteObjects: vi.fn(async (keys: string[]) => ({ deleted: keys.length })),
};
vi.doMock("../src/services/storage.service.js", () => storage);

const schema = await import("../src/db/schema.js");
const { uploadsRoutes } = await import("../src/routes/uploads.js");
const { db } = testDb;

const as = (userId: string) => appWith("/uploads", uploadsRoutes, { userId });
const alice = as("user_alice");
const bob = as("user_bob");

beforeEach(async () => {
  await testDb.reset();
  objects.clear();
  await db.insert(schema.users).values([{ id: "user_alice" }, { id: "user_bob" }]);
});
afterAll(() => testDb.close());

async function presign(app = alice, size = 100, fileName = "a.pdf") {
  const res = await app.request("/uploads/presign", json({ fileName, contentType: "application/pdf", size }));
  return { res, body: (await res.json()) as { id: string; key: string; error?: string } };
}

async function uploadAndConfirm(app = alice, size = 100) {
  const { body } = await presign(app, size);
  objects.set(body.key, size);
  const res = await app.request(`/uploads/${body.id}/confirm`, { method: "POST" });
  expect(res.status).toBe(200);
  return body;
}

describe("uploads: presign -> PUT -> confirm (Postgres real)", () => {
  it("creates a pending row that is not listed until confirmed", async () => {
    const { res, body } = await presign();
    expect(res.status).toBe(201);
    const row = await db.query.files.findFirst({ where: eq(schema.files.id, body.id) });
    expect(row).toMatchObject({ ownerId: "user_alice", status: "pending", size: 100 });
    expect((await (await alice.request("/uploads")).json()).items).toEqual([]);
    expect((await alice.request(`/uploads/${body.id}/download`)).status).toBe(404);
  });

  it("confirm answers 409 while the object is not in R2, then marks it ready (idempotent)", async () => {
    const { body } = await presign();
    expect((await alice.request(`/uploads/${body.id}/confirm`, { method: "POST" })).status).toBe(409);

    objects.set(body.key, 100);
    const confirmed = await alice.request(`/uploads/${body.id}/confirm`, { method: "POST" });
    expect(await confirmed.json()).toEqual({ id: body.id, status: "ready" });
    expect((await alice.request(`/uploads/${body.id}/confirm`, { method: "POST" })).status).toBe(200);

    const list = await (await alice.request("/uploads")).json();
    expect(list.items.map((item: { id: string }) => item.id)).toEqual([body.id]);
    expect(await (await alice.request(`/uploads/${body.id}/download`)).json()).toEqual({
      url: `https://r2.example/get/${body.key}`,
    });
    const audit = await db.query.auditLogs.findMany({ where: eq(schema.auditLogs.action, "file.uploaded") });
    expect(audit).toHaveLength(1);
  });

  it("rejects an object whose size does not match the declared one", async () => {
    const { body } = await presign(alice, 100);
    objects.set(body.key, 999);
    expect((await alice.request(`/uploads/${body.id}/confirm`, { method: "POST" })).status).toBe(409);
    expect(storage.deleteObject).toHaveBeenCalledWith(body.key);
  });

  it("enforces the per-user quota with ready files and in-flight uploads", async () => {
    vi.resetModules();
    vi.stubEnv("UPLOAD_QUOTA_BYTES", "250");
    const { uploadsRoutes: limited } = await import("../src/routes/uploads.js");
    const app = appWith("/uploads", limited, { userId: "user_alice" });

    await uploadAndConfirm(app, 100);
    expect((await presign(app, 100)).res.status).toBe(201); // pending, still counts
    const over = await presign(app, 100);
    expect(over.res.status).toBe(413);
    expect(over.body.error).toContain("Cota de armazenamento excedida");
    // Another user has their own quota.
    expect((await presign(appWith("/uploads", limited, { userId: "user_bob" }), 200)).res.status).toBe(201);
    vi.unstubAllEnvs();
  });

  it("an expired pending upload no longer counts against the quota", async () => {
    const { usedBytes } = await import("../src/services/upload.service.js");
    await db.insert(schema.files).values([
      { ownerId: "user_alice", key: "k1", contentType: "x", size: 10, status: "ready" },
      { ownerId: "user_alice", key: "k2", contentType: "x", size: 20, status: "pending" },
      {
        ownerId: "user_alice",
        key: "k3",
        contentType: "x",
        size: 40,
        status: "pending",
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    ]);
    expect(await usedBytes("user_alice")).toBe(30);
    expect(await usedBytes("user_alice", { excludeId: (await db.query.files.findFirst())!.id })).toBeLessThan(30);
  });
});

describe("uploads: quota cannot be bypassed by confirming late (Postgres real)", () => {
  const MIN = 60 * 1000;
  const pendingRow = async (key: string, size: number, minutesAgo: number) => {
    const [row] = await db
      .insert(schema.files)
      .values({
        ownerId: "user_alice",
        key,
        contentType: "application/pdf",
        size,
        status: "pending",
        createdAt: new Date(Date.now() - minutesAgo * MIN),
      })
      .returning({ id: schema.files.id });
    objects.set(key, size);
    return row!.id;
  };

  it("confirm refuses (410) a pending upload older than the presign window + grace", async () => {
    const { confirmUpload } = await import("../src/services/upload.service.js");
    const id = await pendingRow("users/user_alice/old.pdf", 100, 15 + 11); // window 15 min + grace 10 min
    await expect(confirmUpload("user_alice", id)).rejects.toMatchObject({ status: 410 });
    expect((await db.query.files.findFirst({ where: eq(schema.files.id, id) }))?.status).toBe("pending");
  });

  it("presign, wait until it stops counting, presign again: confirming both cannot exceed the quota", async () => {
    vi.resetModules();
    vi.stubEnv("UPLOAD_QUOTA_BYTES", "250");
    const { confirmUpload } = await import("../src/services/upload.service.js");
    const first = await pendingRow("users/user_alice/a.pdf", 200, 16); // outside the 15 min reservation, inside grace
    const second = await pendingRow("users/user_alice/b.pdf", 200, 1); // allowed: `first` no longer counts

    await expect(confirmUpload("user_alice", first)).rejects.toMatchObject({ status: 413 });
    expect(storage.deleteObject).toHaveBeenCalledWith("users/user_alice/a.pdf");
    expect(await db.query.files.findFirst({ where: eq(schema.files.id, first) })).toBeUndefined();
    await expect(confirmUpload("user_alice", second)).resolves.toMatchObject({ status: "ready" });
    vi.unstubAllEnvs();
  });

  it("cleanup removes only rows past the confirm cutoff, so a late confirm can never revive a cleaned row", async () => {
    const { cleanupStaleUploads, confirmUpload } = await import("../src/services/upload.service.js");
    const confirmable = await pendingRow("users/user_alice/recent.pdf", 10, 20);
    const abandoned = await pendingRow("users/user_alice/abandoned.pdf", 10, 15 + 61);
    expect(await cleanupStaleUploads()).toBe(1);
    expect(storage.deleteObjects).toHaveBeenCalledWith(["users/user_alice/abandoned.pdf"]);
    await expect(confirmUpload("user_alice", abandoned)).rejects.toMatchObject({ status: 404 });
    await expect(confirmUpload("user_alice", confirmable)).resolves.toMatchObject({ status: "ready" });
  });
});

describe("uploads: ownership (user B never sees user A's files)", () => {
  it("B cannot download, confirm or delete A's file (404, nothing changes)", async () => {
    const file = await uploadAndConfirm(alice);
    const pending = (await presign(alice)).body;

    expect((await bob.request(`/uploads/${file.id}/download`)).status).toBe(404);
    expect((await bob.request(`/uploads/${pending.id}/confirm`, { method: "POST" })).status).toBe(404);
    expect((await bob.request(`/uploads/${file.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await (await bob.request("/uploads")).json()).items).toEqual([]);

    expect(storage.deleteObject).not.toHaveBeenCalledWith(file.key);
    expect(await db.query.files.findFirst({ where: eq(schema.files.id, file.id) })).toBeDefined();
  });

  it("the owner deletes the object and the row, audited", async () => {
    const file = await uploadAndConfirm(alice);
    const res = await alice.request(`/uploads/${file.id}`, { method: "DELETE" });
    expect(await res.json()).toEqual({ deleted: true });
    expect(storage.deleteObject).toHaveBeenCalledWith(file.key);
    expect(await db.query.files.findFirst({ where: eq(schema.files.id, file.id) })).toBeUndefined();
    const audit = await db.query.auditLogs.findFirst({ where: eq(schema.auditLogs.action, "file.deleted") });
    expect(audit).toMatchObject({ actorId: "user_alice", entityId: file.id });
  });

  it("validates ids", async () => {
    expect((await alice.request("/uploads/not-a-uuid", { method: "DELETE" })).status).toBe(400);
  });
});
