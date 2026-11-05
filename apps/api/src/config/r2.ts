import type { S3Client } from "@aws-sdk/client-s3";
import { env } from "./env.js";
import { lazy } from "./lazy.js";

export const r2Config = {
  bucket: env.R2_BUCKET,
  publicUrl: env.R2_PUBLIC_URL,
  presignExpiresIn: env.R2_PRESIGN_EXPIRES_IN,
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
} as const;

/**
 * S3-compatible client pointed at Cloudflare R2 (region must be "auto"), loaded on first use: the AWS SDK only
 * costs import time on requests that touch files.
 * Checksums only WHEN_REQUIRED: since AWS SDK 3.729 every request gets a CRC32 checksum by default, which
 * lands in presigned PUT URLs as `x-amz-checksum-crc32=AAAAAA==` (the CRC of an empty body) and makes browser
 * uploads to R2 fail. Operations that require a checksum (e.g. DeleteObjects) still send one.
 */
export const getR2Client = lazy(async (): Promise<S3Client> => {
  const { S3Client: Client } = await import("@aws-sdk/client-s3");
  return new Client({
    region: "auto",
    endpoint: r2Config.endpoint,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
});
