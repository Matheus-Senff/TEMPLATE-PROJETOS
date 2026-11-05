import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, requireReverification, requireRole, type AuthVariables } from "../../middlewares/auth.js";
import { clientIp, rateLimit } from "../../middlewares/rate-limit.js";
import { validate } from "../../middlewares/validate.js";
import { listUsers, setUserRole } from "./admin.service.js";
import { listUsersQuery, setRoleSchema } from "./admin.schemas.js";

/** Platform administration. Admin = Clerk publicMetadata.role "admin" (session token must include metadata). */
export const adminRoutes = new Hono<{ Variables: AuthVariables }>()
  .use(requireAuth, requireRole("admin"))
  .get("/users", validate("query", listUsersQuery), async (c) => {
    const { page, q } = c.req.valid("query");
    return c.json(await listUsers(page, q));
  })
  .post(
    "/users/:id/role",
    rateLimit({ prefix: "admin-role", limit: 30, window: "1 m" }),
    // Privilege change: the admin must have re-entered credentials recently (Clerk reverification).
    requireReverification(),
    validate("param", z.object({ id: z.string().min(1).max(64) })),
    validate("json", setRoleSchema),
    async (c) => {
      await setUserRole(c.get("userId"), c.req.valid("param").id, c.req.valid("json").role, clientIp(c));
      return c.json({ ok: true });
    },
  );
