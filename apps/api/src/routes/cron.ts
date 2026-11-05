import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { env } from "../config/env.js";
import { hasBearer } from "../lib/secret.js";
import { cleanupOldRecords } from "../services/retention.service.js";

/**
 * Scheduled jobs called by Vercel Cron (apps/api/vercel.json), which sends `Authorization: Bearer <CRON_SECRET>`.
 * Works without QStash. Answers 503 while CRON_SECRET is not set. Vercel Cron uses GET.
 */
export const cronRoutes = new Hono()
  .use(async (c, next) => {
    if (!env.CRON_SECRET) throw new HTTPException(503, { message: "Cron desativado (defina CRON_SECRET)" });
    if (!hasBearer(c.req.header("authorization"), env.CRON_SECRET)) {
      throw new HTTPException(401, { message: "Não autorizado" });
    }
    c.header("Cache-Control", "no-store");
    await next();
  })
  .get("/retention", async (c) => c.json({ ok: true, ...(await cleanupOldRecords()) }));
