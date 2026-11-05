import type Stripe from "stripe";
import { env } from "./env.js";
import { lazy } from "./lazy.js";

export const stripeConfig = {
  /** Module on/off from env only: the SDK itself is imported on first use (cold start). */
  enabled: Boolean(env.STRIPE_SECRET_KEY),
  webhookSecret: env.STRIPE_WEBHOOK_SECRET,
  allowedPriceIds: env.STRIPE_PRICE_IDS ?? [],
  successUrl: `${env.APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
  cancelUrl: `${env.APP_URL}/billing/cancel`,
  portalReturnUrl: `${env.APP_URL}/billing`,
} as const;

/** Stripe client, or null when STRIPE_SECRET_KEY is not set. Loaded lazily (the SDK costs ~400 ms to import). */
export const getStripe = lazy(async (): Promise<Stripe | null> => {
  if (!env.STRIPE_SECRET_KEY) return null;
  const { default: StripeClient } = await import("stripe");
  return new StripeClient(env.STRIPE_SECRET_KEY);
});
