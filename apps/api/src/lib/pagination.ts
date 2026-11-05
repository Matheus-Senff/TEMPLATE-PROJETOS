import { HTTPException } from "hono/http-exception";
import { z } from "zod";

/** Query string for cursor pagination: `?limit=20&cursor=...`. */
export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});

/**
 * Position of the last row of a page: `(createdAt, id)` ordered desc. Requires millisecond timestamp columns
 * (`timestampMs()` in schema.ts) so the JS Date round-trips exactly, and uuid primary keys.
 */
export type Cursor = { createdAt: Date; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const encodeCursor = (cursor: Cursor): string =>
  Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`).toString("base64url");

/** Strict: anything but a cursor produced by `encodeCursor()` is a 400 (never reaches the database). */
export function decodeCursor(value: string): Cursor {
  const [iso = "", id = "", ...rest] = Buffer.from(value, "base64url").toString().split("|");
  const createdAt = new Date(iso);
  const valid =
    rest.length === 0 &&
    UUID.test(id) &&
    ISO_INSTANT.test(iso) &&
    !Number.isNaN(createdAt.getTime()) &&
    createdAt.toISOString() === iso;
  if (!valid) throw new HTTPException(400, { message: "Cursor de paginação inválido" });
  return { createdAt, id: id.toLowerCase() };
}

/**
 * Fetch `limit + 1` rows ordered by (createdAt desc, id desc), then call this.
 * Returns the page and the cursor of the next one (null on the last page).
 */
export function toPage<T extends Cursor>(rows: T[], limit: number): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last) : null };
}
