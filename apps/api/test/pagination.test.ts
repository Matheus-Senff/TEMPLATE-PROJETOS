import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "./helpers/pglite.js";

const testDb = await createTestDb();
vi.doMock("../src/db/index.js", () => testDb.module);
vi.doMock("../src/services/storage.service.js", () => ({}));
const schema = await import("../src/db/schema.js");
const { db } = testDb;

beforeEach(async () => {
  await testDb.reset();
  await db.insert(schema.users).values({ id: "u1" });
});
afterAll(() => testDb.close());

/**
 * Postgres timestamps have microseconds; a JS Date (the cursor) only has milliseconds. Rows created within the
 * same millisecond (common with defaultNow() under load) would be skipped between pages with microsecond columns.
 * PGlite's clock has millisecond resolution, so the microseconds are inserted as explicit literals.
 */
const microsecondStamps = [
  "2026-01-01 10:00:00.123101+00",
  "2026-01-01 10:00:00.123202+00",
  "2026-01-01 10:00:00.123303+00",
  "2026-01-01 10:00:00.123404+00",
  "2026-01-01 10:00:00.123505+00",
  "2026-01-01 10:00:00.123606+00",
  "2026-01-01 10:00:00.123707+00",
];

async function collect<T extends { id: string }>(
  page: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>,
): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const result = await page(cursor);
    seen.push(...result.items.map((item) => item.id));
    cursor = result.nextCursor ?? undefined;
  } while (cursor);
  return seen;
}

describe("cursor pagination with microsecond timestamps (Postgres real)", () => {
  it("notifications: returns every row exactly once across pages", async () => {
    for (const [i, stamp] of microsecondStamps.entries()) {
      await db.execute(
        sql`insert into notifications (user_id, title, created_at) values ('u1', ${`n${i}`}, ${stamp}::timestamptz)`,
      );
    }
    const { listNotifications } = await import("../src/services/notification.service.js");
    const seen = await collect((cursor) => listNotifications("u1", { limit: 2, cursor }));
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it("files: returns every ready file exactly once across pages", async () => {
    for (const [i, stamp] of microsecondStamps.entries()) {
      await db.execute(
        sql`insert into files (owner_id, key, content_type, status, created_at)
            values ('u1', ${`k${i}`}, 'x', 'ready', ${stamp}::timestamptz)`,
      );
    }
    const { listFiles } = await import("../src/services/upload.service.js");
    const seen = await collect((cursor) => listFiles("u1", { limit: 3, cursor }));
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });
});

describe("decodeCursor", () => {
  it("rejects malformed cursors with 400 instead of a database error", async () => {
    const { decodeCursor, encodeCursor } = await import("../src/lib/pagination.js");
    const b64 = (value: string) => Buffer.from(value).toString("base64url");
    const valid = { id: "00000000-0000-4000-8000-000000000001", createdAt: new Date("2026-01-01T10:00:00.123Z") };
    expect(decodeCursor(encodeCursor(valid))).toEqual(valid);

    for (const bad of [
      "lixo",
      b64("2026-01-01T10:00:00.123Z|not-a-uuid"),
      b64("2026-01-01T10:00:00.123Z|00000000-0000-4000-8000-000000000001' or 1=1"),
      b64("not-a-date|00000000-0000-4000-8000-000000000001"),
      b64("99999-01-01T00:00:00.000Z|00000000-0000-4000-8000-000000000001"),
      b64("2026-01-01|00000000-0000-4000-8000-000000000001"),
      b64("|"),
    ]) {
      try {
        decodeCursor(bad);
        expect.unreachable(`accepted ${bad}`);
      } catch (error) {
        expect(error).toMatchObject({ status: 400 });
      }
    }
  });
});
