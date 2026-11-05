import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { clientIp, rateLimit } from "../../middlewares/rate-limit.js";
import { validate } from "../../middlewares/validate.js";
import { enqueue } from "../../services/jobs.service.js";
import { verifyTurnstile } from "../../services/turnstile.service.js";
import { contactSchema } from "./contact.schemas.js";

/** Public contact form: validated, rate limited per IP, bot-checked (Turnstile), delivered by a background job. */
export const contactRoutes = new Hono().post(
  "/",
  rateLimit({ prefix: "contact", limit: 5, window: "10 m" }),
  validate("json", contactSchema),
  async (c) => {
    const { turnstileToken, ...input } = c.req.valid("json");
    if (input.website) return c.json({ ok: true }, 202);
    await verifyTurnstile(turnstileToken, clientIp(c), "contact");
    const id = randomUUID();
    await enqueue("send-contact-email", { ...input, id }, { deduplicationId: `contact-${id}` });
    return c.json({ ok: true }, 202);
  },
);
