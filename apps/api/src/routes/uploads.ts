import { Hono } from "hono";
import { z } from "zod";
import { env } from "../config/env.js";
import { paginationQuery } from "../lib/pagination.js";
import { requireAuth, type AuthVariables } from "../middlewares/auth.js";
import { clientIp, rateLimit } from "../middlewares/rate-limit.js";
import { validate } from "../middlewares/validate.js";
import { trackEvent } from "../services/analytics.service.js";
import { audit } from "../services/audit.service.js";
import { confirmUpload, deleteFile, downloadUrl, listFiles, presignUpload } from "../services/upload.service.js";

/**
 * Only allowlisted types (UPLOAD_ALLOWED_TYPES): blocks HTML/SVG/JS that would run on a public R2 domain.
 * The size is signed into the URL, so R2 rejects a body larger than declared.
 */
export const presignBody = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z
    .string()
    .transform((value) => value.split(";")[0]!.trim().toLowerCase())
    .refine((value) => env.UPLOAD_ALLOWED_TYPES.includes(value), { message: "Tipo de arquivo não permitido" }),
  size: z.number().int().positive().max(env.UPLOAD_MAX_BYTES),
});

const idParam = z.object({ id: z.string().uuid() });

/** Presign -> PUT to R2 -> confirm (see services/upload.service.ts). Every query is filtered by the owner. */
export const uploadsRoutes = new Hono<{ Variables: AuthVariables }>()
  .use(requireAuth)
  .get("/", validate("query", paginationQuery), async (c) =>
    c.json(await listFiles(c.get("userId"), c.req.valid("query"))),
  )
  .post(
    "/presign",
    rateLimit({ prefix: "uploads", limit: 20, window: "1 m" }),
    validate("json", presignBody),
    async (c) => {
      const userId = c.get("userId");
      const body = c.req.valid("json");
      const upload = await presignUpload({ ownerId: userId, ...body });
      await audit({
        actorId: userId,
        action: "file.upload_presigned",
        entity: "file",
        entityId: upload.id,
        ip: clientIp(c),
      });
      return c.json(upload, 201);
    },
  )
  .post(
    "/:id/confirm",
    rateLimit({ prefix: "uploads-confirm", limit: 60, window: "1 m" }),
    validate("param", idParam),
    async (c) => {
      const userId = c.get("userId");
      const result = await confirmUpload(userId, c.req.valid("param").id, clientIp(c));
      await trackEvent(userId, "file_uploaded");
      return c.json(result);
    },
  )
  .get("/:id/download", validate("param", idParam), async (c) =>
    c.json({ url: await downloadUrl(c.get("userId"), c.req.valid("param").id) }),
  )
  .delete(
    "/:id",
    rateLimit({ prefix: "uploads-delete", limit: 60, window: "1 m" }),
    validate("param", idParam),
    async (c) => {
      await deleteFile(c.get("userId"), c.req.valid("param").id, clientIp(c));
      return c.json({ deleted: true });
    },
  );
