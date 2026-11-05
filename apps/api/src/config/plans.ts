/**
 * Plans and entitlements, in one place. The source of truth for "who paid" is the local `subscriptions` table
 * (kept in sync by Stripe webhooks); these rules decide what that state grants.
 */

/**
 * Subscription statuses that grant access. `past_due` keeps access while Stripe retries the payment (dunning,
 * a few days); after the retries Stripe moves it to `unpaid`/`canceled` and access stops. Remove `past_due`
 * for a stricter policy.
 */
export const ENTITLED_STATUSES: readonly string[] = ["active", "trialing", "past_due"];

/**
 * Statuses that block a new checkout (the customer already has, or is finishing, a subscription): send them
 * to the Customer Portal instead of creating a duplicate.
 */
export const BLOCKING_STATUSES: readonly string[] = [
  "active",
  "trialing",
  "past_due",
  "incomplete",
  "unpaid",
  "paused",
];

/**
 * Optional feature map per price (fill per project), e.g. `{ price_pro: ["export", "api"] }`.
 * `requirePlan({ feature: "export" })` then only lets through owners whose subscribed price lists it.
 */
export const PRICE_FEATURES: Record<string, readonly string[]> = {};
