import { Hono } from "hono";
import { z } from "zod";
import { paginationQuery } from "../lib/pagination.js";
import { requireAuth, type AuthVariables } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import { listNotifications, markAllRead, markRead, unreadCount } from "../services/notification.service.js";

export const notificationsRoutes = new Hono<{ Variables: AuthVariables }>()
  .use(requireAuth)
  .get("/", validate("query", paginationQuery.extend({ unread: z.enum(["true", "false"]).optional() })), async (c) => {
    const { limit, cursor, unread } = c.req.valid("query");
    return c.json(await listNotifications(c.get("userId"), { limit, cursor, unread: unread === "true" }));
  })
  .get("/unread-count", async (c) => c.json({ count: await unreadCount(c.get("userId")) }))
  .post("/read-all", async (c) => {
    await markAllRead(c.get("userId"));
    return c.json({ ok: true });
  })
  .post("/:id/read", validate("param", z.object({ id: z.string().uuid() })), async (c) => {
    await markRead(c.get("userId"), c.req.valid("param").id);
    return c.json({ ok: true });
  });
