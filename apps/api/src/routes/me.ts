import { Hono } from "hono";
import { requireAuth, requireReverification, type AuthVariables } from "../middlewares/auth.js";
import { clientIp, rateLimit } from "../middlewares/rate-limit.js";
import { audit } from "../services/audit.service.js";
import { enqueue } from "../services/jobs.service.js";
import { enabledFlags } from "../services/flags.service.js";
import { exportUserData } from "../services/user.service.js";

/** The signed-in user's own account (LGPD: access, portability and erasure). */
export const meRoutes = new Hono<{ Variables: AuthVariables }>()
  .use(requireAuth)
  .get("/", (c) => c.json({ userId: c.get("userId") }))
  /** Feature flags evaluated server side for this user (PostHog, or FEATURE_FLAGS without it). */
  .get("/flags", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ flags: await enabledFlags(c.get("userId")) });
  })
  .get("/export", rateLimit({ prefix: "me-export", limit: 5, window: "1 h" }), async (c) => {
    const userId = c.get("userId");
    const data = await exportUserData(userId);
    await audit({ actorId: userId, action: "user.data_exported", entity: "user", entityId: userId, ip: clientIp(c) });
    c.header("Cache-Control", "no-store");
    c.header("Content-Disposition", 'attachment; filename="meus-dados.json"');
    return c.json(data);
  })
  // Irreversible: the user must have re-entered credentials recently (Clerk reverification).
  .delete("/", rateLimit({ prefix: "me-delete", limit: 3, window: "1 h" }), requireReverification(), async (c) => {
    const userId = c.get("userId");
    await audit({
      actorId: userId,
      action: "user.deletion_requested",
      entity: "user",
      entityId: userId,
      ip: clientIp(c),
    });
    // The erasure job deletes the Clerk user LAST (deleteUserData): if Stripe, R2 or the database fail, the
    // account still exists, so the job retries (QStash) or the user can try again (inline), never stuck
    // without a login while still being charged.
    const { inline } = await enqueue("delete-user-data", { userId }, { deduplicationId: `delete-${userId}` });
    return c.json({ deleted: true, pending: !inline });
  });
