import { and, desc, eq, gt, gte, inArray, lt, ne, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { r2Config } from "../config/r2.js";
import { env } from "../config/env.js";
import { db } from "../db/index.js";
import { files } from "../db/schema.js";
import { decodeCursor, toPage } from "../lib/pagination.js";
import { audit } from "./audit.service.js";
import {
  createPresignedDownload,
  createPresignedUpload,
  deleteObject,
  deleteObjects,
  headObject,
} from "./storage.service.js";

/**
 * Upload flow (the file never passes through the API):
 *   1. POST /uploads/presign  -> quota check, row `pending`, presigned PUT URL
 *   2. browser PUTs the file straight to R2
 *   3. POST /uploads/:id/confirm -> HeadObject checks the object exists with the declared size -> `ready`
 * Only `ready` files are listed/downloaded. Pending rows the browser never confirmed are removed (with their
 * objects) by `cleanupStaleUploads()` in the retention job.
 */

const MS = 1000;

/** A pending upload still counts against the quota while its presigned URL can be used. */
const pendingWindowMs = () => r2Config.presignExpiresIn * MS;
/** A PUT started just before the URL expired may finish a bit later: confirm still accepts it this long. */
export const CONFIRM_GRACE_MS = 10 * 60 * MS;
/**
 * Cleanup only touches pending rows older than window + this margin. It must stay larger than
 * CONFIRM_GRACE_MS: a row old enough to be cleaned can never be confirmed, so the two never race.
 */
export const CLEANUP_MARGIN_MS = 60 * 60 * MS;

/** Oldest `created_at` a pending row may have and still be confirmed. */
const confirmCutoff = (now: Date) => new Date(now.getTime() - pendingWindowMs() - CONFIRM_GRACE_MS);

/**
 * Bytes the user holds: ready files plus pending uploads whose URL has not expired yet.
 * `excludeId` leaves one row out (the one being confirmed).
 */
export async function usedBytes(ownerId: string, options: { now?: Date; excludeId?: string } = {}): Promise<number> {
  const now = options.now ?? new Date();
  const [row] = await db
    .select({ total: sql<string | null>`coalesce(sum(${files.size}), 0)` })
    .from(files)
    .where(
      and(
        eq(files.ownerId, ownerId),
        options.excludeId ? ne(files.id, options.excludeId) : undefined,
        or(
          eq(files.status, "ready"),
          and(eq(files.status, "pending"), gt(files.createdAt, new Date(now.getTime() - pendingWindowMs()))),
        ),
      ),
    );
  return Number(row?.total ?? 0);
}

export type PresignInput = { ownerId: string; fileName: string; contentType: string; size: number };

/**
 * Checks the quota (UPLOAD_QUOTA_BYTES), reserves a `pending` row and returns the presigned PUT.
 * Soft limit under concurrency: two simultaneous presigns may both pass (bounded by the uploads rate limit).
 */
export async function presignUpload(input: PresignInput) {
  const used = await usedBytes(input.ownerId);
  if (used + input.size > env.UPLOAD_QUOTA_BYTES) throw quotaExceeded(used);
  const upload = await createPresignedUpload({
    prefix: `users/${input.ownerId}`,
    fileName: input.fileName,
    contentType: input.contentType,
    contentLength: input.size,
  });
  const [record] = await db
    .insert(files)
    .values({
      ownerId: input.ownerId,
      key: upload.key,
      contentType: input.contentType,
      size: input.size,
      status: "pending",
    })
    .returning({ id: files.id });
  if (!record) throw new Error("presignUpload(): insert returned no row");
  return { id: record.id, key: upload.key, uploadUrl: upload.uploadUrl, expiresIn: upload.expiresIn };
}

const formatMb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

function quotaExceeded(used: number): HTTPException {
  return new HTTPException(413, {
    message: `Cota de armazenamento excedida: ${formatMb(used)} de ${formatMb(env.UPLOAD_QUOTA_BYTES)} usados. Exclua arquivos para liberar espaço.`,
  });
}

const expired = () => new HTTPException(410, { message: "O envio expirou. Envie o arquivo de novo." });

/** Owner-checked lookup: another user's file answers 404, never 403 (does not reveal that it exists). */
async function ownedFile(ownerId: string, id: string) {
  const file = await db.query.files.findFirst({
    columns: { id: true, key: true, size: true, contentType: true, status: true, createdAt: true },
    where: and(eq(files.id, id), eq(files.ownerId, ownerId)),
  });
  if (!file) throw new HTTPException(404, { message: "Arquivo não encontrado" });
  return file;
}

/** Removes an upload that will never become ready (object first, so nothing is orphaned in R2). */
async function discardPending(ownerId: string, file: { id: string; key: string }) {
  await deleteObject(file.key);
  await db.delete(files).where(and(eq(files.id, file.id), eq(files.ownerId, ownerId), eq(files.status, "pending")));
}

/**
 * Marks the upload `ready` once the object is in R2 with the declared size. Idempotent.
 * - Rows older than the presign window + CONFIRM_GRACE_MS are refused (410): they no longer count against the
 *   quota, so confirming them late would bypass it, and cleanup is about to remove them.
 * - The quota is checked again without this row, so presigns made after this one stopped counting cannot
 *   add up beyond UPLOAD_QUOTA_BYTES.
 */
export async function confirmUpload(ownerId: string, id: string, ip?: string, now = new Date()) {
  const file = await ownedFile(ownerId, id);
  if (file.status === "ready") return { id: file.id, status: file.status };
  if (file.createdAt < confirmCutoff(now)) throw expired();

  const object = await headObject(file.key);
  if (!object) throw new HTTPException(409, { message: "O arquivo ainda não chegou ao armazenamento. Envie de novo." });
  if (file.size !== null && object.size !== file.size) {
    // Should not happen (content-length is signed into the URL); never accept a mismatching object.
    await deleteObject(file.key);
    throw new HTTPException(409, { message: "O tamanho do arquivo enviado não confere. Envie de novo." });
  }
  const used = await usedBytes(ownerId, { now, excludeId: id });
  if (used + (file.size ?? object.size) > env.UPLOAD_QUOTA_BYTES) {
    await discardPending(ownerId, file);
    throw quotaExceeded(used);
  }
  // Conditional on still being pending and young enough: never resurrects a row that cleanup removes.
  const updated = await db
    .update(files)
    .set({ status: "ready" })
    .where(
      and(
        eq(files.id, id),
        eq(files.ownerId, ownerId),
        eq(files.status, "pending"),
        gte(files.createdAt, confirmCutoff(now)),
      ),
    )
    .returning({ id: files.id });
  if (updated.length === 0) throw expired();
  await audit({ actorId: ownerId, action: "file.uploaded", entity: "file", entityId: id, ip });
  return { id: file.id, status: "ready" as const };
}

/** Page of the owner's ready files, newest first (cursor pagination). */
export async function listFiles(ownerId: string, options: { limit: number; cursor?: string }) {
  const after = options.cursor ? decodeCursor(options.cursor) : null;
  const rows = await db.query.files.findMany({
    columns: { id: true, key: true, contentType: true, size: true, createdAt: true },
    where: and(
      eq(files.ownerId, ownerId),
      eq(files.status, "ready"),
      after
        ? or(lt(files.createdAt, after.createdAt), and(eq(files.createdAt, after.createdAt), lt(files.id, after.id)))
        : undefined,
    ),
    orderBy: [desc(files.createdAt), desc(files.id)],
    limit: options.limit + 1,
  });
  return toPage(rows, options.limit);
}

/** Temporary GET URL for one of the owner's ready files. */
export async function downloadUrl(ownerId: string, id: string): Promise<string> {
  const file = await ownedFile(ownerId, id);
  if (file.status !== "ready") throw new HTTPException(404, { message: "Arquivo não encontrado" });
  return createPresignedDownload(file.key);
}

/** Deletes the object, then the row (a failed R2 call keeps the row, so nothing is orphaned). Audited. */
export async function deleteFile(ownerId: string, id: string, ip?: string): Promise<void> {
  const file = await ownedFile(ownerId, id);
  await deleteObject(file.key);
  await db.delete(files).where(and(eq(files.id, id), eq(files.ownerId, ownerId)));
  await audit({ actorId: ownerId, action: "file.deleted", entity: "file", entityId: id, ip });
}

/**
 * Retention: pending uploads older than the presign window + CLEANUP_MARGIN_MS are abandoned. They are past the
 * confirm cutoff, so no confirm can turn them `ready` meanwhile. Objects go first: if R2 fails, the rows stay
 * and the next run retries (nothing orphaned); rows are then deleted under the same conditions.
 */
export async function cleanupStaleUploads(now = new Date(), batchSize = 1000): Promise<number> {
  const cutoff = new Date(now.getTime() - pendingWindowMs() - CLEANUP_MARGIN_MS);
  const stale = await db.query.files.findMany({
    columns: { id: true, key: true },
    where: and(eq(files.status, "pending"), lt(files.createdAt, cutoff)),
    limit: batchSize,
  });
  if (stale.length === 0) return 0;
  await deleteObjects(stale.map((file) => file.key));
  const deleted = await db
    .delete(files)
    .where(
      and(
        eq(files.status, "pending"),
        lt(files.createdAt, cutoff),
        inArray(
          files.id,
          stale.map((file) => file.id),
        ),
      ),
    )
    .returning({ id: files.id });
  return deleted.length;
}
