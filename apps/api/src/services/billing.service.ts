import { desc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type Stripe from "stripe";
import { BLOCKING_STATUSES, ENTITLED_STATUSES, PRICE_FEATURES } from "../config/plans.js";
import { getStripe, stripeConfig } from "../config/stripe.js";
import { db } from "../db/index.js";
import { billingCustomers, subscriptions, users, type Subscription } from "../db/schema.js";
import { byOwner, ownerColumns, ownerMetadata, type BillingOwner } from "../lib/billing-owner.js";
import { trackEvent } from "./analytics.service.js";
import { audit } from "./audit.service.js";
import { notify, type NotifyInput } from "./notification.service.js";
import { getOrCreateUser } from "./user.service.js";
import { processOnce } from "./webhook.service.js";

/**
 * Stripe billing. Rules:
 * - The webhook (and the success-page sync, which runs the same idempotent code) is the only writer of
 *   `subscriptions`; it always re-fetches the subscription from Stripe, so event order does not matter.
 * - Access checks read the local table (`getEntitlement`, `hasActiveSubscription`, `requirePlan`).
 * - Everything is keyed by the billing owner (user or org, see lib/billing-owner.ts).
 */

async function requireStripe(): Promise<Stripe> {
  const stripe = stripeConfig.enabled ? await getStripe() : null;
  if (!stripe) throw new HTTPException(503, { message: "Pagamentos desativados (STRIPE_SECRET_KEY não configurada)." });
  return stripe;
}

const toDate = (seconds: number | null | undefined): Date | null => (seconds ? new Date(seconds * 1000) : null);
const idOf = (value: string | { id: string } | null | undefined): string | null =>
  typeof value === "string" ? value : (value?.id ?? null);

/** Owner of a Stripe customer (`billing_customers`). */
async function ownerOfCustomer(customerId: string): Promise<BillingOwner | null> {
  const row = await db.query.billingCustomers.findFirst({
    where: eq(billingCustomers.stripeCustomerId, customerId),
  });
  if (row?.userId) return { type: "user", id: row.userId };
  if (row?.orgId) return { type: "org", id: row.orgId };
  return null;
}

/** Owner stamped by this API in Stripe metadata (`ownerType`/`ownerId`, see `ownerMetadata`). */
function ownerFromMetadata(metadata: Stripe.Metadata | null | undefined): BillingOwner | null {
  const id = metadata?.ownerId;
  if (!id) return null;
  return metadata?.ownerType === "org" ? { type: "org", id } : { type: "user", id };
}

/** False for a user owner whose account was erased: events for it are skipped (not retried for days). */
async function ownerExists(owner: BillingOwner): Promise<boolean> {
  if (owner.type === "org") return true;
  const row = await db.query.users.findFirst({ where: eq(users.id, owner.id), columns: { id: true } });
  if (!row) console.warn(`Stripe event for user ${owner.id} skipped: the user no longer exists`);
  return Boolean(row);
}

async function saveCustomer(owner: BillingOwner, customerId: string): Promise<string> {
  await db
    .insert(billingCustomers)
    .values({ stripeCustomerId: customerId, ...ownerColumns(owner) })
    .onConflictDoNothing();
  const row = await db.query.billingCustomers.findFirst({
    where: byOwner(billingCustomers, owner),
    columns: { stripeCustomerId: true },
  });
  return row?.stripeCustomerId ?? customerId;
}

/** Reuses the owner's Stripe customer or creates one and stores its id. */
async function getOrCreateCustomerId(owner: BillingOwner, actorId: string): Promise<string> {
  const client = await requireStripe();
  const existing = await db.query.billingCustomers.findFirst({
    where: byOwner(billingCustomers, owner),
    columns: { stripeCustomerId: true },
  });
  if (existing) return existing.stripeCustomerId;

  let email: string | undefined;
  if (owner.type === "user") {
    const user = await getOrCreateUser(owner.id);
    email = user.email ?? undefined;
  }
  // Idempotency key: a double click (two concurrent checkouts) gets the same customer instead of a duplicate.
  const customer = await client.customers.create(
    { email, metadata: ownerMetadata(owner, actorId) },
    { idempotencyKey: `customer-create-${owner.type}-${owner.id}` },
  );
  return saveCustomer(owner, customer.id);
}

export type CheckoutInput = {
  owner: BillingOwner;
  /** Signed-in user who started the checkout (audit, notifications). */
  actorId: string;
  priceId: string;
  mode: "payment" | "subscription";
  quantity?: number;
};

/** The browser picks the price, so restrict it to STRIPE_PRICE_IDS when configured. */
export function assertPriceAllowed(priceId: string, allowed: readonly string[] = stripeConfig.allowedPriceIds): void {
  if (allowed.length > 0 && !allowed.includes(priceId)) {
    throw new HTTPException(400, { message: "Plano não disponível." });
  }
}

/** An open Checkout for the same price/mode (e.g. the user went back and clicked again): reuse it. */
async function findOpenSession(client: Stripe, customer: string, input: CheckoutInput) {
  const open = await client.checkout.sessions.list({
    customer,
    status: "open",
    limit: 10,
    expand: ["data.line_items"],
  });
  return open.data.find((session) => {
    const items = session.line_items?.data ?? [];
    return (
      session.mode === input.mode &&
      session.url &&
      items.length === 1 &&
      items[0]?.price?.id === input.priceId &&
      (items[0]?.quantity ?? 1) === (input.quantity ?? 1)
    );
  });
}

/** Hosted Checkout page URL for a Price created in the Stripe dashboard. */
export async function createCheckoutSession(input: CheckoutInput): Promise<{ id: string; url: string }> {
  const client = await requireStripe();
  assertPriceAllowed(input.priceId);
  const customer = await getOrCreateCustomerId(input.owner, input.actorId);

  if (input.mode === "subscription") {
    // Stripe is the authority here (a webhook may still be on its way): never create a second subscription.
    const existing = await client.subscriptions.list({ customer, status: "all", limit: 20 });
    if (existing.data.some((subscription) => BLOCKING_STATUSES.includes(subscription.status))) {
      throw new HTTPException(409, {
        message: "Você já tem uma assinatura. Use “Gerenciar assinatura” para trocar de plano ou forma de pagamento.",
      });
    }
  }
  const reusable = await findOpenSession(client, customer, input);
  if (reusable?.url) return { id: reusable.id, url: reusable.url };

  // Set only here (server side): the webhook grants access only when it matches client_reference_id.
  const metadata = ownerMetadata(input.owner, input.actorId);
  const session = await client.checkout.sessions.create({
    mode: input.mode,
    customer,
    client_reference_id: input.owner.id,
    line_items: [{ price: input.priceId, quantity: input.quantity ?? 1 }],
    success_url: stripeConfig.successUrl,
    cancel_url: stripeConfig.cancelUrl,
    metadata,
    ...(input.mode === "subscription" ? { subscription_data: { metadata } } : { payment_intent_data: { metadata } }),
  });
  if (!session.url)
    throw new HTTPException(502, { message: "O Stripe não retornou a página de pagamento. Tente de novo." });
  return { id: session.id, url: session.url };
}

/** Customer Portal URL (manage cards, invoices and subscriptions). */
export async function createPortalSession(owner: BillingOwner, actorId: string): Promise<string> {
  const client = await requireStripe();
  const customer = await getOrCreateCustomerId(owner, actorId);
  const session = await client.billingPortal.sessions.create({ customer, return_url: stripeConfig.portalReturnUrl });
  return session.url;
}

/**
 * Re-fetches the subscription from Stripe and upserts the local copy. Idempotent and order-independent
 * (an old `updated` event arriving late still stores Stripe's current state). Null when the owner is gone.
 */
export async function syncSubscription(subscriptionId: string): Promise<Subscription | null> {
  const client = await requireStripe();
  const subscription = await client.subscriptions.retrieve(subscriptionId);
  const customerId = idOf(subscription.customer)!;
  const owner = (await ownerOfCustomer(customerId)) ?? ownerFromMetadata(subscription.metadata);
  if (!owner) {
    console.warn(`Subscription ${subscription.id} ignored: customer ${customerId} has no known owner`);
    return null;
  }
  if (!(await ownerExists(owner))) return null;

  const item = subscription.items.data[0];
  const state = {
    ...ownerColumns(owner),
    stripeCustomerId: customerId,
    status: subscription.status,
    priceId: item?.price.id ?? null,
    quantity: item?.quantity ?? null,
    currentPeriodEnd: toDate(item?.current_period_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: toDate(subscription.canceled_at),
    trialEnd: toDate(subscription.trial_end),
  };
  const [row] = await db
    .insert(subscriptions)
    .values({ id: subscription.id, ...state })
    .onConflictDoUpdate({ target: subscriptions.id, set: { ...state, updatedAt: new Date() } })
    .returning();
  return row ?? null;
}

export type Entitlement = {
  active: boolean;
  status: string | null;
  priceId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  features: readonly string[];
};

/** Current plan state of an owner, from the local table (no Stripe call). */
export async function getEntitlement(owner: BillingOwner): Promise<Entitlement> {
  const rows = await db.query.subscriptions.findMany({
    where: byOwner(subscriptions, owner),
    orderBy: [desc(subscriptions.updatedAt)],
    limit: 20,
  });
  const best = rows.find((row) => ENTITLED_STATUSES.includes(row.status)) ?? rows[0];
  const active = Boolean(best && ENTITLED_STATUSES.includes(best.status));
  return {
    active,
    status: best?.status ?? null,
    priceId: best?.priceId ?? null,
    currentPeriodEnd: best?.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: best?.cancelAtPeriodEnd ?? false,
    features: active && best?.priceId ? (PRICE_FEATURES[best.priceId] ?? []) : [],
  };
}

export type PlanRequirement = { priceIds?: readonly string[]; feature?: string };

/** Entitlement check for services: any active plan, or one of `priceIds`, or a plan that lists `feature`. */
export async function hasActiveSubscription(owner: BillingOwner, requirement: PlanRequirement = {}): Promise<boolean> {
  const entitlement = await getEntitlement(owner);
  if (!entitlement.active) return false;
  if (requirement.priceIds?.length && !requirement.priceIds.includes(entitlement.priceId ?? "")) return false;
  if (requirement.feature && !entitlement.features.includes(requirement.feature)) return false;
  return true;
}

/** Verifies the `stripe-signature` header against the raw body. Throws 400 on mismatch. */
export async function constructWebhookEvent(rawBody: string, signature: string | undefined): Promise<Stripe.Event> {
  const client = await requireStripe();
  if (!stripeConfig.webhookSecret || !signature) {
    throw new HTTPException(400, { message: "Missing webhook secret or signature" });
  }
  try {
    return await client.webhooks.constructEventAsync(rawBody, signature, stripeConfig.webhookSecret);
  } catch {
    throw new HTTPException(400, { message: "Invalid Stripe signature" });
  }
}

/** Runs `handleStripeEvent` at most once per event id (see `processOnce`). */
export const processStripeEvent = (event: Stripe.Event): Promise<{ duplicate: boolean }> =>
  processOnce("stripe", event.id, event.type, () => handleStripeEvent(event));

/**
 * The owner a checkout belongs to, or null when it cannot be trusted. `client_reference_id` alone is not
 * enough: anyone can append `?client_reference_id=<victim>` to a Payment Link. Sessions created by this API
 * also carry `metadata.ownerId` (set server side), so both must match.
 */
export function trustedCheckoutOwner(session: Stripe.Checkout.Session): BillingOwner | null {
  const owner = ownerFromMetadata(session.metadata);
  if (!session.client_reference_id || owner?.id !== session.client_reference_id) {
    console.warn(`Checkout ${session.id} ignored: metadata owner does not match client_reference_id`);
    return null;
  }
  return owner;
}

const isAllowedPrice = (priceId: string | undefined): boolean =>
  Boolean(priceId) && stripeConfig.allowedPriceIds.includes(priceId!);

/** Every line item must use a price from STRIPE_PRICE_IDS (skipped while the allowlist is empty, in dev). */
async function lineItemsAllowed(session: Stripe.Checkout.Session): Promise<boolean> {
  if (stripeConfig.allowedPriceIds.length === 0) return true;
  const client = await requireStripe();
  const items = await client.checkout.sessions.listLineItems(session.id, { limit: 100 });
  const allowed = items.data.length > 0 && items.data.every((item) => isAllowedPrice(item.price?.id));
  if (!allowed) console.warn(`Checkout ${session.id} ignored: price outside STRIPE_PRICE_IDS`);
  return allowed;
}

/** Who to tell: the user owner, or (org billing) the member who started the checkout, if still around. */
async function notifyOwner(owner: BillingOwner, actorId: string | undefined, input: NotifyInput): Promise<void> {
  const target = owner.type === "user" ? owner.id : actorId;
  if (!target) return;
  if (owner.type === "org" && !(await ownerExists({ type: "user", id: target }))) return;
  await notify(target, input);
}

/** Grant one-off purchases here: runs only when the money is confirmed (paid or no_payment_required). */
async function onCheckoutPaid(owner: BillingOwner, session: Stripe.Checkout.Session): Promise<void> {
  const actorId = session.metadata?.actorId ?? (owner.type === "user" ? owner.id : null);
  await trackEvent(actorId ?? owner.id, "checkout_completed", {
    mode: session.mode,
    amount_total: session.amount_total,
    currency: session.currency,
  });
  await audit({
    actorId,
    action: "checkout.paid",
    entity: "stripe_checkout",
    entityId: session.id,
    metadata: {
      ownerType: owner.type,
      mode: session.mode,
      amountTotal: session.amount_total,
      currency: session.currency,
    },
  });
  await notifyOwner(owner, actorId ?? undefined, { type: "success", title: "Pagamento confirmado", link: "/billing" });
}

/**
 * Success page (`/billing/success?session_id=...`): syncs right away instead of waiting for the webhook.
 * Same idempotent code as the webhook; one-off grants (onCheckoutPaid) stay webhook-only.
 */
export async function syncCheckoutSession(owner: BillingOwner, sessionId: string) {
  const client = await requireStripe();
  const session = await client.checkout.sessions.retrieve(sessionId).catch(() => null);
  const sessionOwner = session && trustedCheckoutOwner(session);
  if (!session || sessionOwner?.type !== owner.type || sessionOwner.id !== owner.id) {
    throw new HTTPException(404, { message: "Pagamento não encontrado." });
  }
  const paid = session.status === "complete" && session.payment_status !== "unpaid";
  const subscriptionId = idOf(session.subscription);
  if (paid && subscriptionId) await syncSubscription(subscriptionId);
  const status =
    session.status === "expired" ? "expired" : paid ? "paid" : session.status === "complete" ? "processing" : "open";
  return { status, mode: session.mode, entitlement: await getEntitlement(owner) } as const;
}

/**
 * Cancels every live subscription of a Stripe customer and deletes the customer (account erasure).
 * Idempotent: an already deleted customer counts as done.
 */
export async function deleteStripeCustomer(customerId: string): Promise<{ canceled: number }> {
  const stripe = stripeConfig.enabled ? await getStripe() : null;
  if (!stripe) {
    // Never silently leave a paying subscription behind: the deletion job fails (and is retried/alerted).
    throw new Error(`Stripe is disabled but customer ${customerId} must be canceled before erasing the user`);
  }
  let canceled = 0;
  try {
    for await (const subscription of stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 })) {
      if (subscription.status === "canceled" || subscription.status === "incomplete_expired") continue;
      await stripe.subscriptions.cancel(subscription.id, { prorate: false });
      canceled += 1;
    }
    await stripe.customers.del(customerId);
  } catch (error) {
    if ((error as { code?: string }).code === "resource_missing") return { canceled };
    throw error;
  }
  return { canceled };
}

