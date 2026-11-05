import { randomUUID } from "node:crypto";
import { getR2Client, r2Config } from "../config/r2.js";

/** The AWS SDK is imported on first use (cold start): see config/r2.ts. */
const s3 = () => import("@aws-sdk/client-s3");
const presigner = () => import("@aws-sdk/s3-request-presigner");

export type PresignedUpload = {
  key: string;
  uploadUrl: string;
  expiresIn: number;
  publicUrl: string | null;
};

export type PresignUploadInput = {
  /** Logical folder, e.g. `users/<userId>/avatars`. */
  prefix: string;
  fileName: string;
  contentType: string;
  /** Signed into the URL: R2 rejects uploads whose size differs. */
  contentLength?: number;
  expiresIn?: number;
};

const sanitizeFileName = (name: string): string =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(-120);

export const buildObjectKey = (prefix: string, fileName: string): string =>
  `${prefix.replace(/^\/+|\/+$/g, "")}/${randomUUID()}-${sanitizeFileName(fileName)}`;

export const getPublicUrl = (key: string): string | null =>
  r2Config.publicUrl ? `${r2Config.publicUrl.replace(/\/+$/, "")}/${key}` : null;

/** Presigned PUT: the client uploads straight to R2 with `Content-Type` set to the same value. */
export async function createPresignedUpload(input: PresignUploadInput): Promise<PresignedUpload> {
  const key = buildObjectKey(input.prefix, input.fileName);
  const expiresIn = input.expiresIn ?? r2Config.presignExpiresIn;
  const [{ PutObjectCommand }, { getSignedUrl }, client] = await Promise.all([s3(), presigner(), getR2Client()]);
  const command = new PutObjectCommand({
    Bucket: r2Config.bucket,
    Key: key,
    ContentType: input.contentType,
    ...(input.contentLength !== undefined && { ContentLength: input.contentLength }),
  });
  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn,
    signableHeaders: new Set(["content-type", ...(input.contentLength !== undefined ? ["content-length"] : [])]),
  });
  return { key, uploadUrl, expiresIn, publicUrl: getPublicUrl(key) };
}

/** Presigned GET for private objects. */
export async function createPresignedDownload(
  key: string,
  options: { expiresIn?: number; downloadFileName?: string } = {},
): Promise<string> {
  const [{ GetObjectCommand }, { getSignedUrl }, client] = await Promise.all([s3(), presigner(), getR2Client()]);
  const command = new GetObjectCommand({
    Bucket: r2Config.bucket,
    Key: key,
    ...(options.downloadFileName && {
      ResponseContentDisposition: `attachment; filename="${sanitizeFileName(options.downloadFileName)}"`,
    }),
  });
  return getSignedUrl(client, command, { expiresIn: options.expiresIn ?? r2Config.presignExpiresIn });
}

/** Deletes one object. Idempotent: R2 answers 204 for a key that does not exist. */
export async function deleteObject(key: string): Promise<void> {
  const [{ DeleteObjectCommand }, client] = await Promise.all([s3(), getR2Client()]);
  await client.send(new DeleteObjectCommand({ Bucket: r2Config.bucket, Key: key }));
}

/** S3/R2 limit per DeleteObjects call. */
export const DELETE_BATCH_SIZE = 1000;

/**
 * Deletes many objects with DeleteObjects, 1000 keys per call, one batch at a time (no unbounded fan-out).
 * Throws if any key fails, listing how many, so callers (jobs) can retry; missing keys count as deleted.
 */
export async function deleteObjects(keys: readonly string[]): Promise<{ deleted: number }> {
  if (keys.length === 0) return { deleted: 0 };
  const [{ DeleteObjectsCommand }, client] = await Promise.all([s3(), getR2Client()]);
  let failed = 0;
  for (let start = 0; start < keys.length; start += DELETE_BATCH_SIZE) {
    const batch = keys.slice(start, start + DELETE_BATCH_SIZE);
    const result = await client.send(
      new DeleteObjectsCommand({
        Bucket: r2Config.bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    failed += result.Errors?.length ?? 0;
  }
  if (failed > 0) throw new Error(`Failed to delete ${failed} of ${keys.length} objects`);
  return { deleted: keys.length };
}

/** Size and type of an uploaded object, or null when it does not exist (yet). */
export async function headObject(key: string): Promise<{ size: number; contentType: string | null } | null> {
  const [{ HeadObjectCommand }, client] = await Promise.all([s3(), getR2Client()]);
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: r2Config.bucket, Key: key }));
    return { size: head.ContentLength ?? 0, contentType: head.ContentType ?? null };
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (error as { name?: string }).name === "NotFound") return null;
    throw error;
  }
}
