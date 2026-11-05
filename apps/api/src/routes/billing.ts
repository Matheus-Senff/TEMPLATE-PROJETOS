import { Hono } from "hono";
import { z } from "zod";
import { billingOwner } from "../lib/billing-owner.js";
import { requireAuth, type AuthVariables } from "../middlewares/auth.js";
import { rateLimit } from "../middlewares/rate-limit.js";
import { validate } from "../middlewares/validate.js";
import {
  constructWebhookEvent,
  createCheckoutSession,
  createPortalSession,
  getEntitlement,
  processStripeEvent,
  syncCheckoutSession,
} from "../services/billing.service.js";

const checkoutBody = z.object({
  priceId: z.string().startsWith("price_").max(255),
  mode: z.enum(["payment", "subscription"]).default("subscription"),
  quantity: z.number().int().positive().max(100).optional(),
});

const syncBody = z.object({ sessionId: z.string().startsWith("cs_").max(255) });

/** Answers 503 while STRIPE_SECRET_KEY is not set (except GET /subscription, which reads the local table). */
export const billingRoutes = new Hono<{ Variables: AuthVariables }>()
  // Stripe calls this directly: no Clerk auth, signature-verified on the raw body.
  .post("/webhook", async (c) => {
    const event = await constructWebhookEvent(await c.req.text(), c.req.header("stripe-signature"));
    const { duplicate } = await processStripeEvent(event);
    return c.json({ received: true, duplicate });
  })
  /** Plan state of the billing owner (user or org), from the local `subscriptions` table. */
  .get("/subscription", requireAuth, async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await getEntitlement(billingOwner(c)));
  })
  .post(
    "/checkout",
    requireAuth,
    rateLimit({ prefix: "checkout", limit: 10, window: "1 m" }),
    validate("json", checkoutBody),
    async (c) => {
      const owner = billingOwner(c, { manage: true });
      const session = await createCheckoutSession({ owner, actorId: c.get("userId"), ...c.req.valid("json") });
      return c.json(session, 201);
    },
  )
  /** Success page: sync right away from the session (idempotent with the webhook). */
  .post(
    "/checkout/sync",
    requireAuth,
    rateLimit({ prefix: "checkout-sync", limit: 30, window: "1 m" }),
    validate("json", syncBody),
    async (c) => c.json(await syncCheckoutSession(billingOwner(c), c.req.valid("json").sessionId)),
  )
  .post("/portal", requireAuth, rateLimit({ prefix: "portal", limit: 10, window: "1 m" }), async (c) =>
    c.json({ url: await createPortalSession(billingOwner(c, { manage: true }), c.get("userId")) }),
  );