/** Business reactions to Stripe events. Access state itself lives in `subscriptions` (syncSubscription). */
export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object;
      // Boleto and other delayed methods complete the session before the money arrives.
      if (session.payment_status === "unpaid") {
        console.info(`Checkout ${session.id} completed, waiting for asynchronous payment`);
        break;
      }
      const owner = trustedCheckoutOwner(session);
      if (!owner || !(await ownerExists(owner)) || !(await lineItemsAllowed(session))) break;
      const subscriptionId = idOf(session.subscription);
      if (subscriptionId) await syncSubscription(subscriptionId);
      await onCheckoutPaid(owner, session);
      break;
    }
    case "checkout.session.async_payment_failed": {
      const session = event.data.object;
      const owner = trustedCheckoutOwner(session);
      if (owner && (await ownerExists(owner))) {
        await notifyOwner(owner, session.metadata?.actorId, {
          type: "error",
          title: "Pagamento não confirmado",
          body: "O pagamento não foi compensado. Tente novamente com outra forma de pagamento.",
          link: "/billing",
        });
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
    case "customer.subscription.deleted": {
      const row = await syncSubscription(event.data.object.id);
      if (row && event.type === "customer.subscription.deleted") {
        const owner: BillingOwner = row.userId ? { type: "user", id: row.userId } : { type: "org", id: row.orgId! };
        await notifyOwner(owner, event.data.object.metadata?.actorId, {
          type: "warning",
          title: "Assinatura encerrada",
          body: "Sua assinatura foi cancelada. Assine de novo quando quiser.",
          link: "/billing",
        });
      }
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      console.warn(`Payment failed for invoice ${invoice.id}`);
      const customerId = idOf(invoice.customer);
      const owner = customerId ? await ownerOfCustomer(customerId) : null;
      if (owner && (await ownerExists(owner))) {
        await notifyOwner(owner, undefined, {
          type: "error",
          title: "Falha no pagamento",
          body: "Atualize sua forma de pagamento para manter o acesso.",
          link: "/billing",
        });
      }
      break;
    }
    default:
      break;
  }
}
