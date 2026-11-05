import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getR2Client } from "../src/config/r2.js";
import {
  buildObjectKey,
  createPresignedDownload,
  createPresignedUpload,
  deleteObjects,
  getPublicUrl,
  headObject,
} from "../src/services/storage.service.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("storage service (R2)", () => {
  it("builds unique, sanitized object keys under the prefix", () => {
    const key = buildObjectKey("/users/u1/", "Relatório final (v2).pdf");
    expect(key).toMatch(/^users\/u1\/[0-9a-f-]{36}-Relatorio-final-v2-\.pdf$/);
    expect(buildObjectKey("users/u1", "a.pdf")).not.toBe(buildObjectKey("users/u1", "a.pdf"));
  });

  it("signs a PUT URL for the bucket without network calls", async () => {
    const upload = await createPresignedUpload({ prefix: "users/u1", fileName: "foto.png", contentType: "image/png" });
    const url = new URL(upload.uploadUrl);
    expect(url.hostname).toBe("test-bucket.acc123.r2.cloudflarestorage.com");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(upload.publicUrl).toBeNull();
  });

  it("presigned PUT carries no checksum params (R2 + browser uploads break with SDK default checksums)", async () => {
    const upload = await createPresignedUpload({
      prefix: "users/u1",
      fileName: "a.pdf",
      contentType: "application/pdf",
      contentLength: 42,
    });
    const params = [...new URL(upload.uploadUrl).searchParams.keys()].map((key) => key.toLowerCase());
    expect(params.filter((key) => key.startsWith("x-amz-checksum") || key === "x-amz-sdk-checksum-algorithm")).toEqual(
      [],
    );
    expect(new URL(upload.uploadUrl).searchParams.get("X-Amz-SignedHeaders")).not.toContain("checksum");
  });

  it("signs a GET URL with an attachment filename", async () => {
    const url = new URL(await createPresignedDownload("users/u1/x.pdf", { downloadFileName: "Contrato.pdf" }));
    expect(url.searchParams.get("response-content-disposition")).toBe('attachment; filename="Contrato.pdf"');
  });

  it("has no public URL when R2_PUBLIC_URL is not set", () => {
    expect(getPublicUrl("a/b.png")).toBeNull();
  });
});

describe("batch deletion (DeleteObjects)", () => {
  it("deletes in batches of 1000 keys, one request at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const send = vi.spyOn(await getR2Client(), "send").mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return { Errors: [] };
    });
    const keys = Array.from({ length: 2500 }, (_, i) => `users/u1/${i}`);

    await expect(deleteObjects(keys)).resolves.toEqual({ deleted: 2500 });
    const batches = send.mock.calls.map(([command]) => (command as DeleteObjectsCommand).input.Delete!.Objects!.length);
    expect(batches).toEqual([1000, 1000, 500]);
    expect(send.mock.calls.every(([command]) => command instanceof DeleteObjectsCommand)).toBe(true);
    expect(maxInFlight).toBe(1);
  });

  it("makes no call for an empty list", async () => {
    const send = vi.spyOn(await getR2Client(), "send");
    await expect(deleteObjects([])).resolves.toEqual({ deleted: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("throws when R2 reports failed keys, so the caller retries", async () => {
    vi.spyOn(await getR2Client(), "send").mockResolvedValue({ Errors: [{ Key: "a", Code: "InternalError" }] } as never);
    await expect(deleteObjects(["a", "b"])).rejects.toThrow("Failed to delete 1 of 2 objects");
  });
});

describe("headObject", () => {
  it("returns null for a missing object and the size otherwise", async () => {
    const send = vi.spyOn(await getR2Client(), "send");
    send.mockRejectedValueOnce(
      Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } }),
    );
    expect(await headObject("missing")).toBeNull();
    send.mockResolvedValueOnce({ ContentLength: 42, ContentType: "application/pdf" } as never);
    expect(await headObject("there")).toEqual({ size: 42, contentType: "application/pdf" });
  });
});
