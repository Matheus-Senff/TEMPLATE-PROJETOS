import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { billingOwner } from "../lib/billing-owner.js";
import { hasActiveSubscription, type PlanRequirement } from "../services/billing.service.js";
import type { AuthVariables } from "./auth.js";

/**
 * Paid features: `.post("/reports", requireAuth, requirePlan(), handler)`, or a specific plan/feature:
 * `requirePlan({ priceIds: ["price_pro"] })`, `requirePlan({ feature: "export" })` (see config/plans.ts).
 * Reads the local `subscriptions` table (synced by Stripe webhooks); answers 402 without an entitled plan.
 * The web only hides the button; this is the real check.
 */
export const requirePlan = (requirement: PlanRequirement = {}) =>
  createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    if (!(await hasActiveSubscription(billingOwner(c), requirement))) {
      throw new HTTPException(402, { message: "Este recurso exige uma assinatura ativa." });
    }
    await next();
  });
