import { Hono } from "hono";
import { requireAuth, type AuthVariables } from "../middlewares/auth.js";
import { createAblyJwt } from "../services/realtime.service.js";

/**
 * Answers 503 while ABLY_API_KEY is not set.
 * Client: `new Ably.Realtime({ authUrl: "<api>/realtime/token", authHeaders: { Authorization: "Bearer <clerk token>" } })`.
 * Ably's authUrl expects the token as plain text.
 */
export const realtimeRoutes = new Hono<{ Variables: AuthVariables }>().use(requireAuth).get("/token", (c) => {
  c.header("Cache-Control", "no-store");
  return c.text(createAblyJwt(c.get("userId")), 200, { "Content-Type": "application/jwt" });
});
